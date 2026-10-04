/**
 * Time-bounded regular expression evaluation for grep_files (audit VFO-14).
 *
 * Patterns passed to grep_files come from the model and file contents may be
 * attacker-authored. JavaScript's backtracking engine is exponential on
 * patterns like `^(a+)+$`, and running such a match on the main event loop
 * freezes the whole single-threaded server. All regex evaluation against file
 * content therefore runs inside a `worker_threads` Worker with a hard time
 * budget; when the budget is exceeded the worker is terminated and the grep
 * call fails with a clear error.
 *
 * The worker is created from an inline plain-JavaScript source string with
 * `{ eval: true }` instead of a separate file. A file path would have to be
 * resolved through `import.meta.url` in the compiled ESM build and through a
 * different mechanism under ts-jest; the eval form behaves identically in both.
 */
import { Worker } from "worker_threads";

/** Default time budget for evaluating the pattern against a single file. */
export const DEFAULT_GREP_REGEX_FILE_TIMEOUT_MS = 5_000;

/** Default cumulative regex evaluation budget for one grep_files call. */
export const DEFAULT_GREP_REGEX_TOTAL_TIMEOUT_MS = 30_000;

/**
 * Self-contained worker source. Plain JavaScript only; the sole dependency is
 * `worker_threads`. It mirrors the matching logic grepFilesWithValidation used
 * to run on the main thread so results stay identical:
 *
 * - single-line mode: test every line of the CRLF-normalized content with the
 *   non-global regex (flags + nothing) and report matching line indices;
 * - multiline mode: count matches of the global regex (flags + "g", no dotAll)
 *   over the raw content, then, if requested and there was a match, report the
 *   indices of normalized lines on which the dotAll regex (flags + "s") tests
 *   true.
 *
 * `maxLineMatches` lets the caller stop line scanning once it has as many
 * matching lines as it will consume (head_limit); null means "all".
 */
const WORKER_SOURCE = `
"use strict";
const { parentPort } = require("worker_threads");
const cache = new Map();
function getRegex(pattern, flags) {
  const key = flags + "\\u0000" + pattern;
  let re = cache.get(key);
  if (re === undefined) {
    re = new RegExp(pattern, flags);
    cache.set(key, re);
  }
  return re;
}
function collectLines(content, re, maxLineMatches) {
  const indices = [];
  if (maxLineMatches !== null && maxLineMatches <= 0) return indices;
  const lines = content.replace(/\\r\\n/g, "\\n").split("\\n");
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) {
      indices.push(i);
      if (maxLineMatches !== null && indices.length >= maxLineMatches) break;
    }
  }
  return indices;
}
parentPort.on("message", (msg) => {
  const { id, content, pattern, flags, multiline, needLines, maxLineMatches } = msg;
  try {
    const limit = typeof maxLineMatches === "number" ? maxLineMatches : null;
    if (multiline) {
      const globalRe = getRegex(pattern, flags + "g");
      const matches = content.match(globalRe);
      const globalMatchCount = matches ? matches.length : 0;
      let lineIndices = [];
      if (matches && needLines) {
        lineIndices = collectLines(content, getRegex(pattern, flags + "s"), limit);
      }
      parentPort.postMessage({ id, ok: true, hasGlobalMatch: matches !== null, globalMatchCount, lineIndices });
    } else {
      const lineIndices = collectLines(content, getRegex(pattern, flags), limit);
      parentPort.postMessage({ id, ok: true, hasGlobalMatch: false, globalMatchCount: 0, lineIndices });
    }
  } catch (error) {
    parentPort.postMessage({ id, ok: false, error: error && error.message ? String(error.message) : String(error) });
  }
});
`;

export interface RegexEvaluationRequest {
  content: string;
  pattern: string;
  /** Base flags ("" or "i"). The worker derives "g" / "s" variants itself. */
  flags: string;
  multiline: boolean;
  /** Multiline mode only: whether per-line indices are needed. */
  needLines: boolean;
  /** Stop after this many matching lines (undefined = scan all lines). */
  maxLineMatches?: number;
}

export interface RegexEvaluationResult {
  /** Multiline mode: whether the global regex matched the full content. */
  hasGlobalMatch: boolean;
  /** Multiline mode: number of global-regex matches over the full content. */
  globalMatchCount: number;
  /** Zero-based indices of matching (CRLF-normalized) lines, ascending. */
  lineIndices: number[];
}

/**
 * Base class for failures of the regex evaluation machinery (timeouts, worker
 * crashes). grepFilesWithValidation rethrows these instead of treating them as
 * "skip this file", so a timed-out search fails loudly rather than silently
 * returning partial results.
 */
export class RegexEvaluationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegexEvaluationError";
  }
}

export class RegexTimeoutError extends RegexEvaluationError {
  constructor(message: string) {
    super(message);
    this.name = "RegexTimeoutError";
  }
}

export interface RegexEvaluationSessionOptions {
  /** Per-file time budget in ms (default DEFAULT_GREP_REGEX_FILE_TIMEOUT_MS). */
  fileTimeoutMs?: number;
  /** Cumulative budget for the session in ms (default DEFAULT_GREP_REGEX_TOTAL_TIMEOUT_MS). */
  totalTimeoutMs?: number;
}

interface PendingRequest {
  id: number;
  resolve: (value: RegexEvaluationResult) => void;
  reject: (reason: Error) => void;
}

/**
 * One worker reused for every file of a single grep call. Requests are
 * evaluated strictly one at a time. Always call dispose() when done.
 */
export class RegexEvaluationSession {
  private worker: Worker | null = null;
  private online: Promise<void> | null = null;
  private pending: PendingRequest | null = null;
  private nextId = 1;
  private spentMs = 0;
  private readonly fileTimeoutMs: number;
  private readonly totalTimeoutMs: number;

  constructor(options: RegexEvaluationSessionOptions = {}) {
    this.fileTimeoutMs =
      options.fileTimeoutMs ?? DEFAULT_GREP_REGEX_FILE_TIMEOUT_MS;
    this.totalTimeoutMs =
      options.totalTimeoutMs ?? DEFAULT_GREP_REGEX_TOTAL_TIMEOUT_MS;
  }

  private startWorker(): Promise<void> {
    if (this.worker && this.online) return this.online;

    const worker = new Worker(WORKER_SOURCE, { eval: true });
    this.worker = worker;

    this.online = new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        worker.off("online", onOnline);
        worker.off("error", onEarlyError);
        worker.off("exit", onEarlyExit);
      };
      const onOnline = () => {
        cleanup();
        resolve();
      };
      const onEarlyError = (error: Error) => {
        cleanup();
        reject(
          new RegexEvaluationError(
            `Regex worker failed to start: ${error.message}`,
          ),
        );
      };
      const onEarlyExit = (code: number) => {
        cleanup();
        reject(
          new RegexEvaluationError(
            `Regex worker exited during start-up (code ${code})`,
          ),
        );
      };
      worker.once("online", onOnline);
      worker.once("error", onEarlyError);
      worker.once("exit", onEarlyExit);
    });

    worker.on("message", (message: any) => {
      const pending = this.pending;
      if (!pending || !message || message.id !== pending.id) return;
      this.pending = null;
      if (message.ok) {
        pending.resolve({
          hasGlobalMatch: message.hasGlobalMatch,
          globalMatchCount: message.globalMatchCount,
          lineIndices: message.lineIndices,
        });
      } else {
        pending.reject(
          new RegexEvaluationError(
            `Regex evaluation failed: ${String(message.error)}`,
          ),
        );
      }
    });
    worker.on("error", (error: Error) => {
      this.failPending(
        new RegexEvaluationError(`Regex worker crashed: ${error.message}`),
      );
      this.discardWorker(worker);
    });
    worker.on("exit", (code: number) => {
      this.failPending(
        new RegexEvaluationError(
          `Regex worker exited unexpectedly (code ${code})`,
        ),
      );
      this.discardWorker(worker);
    });

    return this.online;
  }

  private failPending(error: Error): void {
    const pending = this.pending;
    if (pending) {
      this.pending = null;
      pending.reject(error);
    }
  }

  private discardWorker(worker: Worker): void {
    if (this.worker === worker) {
      this.worker = null;
      this.online = null;
    }
  }

  /**
   * Evaluate one file's content. `label` (usually the file path) is used in
   * error messages only. Rejects with RegexTimeoutError when the per-file or
   * cumulative budget is exhausted; the worker is terminated in that case.
   */
  async evaluate(
    request: RegexEvaluationRequest,
    label: string,
  ): Promise<RegexEvaluationResult> {
    const remainingTotal = this.totalTimeoutMs - this.spentMs;
    if (remainingTotal <= 0) {
      throw new RegexTimeoutError(this.totalTimeoutMessage(label));
    }
    const limitedByTotal = remainingTotal < this.fileTimeoutMs;
    const timeoutMs = limitedByTotal ? remainingTotal : this.fileTimeoutMs;

    // Worker start-up is not charged against the regex budget.
    await this.startWorker();
    const worker = this.worker;
    if (!worker) {
      throw new RegexEvaluationError("Regex worker is not available");
    }

    const id = this.nextId++;
    const startedAt = performance.now();
    let timer: NodeJS.Timeout | undefined;

    try {
      return await new Promise<RegexEvaluationResult>((resolve, reject) => {
        this.pending = { id, resolve, reject };
        timer = setTimeout(() => {
          if (!this.pending || this.pending.id !== id) return;
          this.pending = null;
          this.discardWorker(worker);
          // Fire-and-forget: terminate() stops the thread even while it is
          // stuck inside a backtracking match.
          void worker.terminate().catch(() => {});
          reject(
            new RegexTimeoutError(
              limitedByTotal
                ? this.totalTimeoutMessage(label)
                : `Regex evaluation timed out after ${this.fileTimeoutMs}ms in ${label} ` +
                    `(the pattern may cause catastrophic backtracking); simplify the pattern`,
            ),
          );
        }, timeoutMs);

        const message: Record<string, unknown> = {
          id,
          content: request.content,
          pattern: request.pattern,
          flags: request.flags,
          multiline: request.multiline,
          needLines: request.needLines,
          maxLineMatches:
            request.maxLineMatches === undefined
              ? null
              : request.maxLineMatches,
        };
        worker.postMessage(message);
      });
    } finally {
      if (timer) clearTimeout(timer);
      this.spentMs += performance.now() - startedAt;
    }
  }

  private totalTimeoutMessage(label: string): string {
    return (
      `Regex evaluation exceeded the total time budget of ${this.totalTimeoutMs}ms ` +
      `for this search (stopped at ${label}); the pattern may cause catastrophic ` +
      `backtracking - simplify the pattern or narrow the search path`
    );
  }

  /** Terminate the worker (if any). Safe to call multiple times. */
  async dispose(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    this.online = null;
    this.failPending(new RegexEvaluationError("Regex worker disposed"));
    if (worker) {
      worker.removeAllListeners("exit");
      worker.removeAllListeners("error");
      worker.on("error", () => {});
      await worker.terminate().catch(() => {});
    }
  }
}

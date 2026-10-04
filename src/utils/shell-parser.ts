/**
 * Conservative command-line parser for execute_shell.
 *
 * Commands run under `bash -c` (POSIX) or `powershell -Command` (Windows). The
 * approval and path checks are only sound if this parser sees at least every
 * command and every file operand the real shell will see. So it accepts a
 * small grammar both shells agree on and rejects everything else instead of
 * guessing:
 *
 * - simple commands joined by `;`, `&&`, `||` and `|`
 * - single- and double-quoted strings (backslash is never an escape)
 * - redirections, whose targets are reported so they can be path-validated
 *
 * Rejected: newlines and control characters, backticks, `\"` / `\'`, Unicode
 * quotes, a lone `&`, `(`/`)`/`{`/`}` grouping and script blocks, heredocs,
 * process substitution, and PowerShell's `--%` stop-parsing token.
 */

export class ShellSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShellSyntaxError";
  }
}

export interface ShellWord {
  /** Word text with quote characters removed. */
  value: string;
  /** True if any part of the word was quoted. */
  quoted: boolean;
  /** True if any part of the word was single-quoted (no variable expansion). */
  singleQuoted: boolean;
}

export interface ShellRedirect {
  operator: string;
  /** Target path, or null for fd duplication (2>&1) and null devices. */
  target: ShellWord | null;
}

export interface ShellSegment {
  words: ShellWord[];
  redirects: ShellRedirect[];
  /** Source text of the segment, for pattern checks. */
  raw: string;
}

export interface ParsedShellCommand {
  segments: ShellSegment[];
}

// Tab is allowed; everything else below 0x20, DEL, NEL and the Unicode line
// and paragraph separators can act as command separators.
const CONTROL_CHARS = /[\x00-\x08\x0a-\x1f\x7f\u0085\u2028\u2029]/;
// PowerShell treats these as quote characters; this parser does not.
const UNICODE_QUOTES = /[\u2018\u2019\u201a\u201b\u201c\u201d\u201e\u201f]/;
const NULL_DEVICES = new Set(["/dev/null", "$null", "nul"]);

export function parseShellCommand(command: string): ParsedShellCommand {
  if (CONTROL_CHARS.test(command)) {
    throw new ShellSyntaxError(
      "newlines and control characters are not allowed in commands (chain commands with ';' instead; '&&' also works in bash)",
    );
  }
  if (UNICODE_QUOTES.test(command)) {
    throw new ShellSyntaxError(
      "typographic (Unicode) quote characters are not allowed; use plain ' or \" quotes",
    );
  }
  if (command.includes("`")) {
    throw new ShellSyntaxError(
      "backticks are not allowed (command substitution in bash, escape character in PowerShell)",
    );
  }
  if (command.includes('\\"') || command.includes("\\'")) {
    throw new ShellSyntaxError(
      "backslash-escaped quotes are not allowed because bash and PowerShell interpret them differently",
    );
  }
  if (/(^|\s)--%(\s|$)/.test(command)) {
    throw new ShellSyntaxError(
      "the PowerShell stop-parsing token '--%' is not allowed",
    );
  }

  const segments: ShellSegment[] = [];
  let words: ShellWord[] = [];
  let redirects: ShellRedirect[] = [];
  let segmentStart = 0;
  let i = 0;

  const isWhitespace = (c: string) => c === " " || c === "\t";
  const isOperatorChar = (c: string) => ";|&<>(){}".includes(c);

  const endSegment = (end: number) => {
    const raw = command.slice(segmentStart, end).trim();
    if (words.length > 0 || redirects.length > 0) {
      segments.push({ words, redirects, raw });
    }
    words = [];
    redirects = [];
  };

  // Reads one word starting at i (quotes allowed); stops at whitespace or an
  // operator character outside quotes.
  const readWord = (): ShellWord | null => {
    let value = "";
    let quoted = false;
    let singleQuoted = false;
    let started = false;

    while (i < command.length) {
      const c = command[i];
      if (isWhitespace(c) || isOperatorChar(c)) {
        // `{}` as a standalone word (find -exec ... {} ;) is a literal.
        if (
          c === "{" &&
          command[i + 1] === "}" &&
          !started &&
          (i + 2 >= command.length || isWhitespace(command[i + 2]))
        ) {
          value += "{}";
          started = true;
          i += 2;
          continue;
        }
        // `${NAME}` parameter expansion stays part of the word.
        if (c === "{" && value.endsWith("$")) {
          const close = command.indexOf("}", i);
          if (close === -1) {
            throw new ShellSyntaxError("unterminated ${...} expansion");
          }
          value += command.slice(i, close + 1);
          i = close + 1;
          continue;
        }
        break;
      }
      if (c === "'" || c === '"') {
        const close = command.indexOf(c, i + 1);
        if (close === -1) {
          throw new ShellSyntaxError(`unterminated ${c} quote`);
        }
        value += command.slice(i + 1, close);
        quoted = true;
        started = true;
        if (c === "'") {
          singleQuoted = true;
        }
        i = close + 1;
        continue;
      }
      value += c;
      started = true;
      i++;
    }

    return started ? { value, quoted, singleQuoted } : null;
  };

  const readRedirect = () => {
    // A preceding unquoted all-digit word or `*` is the redirect's fd, not an argument.
    const previous = words[words.length - 1];
    const previousEnd = i > 0 ? command[i - 1] : " ";
    if (
      previous &&
      !previous.quoted &&
      !isWhitespace(previousEnd) &&
      /^(\d+|\*)$/.test(previous.value)
    ) {
      words.pop();
    }

    let operator = command[i];
    i++;
    if (operator === "<" && command[i] === "<") {
      throw new ShellSyntaxError("heredocs and here-strings are not allowed");
    }
    if (operator === "<" && command[i] === ">") {
      throw new ShellSyntaxError("'<>' redirection is not allowed");
    }
    if (operator === ">" && (command[i] === ">" || command[i] === "|")) {
      operator += command[i];
      i++;
    }

    // fd duplication: 2>&1, >&2, <&0, >&-
    if (command[i] === "&") {
      const fd = /^&(\d+|-)/.exec(command.slice(i));
      if (fd) {
        i += fd[0].length;
        redirects.push({ operator: `${operator}${fd[0]}`, target: null });
        return;
      }
      operator += "&";
      i++;
    }

    while (i < command.length && isWhitespace(command[i])) {
      i++;
    }
    const target = readWord();
    if (!target || !target.value) {
      throw new ShellSyntaxError(`redirection '${operator}' has no target`);
    }
    redirects.push({
      operator,
      target: NULL_DEVICES.has(target.value.toLowerCase()) ? null : target,
    });
  };

  while (i < command.length) {
    const c = command[i];

    if (isWhitespace(c)) {
      i++;
      continue;
    }

    if (c === ";") {
      endSegment(i);
      i++;
      segmentStart = i;
      continue;
    }

    if (c === "|") {
      endSegment(i);
      i += command[i + 1] === "|" ? 2 : 1;
      segmentStart = i;
      continue;
    }

    if (c === "&") {
      if (command[i + 1] === "&") {
        endSegment(i);
        i += 2;
        segmentStart = i;
        continue;
      }
      if (command[i + 1] === ">") {
        // bash `&>file` / `&>>file`: both streams to a file.
        i++;
        readRedirect();
        continue;
      }
      throw new ShellSyntaxError(
        "a single '&' (background job / PowerShell call operator) is not allowed; use ';' to chain commands ('&&' also works in bash)",
      );
    }

    if (c === ">" || c === "<") {
      if (command[i + 1] === "(") {
        throw new ShellSyntaxError("process substitution is not allowed");
      }
      readRedirect();
      continue;
    }

    if ("(){}".includes(c)) {
      const word = c === "{" ? readWord() : null;
      if (word) {
        words.push(word);
        continue;
      }
      throw new ShellSyntaxError(
        "grouping, subshells and script blocks ('(', ')', '{', '}') are not allowed outside quotes",
      );
    }

    const word = readWord();
    if (word) {
      words.push(word);
    }
  }

  endSegment(command.length);
  return { segments };
}

/** First word of every segment, in order, without duplicates. */
export function getRootCommands(parsed: ParsedShellCommand): string[] {
  const roots: string[] = [];
  for (const segment of parsed.segments) {
    const root = segment.words[0]?.value;
    if (root && !roots.includes(root)) {
      roots.push(root);
    }
  }
  return roots;
}

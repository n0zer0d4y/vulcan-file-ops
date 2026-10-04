import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
} from "@jest/globals";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { minimatch } from "minimatch";
import {
  grepFilesWithValidation,
  searchFilesWithValidation,
  setAllowedDirectories,
  getAllowedDirectories,
  setIgnoredFolders,
  getIgnoredFolders,
  validatePath,
  shouldIgnoreFolder,
  normalizeLineEndings,
  MAX_GREP_PATTERN_LENGTH,
  MAX_GLOB_PATTERN_LENGTH,
  DEFAULT_GREP_REGEX_FILE_TIMEOUT_MS,
  DEFAULT_GREP_REGEX_TOTAL_TIMEOUT_MS,
  type GrepOptions,
  type GrepResult,
  type GrepMatch,
} from "../utils/lib.js";
import { handleSearchTool } from "../tools/search-tools.js";

/**
 * Reference: the pre-VFO-14 in-thread implementation of grepFilesWithValidation
 * (fileType and size filters omitted; they are unchanged and not exercised
 * here). The worker-based implementation must produce identical results.
 */
async function referenceGrep(
  pattern: string,
  searchPath: string,
  options: GrepOptions = {},
): Promise<GrepResult> {
  const {
    caseInsensitive = false,
    contextBefore = 0,
    contextAfter = 0,
    outputMode = "content",
    headLimit,
    multiline = false,
    globPattern,
  } = options;

  const flags = caseInsensitive ? "i" : "";
  const dotAllFlag = multiline ? "s" : "";
  const regex = new RegExp(pattern, flags + dotAllFlag);

  const result: GrepResult = {
    mode: outputMode,
    matches: outputMode === "content" ? [] : undefined,
    files: outputMode === "files_with_matches" ? [] : undefined,
    counts: outputMode === "count" ? new Map() : undefined,
    totalMatches: 0,
    filesSearched: 0,
  };

  const stats = await fs.stat(searchPath);

  function withContext(lines: string[], i: number, filePath: string) {
    const match: GrepMatch = { file: filePath, line: i + 1, content: lines[i] };
    if (contextBefore > 0) {
      match.contextBefore = [];
      for (let j = Math.max(0, i - contextBefore); j < i; j++) {
        match.contextBefore.push(lines[j]);
      }
    }
    if (contextAfter > 0) {
      match.contextAfter = [];
      for (
        let j = i + 1;
        j < Math.min(lines.length, i + 1 + contextAfter);
        j++
      ) {
        match.contextAfter.push(lines[j]);
      }
    }
    return match;
  }

  async function searchFile(filePath: string): Promise<void> {
    try {
      await validatePath(filePath);
    } catch {
      return;
    }
    if (globPattern) {
      const relativePath = path.relative(searchPath, filePath);
      const matchBase = !/[\\/]/.test(globPattern);
      if (!minimatch(relativePath, globPattern, { dot: true, matchBase })) return;
    }
    result.filesSearched++;
    const content = await fs.readFile(filePath, "utf-8");
    let fileMatchCount = 0;
    let fileHasMatch = false;

    if (multiline) {
      const matches = content.match(new RegExp(pattern, flags + "g"));
      if (matches) {
        fileHasMatch = true;
        fileMatchCount = matches.length;
        result.totalMatches += matches.length;
        if (outputMode === "content") {
          const lines = normalizeLineEndings(content).split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              if (headLimit && result.matches!.length >= headLimit) break;
              result.matches!.push(withContext(lines, i, filePath));
            }
          }
        }
      }
    } else {
      const lines = normalizeLineEndings(content).split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          fileHasMatch = true;
          fileMatchCount++;
          result.totalMatches++;
          if (outputMode === "content") {
            if (headLimit && result.matches!.length >= headLimit) break;
            result.matches!.push(withContext(lines, i, filePath));
          }
        }
      }
    }

    if (outputMode === "files_with_matches" && fileHasMatch) {
      if (!headLimit || result.files!.length < headLimit) {
        result.files!.push(filePath);
      }
    }
    if (outputMode === "count" && fileMatchCount > 0) {
      result.counts!.set(filePath, fileMatchCount);
    }
  }

  async function searchDirectory(dirPath: string, depth = 0): Promise<void> {
    if (depth > 10) return;
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory() && shouldIgnoreFolder(entry.name)) continue;
      if (entry.isDirectory()) {
        await searchDirectory(fullPath, depth + 1);
      } else if (entry.isFile()) {
        await searchFile(fullPath);
        if (headLimit) {
          if (outputMode === "content" && result.matches!.length >= headLimit)
            return;
          if (
            outputMode === "files_with_matches" &&
            result.files!.length >= headLimit
          )
            return;
        }
      }
    }
  }

  if (stats.isDirectory()) {
    await searchDirectory(searchPath);
  } else {
    await searchFile(searchPath);
  }
  return result;
}

const CATASTROPHIC_PATTERN = "^(a+)+$";
const CATASTROPHIC_CONTENT = "a".repeat(40) + "!";

describe("grep_files ReDoS hardening (VFO-14)", () => {
  const originalAllowed = getAllowedDirectories();
  const originalIgnored = getIgnoredFolders();
  let root: string;
  let normalDir: string;
  let evilDir: string;
  let multiEvilDir: string;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "grep-redos-"));
    normalDir = path.join(root, "normal");
    evilDir = path.join(root, "evil");
    multiEvilDir = path.join(root, "multi-evil");
    await fs.mkdir(path.join(normalDir, "sub", "deeper"), { recursive: true });
    await fs.mkdir(evilDir, { recursive: true });
    await fs.mkdir(multiEvilDir, { recursive: true });

    await fs.writeFile(
      path.join(normalDir, "a.txt"),
      "foo bar\nFOO baz\n  bar foo foo\nqux\nfoo\nend of a",
    );
    await fs.writeFile(
      path.join(normalDir, "b.js"),
      "function foo() {\n  return bar;\n}\n\nconst x = 'Foo';\nfoo();\n",
    );
    await fs.writeFile(
      path.join(normalDir, "crlf.txt"),
      "line one foo\r\nline two\r\nbar line three\r\nfoo\r\n",
    );
    await fs.writeFile(
      path.join(normalDir, "sub", "c.md"),
      "# foo\nsome text\nbar\nfoo bar foo\n",
    );
    await fs.writeFile(
      path.join(normalDir, "sub", "deeper", "d.txt"),
      "nothing here\nfoo\nbar\nbaz\nfoo\nbar\nfoo",
    );
    await fs.writeFile(path.join(normalDir, "empty.txt"), "");

    await fs.writeFile(path.join(evilDir, "evil.txt"), CATASTROPHIC_CONTENT);
    for (const name of ["e1.txt", "e2.txt", "e3.txt"]) {
      await fs.writeFile(path.join(multiEvilDir, name), CATASTROPHIC_CONTENT);
    }

    setAllowedDirectories([root]);
    setIgnoredFolders([]);
  });

  afterAll(async () => {
    setAllowedDirectories(originalAllowed);
    setIgnoredFolders(originalIgnored);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("exports tunable defaults", () => {
    expect(DEFAULT_GREP_REGEX_FILE_TIMEOUT_MS).toBe(5000);
    expect(DEFAULT_GREP_REGEX_TOTAL_TIMEOUT_MS).toBe(30000);
    expect(MAX_GREP_PATTERN_LENGTH).toBe(1000);
    expect(MAX_GLOB_PATTERN_LENGTH).toBe(1000);
  });

  describe("catastrophic backtracking", () => {
    it("times out a catastrophic pattern within budget", async () => {
      const ticks: number[] = [];
      const interval = setInterval(() => ticks.push(Date.now()), 50);
      const started = Date.now();
      try {
        await expect(
          grepFilesWithValidation(CATASTROPHIC_PATTERN, evilDir, [root], {
            regexFileTimeoutMs: 500,
          }),
        ).rejects.toThrow(
          /Regex evaluation timed out after 500ms in .*evil\.txt \(the pattern may cause catastrophic backtracking\); simplify the pattern/,
        );
      } finally {
        clearInterval(interval);
      }
      const elapsed = Date.now() - started;
      expect(elapsed).toBeLessThan(5000);
      expect(elapsed).toBeGreaterThanOrEqual(450);
      // The main event loop kept running while the worker was stuck.
      expect(ticks.length).toBeGreaterThanOrEqual(3);
    });

    it("times out a catastrophic pattern in multiline mode", async () => {
      const started = Date.now();
      await expect(
        grepFilesWithValidation(CATASTROPHIC_PATTERN, evilDir, [root], {
          multiline: true,
          outputMode: "count",
          regexFileTimeoutMs: 500,
        }),
      ).rejects.toThrow(/timed out after 500ms in .*evil\.txt/);
      expect(Date.now() - started).toBeLessThan(5000);
    });

    it("times out when given a single file path", async () => {
      await expect(
        grepFilesWithValidation(
          CATASTROPHIC_PATTERN,
          path.join(evilDir, "evil.txt"),
          [root],
          { regexFileTimeoutMs: 300, outputMode: "files_with_matches" },
        ),
      ).rejects.toThrow(/timed out after 300ms/);
    });

    it("enforces the total budget across files", async () => {
      const started = Date.now();
      await expect(
        grepFilesWithValidation(CATASTROPHIC_PATTERN, multiEvilDir, [root], {
          regexFileTimeoutMs: 2000,
          regexTotalTimeoutMs: 400,
        }),
      ).rejects.toThrow(/exceeded the total time budget of 400ms/);
      expect(Date.now() - started).toBeLessThan(5000);
    });

    it("works normally after a timed-out search", async () => {
      await expect(
        grepFilesWithValidation(CATASTROPHIC_PATTERN, evilDir, [root], {
          regexFileTimeoutMs: 300,
        }),
      ).rejects.toThrow(/timed out/);

      const result = await grepFilesWithValidation("foo", normalDir, [root]);
      const expected = await referenceGrep("foo", normalDir);
      expect(result).toEqual(expected);
      expect(result.totalMatches).toBeGreaterThan(0);

      // A benign pattern over the "evil" content still evaluates fine.
      const benign = await grepFilesWithValidation("a+!", evilDir, [root], {
        regexFileTimeoutMs: 300,
      });
      expect(benign.totalMatches).toBe(1);
    });

    it("serves benign grep_files tool calls over hostile content", async () => {
      // The handler always uses the default 5s budget, so the timeout path is
      // covered above via the options override; here we only check that a
      // benign call through the handler is unaffected.
      const response = await handleSearchTool("grep_files", {
        pattern: "a+!",
        path: evilDir,
      });
      expect(response.content[0].text).toContain("evil.txt");
    });
  });

  describe("output identical to the previous in-thread implementation", () => {
    const patterns = [
      "foo",
      "f.o",
      "^\\s*bar",
      "o",
      "x*",
      "foo\\nbar",
      "bar.foo",
      "foo$",
    ];
    const modes: Array<GrepOptions["outputMode"]> = [
      "content",
      "files_with_matches",
      "count",
    ];
    const headLimits = [undefined, 1, 3];

    const cases: Array<[string, GrepOptions]> = [];
    let n = 0;
    for (const pattern of patterns) {
      for (const outputMode of modes) {
        for (const multiline of [false, true]) {
          for (const headLimit of headLimits) {
            n++;
            cases.push([
              pattern,
              {
                outputMode,
                multiline,
                headLimit,
                caseInsensitive: n % 2 === 0,
                contextBefore: n % 3 === 0 ? 1 : 0,
                contextAfter: n % 4 === 0 ? 2 : 0,
              },
            ]);
          }
        }
      }
    }
    // A few explicit combinations of interest.
    cases.push(["foo", { caseInsensitive: true, contextBefore: 2, contextAfter: 2 }]);
    cases.push(["foo", { globPattern: "**/*.txt" }]);
    cases.push(["foo", { globPattern: "*.js", outputMode: "count" }]);
    cases.push(["foo\\r?\\nbar", { multiline: true, headLimit: 2 }]);
    cases.push(["bar.*?foo", { multiline: true, caseInsensitive: true }]);

    it(`matches the reference for ${cases.length} option combinations`, async () => {
      for (const [pattern, options] of cases) {
        const actual = await grepFilesWithValidation(
          pattern,
          normalDir,
          [root],
          options,
        );
        const expected = await referenceGrep(pattern, normalDir, options);
        try {
          expect(actual).toEqual(expected);
        } catch (error) {
          throw new Error(
            `Mismatch for pattern ${JSON.stringify(pattern)} with ${JSON.stringify(
              options,
            )}: ${(error as Error).message}`,
          );
        }
      }
    }, 60000);

    it("matches the reference for a single-file search", async () => {
      const file = path.join(normalDir, "crlf.txt");
      for (const multiline of [false, true]) {
        const options: GrepOptions = { multiline, contextAfter: 1 };
        expect(
          await grepFilesWithValidation("foo|bar", file, [root], options),
        ).toEqual(await referenceGrep("foo|bar", file, options));
      }
    });
  });

  describe("input validation", () => {
    it("keeps the invalid regex error unchanged", async () => {
      let expectedMessage = "";
      try {
        new RegExp("[invalid(regex", "");
      } catch (error) {
        expectedMessage = (error as Error).message;
      }
      await expect(
        grepFilesWithValidation("[invalid(regex", normalDir, [root]),
      ).rejects.toThrow(
        `Invalid regex pattern: [invalid(regex - ${expectedMessage}`,
      );
    });

    it("rejects grep patterns over the length cap", async () => {
      const ok = "a".repeat(MAX_GREP_PATTERN_LENGTH);
      await expect(
        grepFilesWithValidation(ok, normalDir, [root]),
      ).resolves.toBeDefined();

      await expect(
        grepFilesWithValidation(ok + "a", normalDir, [root]),
      ).rejects.toThrow(
        `Regex pattern is too long (${MAX_GREP_PATTERN_LENGTH + 1} characters); the maximum is ${MAX_GREP_PATTERN_LENGTH}`,
      );
    });

    it("rejects grep glob filters over the length cap", async () => {
      await expect(
        grepFilesWithValidation("foo", normalDir, [root], {
          globPattern: "*".repeat(MAX_GLOB_PATTERN_LENGTH + 1),
        }),
      ).rejects.toThrow(/Glob pattern is too long/);
    });

    it("rejects glob_files patterns over the length cap", async () => {
      await expect(
        searchFilesWithValidation(
          normalDir,
          "*".repeat(MAX_GLOB_PATTERN_LENGTH + 1),
          [root],
        ),
      ).rejects.toThrow(
        `Glob pattern is too long (${MAX_GLOB_PATTERN_LENGTH + 1} characters); the maximum is ${MAX_GLOB_PATTERN_LENGTH}`,
      );

      await expect(
        handleSearchTool("glob_files", {
          path: normalDir,
          pattern: "a".repeat(MAX_GLOB_PATTERN_LENGTH + 1),
        }),
      ).rejects.toThrow(/Glob pattern is too long/);
    });

    it("rejects glob_files exclude patterns over the length cap", async () => {
      await expect(
        searchFilesWithValidation(normalDir, "*.txt", [root], {
          excludePatterns: ["*.md", "x".repeat(MAX_GLOB_PATTERN_LENGTH + 1)],
        }),
      ).rejects.toThrow(/Exclude pattern is too long/);

      const ok = await searchFilesWithValidation(normalDir, "*.txt", [root], {
        excludePatterns: ["x".repeat(MAX_GLOB_PATTERN_LENGTH)],
      });
      expect(ok.length).toBeGreaterThan(0);
    });

    it("rejects over-long patterns through the grep_files tool handler", async () => {
      await expect(
        handleSearchTool("grep_files", {
          pattern: "a".repeat(MAX_GREP_PATTERN_LENGTH + 1),
          path: normalDir,
        }),
      ).rejects.toThrow(/Regex pattern is too long/);
    });
  });
});

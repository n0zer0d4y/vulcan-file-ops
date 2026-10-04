import {
  describe,
  test,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
} from "@jest/globals";
import os from "os";
import path from "path";
import { promises as fs, realpathSync, existsSync } from "fs";
import { initializeShellTool, handleShellTool } from "../tools/shell-tool.js";
import { setAllowedDirectories, getAllowedDirectories } from "../utils/lib.js";
import {
  parseShellCommand,
  getRootCommands,
  ShellSyntaxError,
} from "../utils/shell-parser.js";

const isWindows = process.platform === "win32";
const LINK_TYPE = isWindows ? "junction" : "dir";

describe("shell parser", () => {
  test("splits segments on ; && || and |", () => {
    const parsed = parseShellCommand("a 1; b 2 && c || d | e");
    expect(getRootCommands(parsed)).toEqual(["a", "b", "c", "d", "e"]);
  });

  test("keeps quoted separators inside a single argument", () => {
    const parsed = parseShellCommand(`echo "x; y && z" 'p | q'`);
    expect(getRootCommands(parsed)).toEqual(["echo"]);
    expect(parsed.segments[0].words.map((w) => w.value)).toEqual([
      "echo",
      "x; y && z",
      "p | q",
    ]);
  });

  test("reports redirection targets and treats fd duplication and null devices as non-paths", () => {
    const parsed = parseShellCommand("echo a >out.txt 2>&1 2>/dev/null");
    const redirects = parsed.segments[0].redirects;
    expect(redirects[0].target?.value).toBe("out.txt");
    expect(redirects[1].target).toBeNull();
    expect(redirects[2].target).toBeNull();
    expect(parsed.segments[0].words.map((w) => w.value)).toEqual(["echo", "a"]);
  });

  test("an attached redirection is split from the preceding word", () => {
    const parsed = parseShellCommand("echo hi>out.txt");
    expect(parsed.segments[0].words.map((w) => w.value)).toEqual(["echo", "hi"]);
    expect(parsed.segments[0].redirects[0].target?.value).toBe("out.txt");
  });

  test("allows ${VAR} expansion and a standalone {} word", () => {
    expect(() => parseShellCommand("echo ${HOME}")).not.toThrow();
    expect(() => parseShellCommand("find . -name x -exec echo {} ;")).not.toThrow();
  });

  test.each([
    ["newline", "echo a\nhostname"],
    ["carriage return", "echo a\r\nhostname"],
    ["unicode line separator", `echo a${String.fromCharCode(0x2028)}hostname`],
    ["NUL", "echo a\u0000b"],
    ["lone ampersand", "echo a & hostname"],
    ["parentheses", "(hostname)"],
    ["braces", "echo a; { hostname; }"],
    ["backtick", "echo `hostname`"],
    ["escaped double quote", 'echo "\\"; hostname; echo \\""'],
    ["escaped single quote", "echo \\'; hostname; echo \\'"],
    ["heredoc", "cat <<EOF"],
    ["unicode quote", `echo ${String.fromCharCode(0x201c)}a${String.fromCharCode(0x201d)}`],
    ["stop-parsing token", "echo --% a"],
    ["unterminated quote", 'echo "abc'],
    ["redirect without target", "echo a >"],
  ])("rejects %s", (_name, command) => {
    expect(() => parseShellCommand(command)).toThrow(ShellSyntaxError);
  });
});

describe("execute_shell hardening", () => {
  const originalAllowed = getAllowedDirectories();
  let root: string;
  let allowedDir: string;
  let outsideDir: string;
  let outsideCanary: string;

  beforeAll(async () => {
    root = realpathSync(await fs.mkdtemp(path.join(os.tmpdir(), "vulcan-shell-")));
    allowedDir = path.join(root, "allowed");
    outsideDir = path.join(root, "outside");
    await fs.mkdir(allowedDir);
    await fs.mkdir(outsideDir);
    outsideCanary = path.join(outsideDir, "canary.txt");
    await fs.writeFile(outsideCanary, "OUTSIDE-CANARY");
    await fs.writeFile(path.join(allowedDir, "inside.txt"), "INSIDE");
    await fs.symlink(outsideDir, path.join(allowedDir, "link"), LINK_TYPE);
  });

  beforeEach(() => {
    setAllowedDirectories([allowedDir]);
    initializeShellTool(["echo", "cat", "cd", "hostname"]);
  });

  afterAll(async () => {
    setAllowedDirectories(originalAllowed);
    initializeShellTool([]);
    await fs.rm(root, { recursive: true, force: true });
  });

  const run = (command: string, extra: Record<string, unknown> = {}) =>
    handleShellTool("execute_shell", { command, workdir: allowedDir, ...extra });

  test("VFO-01: a newline cannot smuggle an unapproved command past the allowlist", async () => {
    initializeShellTool(["echo"]);
    await expect(run("echo a\nhostname")).rejects.toThrow(/newlines/);
    await expect(run("echo a\r\nhostname")).rejects.toThrow(/newlines/);
  });

  test("VFO-02: slash-prefixed absolute paths are validated, not treated as switches", async () => {
    const slashPath = isWindows
      ? outsideCanary.slice(path.parse(outsideCanary).root.length - 1).replace(/\\/g, "/")
      : outsideCanary;
    // Only meaningful on Windows when the temp dir is on the current drive.
    if (isWindows && path.parse(outsideCanary).root[0].toLowerCase() !== process.cwd()[0].toLowerCase()) {
      return;
    }
    await expect(run(`cat ${slashPath}`)).rejects.toThrow(/Access denied/);
  });

  test("VFO-03: attached redirection targets outside the sandbox are blocked", async () => {
    const target = path.join(outsideDir, "written.txt");
    await expect(run(`echo x >${target}`)).rejects.toThrow(/Access denied/);
    await expect(run(`echo x>${target}`)).rejects.toThrow(/Access denied/);
    expect(existsSync(target)).toBe(false);
  });

  test("redirection inside the sandbox is allowed", async () => {
    const result = await run("echo ok >inside-out.txt");
    expect(result.isError).toBe(false);
    expect(existsSync(path.join(allowedDir, "inside-out.txt"))).toBe(true);
  });

  test("fd duplication (2>&1) is allowed", async () => {
    const result = await run("echo ok 2>&1");
    expect(result.isError).toBe(false);
  });

  test("GH-3 / VFO-04: paths through a symlink or junction to outside are blocked", async () => {
    await expect(run("cat link/canary.txt")).rejects.toThrow(/Access denied/);
    await expect(run(`cat ${path.join("link", "canary.txt")}`)).rejects.toThrow(
      /Access denied/
    );
  });

  test("plain relative paths inside the sandbox still work", async () => {
    const result = await run("cat inside.txt");
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("INSIDE");
  });

  test("cd into a parent directory is validated", async () => {
    await expect(run("cd ..; cat outside/canary.txt")).rejects.toThrow(
      /Access denied/
    );
  });

  test("relative paths are checked against every possible working directory", async () => {
    await fs.mkdir(path.join(allowedDir, "a", "b"), { recursive: true });
    // Fine relative to a/b, but escapes if the cd does not take effect.
    await expect(run("cd a/b; cat ../../inside.txt")).rejects.toThrow(
      /Access denied/
    );
  });

  test("arguments with unresolvable variables are refused", async () => {
    await expect(
      run("cat $VULCAN_TEST_UNSET_VARIABLE_XYZ/inside.txt")
    ).rejects.toThrow(/cannot be resolved/);
  });

  test("option values that point outside are validated", async () => {
    await expect(run(`echo --out=${outsideCanary}`)).rejects.toThrow(
      /Access denied/
    );
  });

  (isWindows ? test : test.skip)(
    "PowerShell provider paths are refused on Windows",
    async () => {
      await expect(run("cat env:PATH")).rejects.toThrow(/provider paths/);
    }
  );

  test("VFO-06: requiresApproval no longer bypasses dangerous-pattern blocking", async () => {
    initializeShellTool(["echo"]);
    await expect(
      run("echo sudo-word", { requiresApproval: true })
    ).rejects.toThrow(/Dangerous command pattern/);
  });

  test("VFO-06: the operator allowlist permits a dangerous-pattern command", async () => {
    initializeShellTool(["echo"], ["echo"]);
    const result = await run("echo sudo-word");
    expect(result.isError).toBe(false);
  });

  test("Get-Date -Format is no longer a false positive", async () => {
    initializeShellTool(["echo"]);
    const result = await run("echo -Format yyyy");
    expect(result.isError).toBe(false);
  });
});

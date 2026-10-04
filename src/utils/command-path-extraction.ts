import path from "path";
import os from "os";
import fs from "fs/promises";
import { isPathCanonicallyAllowed } from "./lib.js";
import type { ParsedShellCommand, ShellWord } from "./shell-parser.js";

/**
 * Finds file system operands of a parsed shell command that resolve outside
 * the allowed directories (lexically, through symlinks/junctions, or after
 * physical "..").
 *
 * An argument is treated as a path if it looks like one (absolute, drive,
 * UNC, ~, ./ ../, contains a separator) or if it names something that exists
 * relative to the working directory. Relative operands are checked against
 * every working directory the command might be in, because a cd/pushd can
 * fail or (in a pipeline) not persist.
 */

const CD_COMMANDS = new Set([
  "cd",
  "chdir",
  "pushd",
  "set-location",
  "sl",
  "push-location",
]);

// PowerShell provider drives that are not the file system.
const POWERSHELL_PROVIDER_PATH =
  /^(env|hklm|hkcu|hkcr|hku|hkcc|cert|function|variable|alias|wsman|temp):/i;

const URL_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;

interface ExpandedWord {
  value: string;
  unresolved: boolean;
}

function expandVariables(word: ShellWord): ExpandedWord {
  // Single quotes suppress expansion in both bash and PowerShell.
  if (word.singleQuoted) {
    return { value: word.value, unresolved: false };
  }

  let unresolved = false;
  const lookup = (name: string) => {
    const value = process.env[name];
    if (value === undefined) {
      unresolved = true;
      return "";
    }
    return value;
  };

  let value = word.value
    .replace(/\$env:([A-Za-z_][A-Za-z0-9_]*)/gi, (_, name) => lookup(name))
    .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => lookup(name))
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, name) => lookup(name));

  // Anything else that still looks like an expansion cannot be validated.
  if (/\$[A-Za-z_{]/.test(value)) {
    unresolved = true;
  }

  if (!word.quoted) {
    if (value === "~") {
      value = os.homedir();
    } else if (value.startsWith("~/") || value.startsWith("~\\")) {
      value = path.join(os.homedir(), value.slice(2));
    }
  }

  return { value, unresolved };
}

function looksLikePath(value: string): boolean {
  if (!value || URL_PATTERN.test(value)) {
    return false;
  }
  return (
    path.isAbsolute(value) ||
    /^[A-Za-z]:/.test(value) ||
    value.startsWith("\\\\") ||
    value === "." ||
    value === ".." ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith(".\\") ||
    value.startsWith("..\\") ||
    value.includes("/") ||
    value.includes("\\")
  );
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p);
    return true;
  } catch {
    return false;
  }
}

/** Value attached to an option, e.g. --out=X, -Path:X, -C:\X, -I../X. */
function attachedOptionValue(flag: string): string | null {
  const drive = /^-[A-Za-z]([A-Za-z]:[\\/].*)$/.exec(flag);
  if (drive) {
    return drive[1];
  }
  const assigned = /^-{1,2}[A-Za-z][\w-]*[=:](.+)$/.exec(flag);
  if (assigned && looksLikePath(assigned[1])) {
    return assigned[1];
  }
  const short = /^-[A-Za-z](.+)$/.exec(flag);
  if (short && looksLikePath(short[1])) {
    return short[1];
  }
  return null;
}

export async function findDisallowedCommandPaths(
  parsed: ParsedShellCommand,
  workdir: string,
): Promise<string[]> {
  const denied = new Set<string>();
  const possibleCwds = [workdir];

  const checkPath = async (candidate: string) => {
    const bases = path.isAbsolute(candidate) ? [workdir] : possibleCwds;
    for (const base of bases) {
      if (!(await isPathCanonicallyAllowed(candidate, base))) {
        denied.add(
          path.isAbsolute(candidate) ? candidate : path.join(base, candidate),
        );
        return false;
      }
    }
    return true;
  };

  const resolveWord = (word: ShellWord): string | null => {
    const expanded = expandVariables(word);
    if (expanded.unresolved) {
      denied.add(
        `${word.value} (contains a variable reference that cannot be resolved for validation)`,
      );
      return null;
    }
    if (
      process.platform === "win32" &&
      (POWERSHELL_PROVIDER_PATH.test(expanded.value) ||
        expanded.value.includes("::"))
    ) {
      denied.add(`${expanded.value} (PowerShell provider paths are not allowed)`);
      return null;
    }
    return expanded.value;
  };

  for (const segment of parsed.segments) {
    const [rootWord, ...args] = segment.words;
    const root = rootWord ? rootWord.value.toLowerCase() : "";
    const candidates: string[] = [];
    const operands: string[] = [];

    for (const word of args) {
      const value = resolveWord(word);
      if (value === null || value === "" || URL_PATTERN.test(value)) {
        continue;
      }

      if (value.startsWith("-")) {
        const attached = attachedOptionValue(value);
        if (attached) {
          candidates.push(attached);
        }
        continue;
      }

      operands.push(value);

      // On Windows "/x" is either a switch or a path on the current drive.
      if (
        process.platform === "win32" &&
        value.startsWith("/") &&
        !/[\\/]/.test(value.slice(1))
      ) {
        if (await exists(path.resolve(value))) {
          candidates.push(value);
        }
        continue;
      }

      if (looksLikePath(value)) {
        candidates.push(value);
        continue;
      }

      for (const base of possibleCwds) {
        if (await exists(path.join(base, value))) {
          candidates.push(value);
          break;
        }
      }
    }

    for (const redirect of segment.redirects) {
      if (!redirect.target) {
        continue;
      }
      const value = resolveWord(redirect.target);
      if (value) {
        candidates.push(value);
      }
    }

    for (const candidate of candidates) {
      await checkPath(candidate);
    }

    if (CD_COMMANDS.has(root)) {
      const target = operands[0] ?? os.homedir();
      if (target === "-") {
        denied.add("cd - (previous directory cannot be validated)");
        continue;
      }
      if (await checkPath(target)) {
        for (const base of [...possibleCwds]) {
          const next = path.resolve(base, target);
          if (!possibleCwds.includes(next)) {
            possibleCwds.push(next);
          }
        }
      }
    }
  }

  return [...denied];
}

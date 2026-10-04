import os from "os";
import {
  parseShellCommand,
  getRootCommands,
  ShellSyntaxError,
  type ParsedShellCommand,
} from "./shell-parser.js";

/**
 * Dangerous command patterns. Matching commands are blocked unless the
 * operator allowed the root command with --allow-dangerous-commands.
 */
const DANGEROUS_PATTERNS = [
  // Destructive operations
  /\brm\b.*-rf?\b/i,
  /\bdel\b.*\/s\b/i,
  /\b(rd|rmdir)\b.*\/s\b/i,
  /\bremove-item\b.*-recurse\b/i,
  /\bformat(\.com)?\s+[a-z]:/i,
  /\bformat-volume\b/i,
  /\bclear-disk\b/i,
  /\bmkfs\b/i,

  // System modifications
  /\bsudo\b/i,
  /\bsu\b/i,
  /\bchmod\b.*777/i,

  // Package operations
  /\b(apt|yum|dnf|brew)\s+(install|remove|purge)/i,
  /\bnpm\s+(install|uninstall)\s+-g/i,
  /\bpip\s+install/i,

  // Network operations
  /\bcurl\b.*\|\s*(bash|sh)/i,
  /\bwget\b.*\|\s*(bash|sh)/i,

  // Process operations
  /\bkill\s+-9/i,
  /\bkillall/i,
];

/**
 * Command substitution patterns (security risk)
 */
const COMMAND_SUBSTITUTION_PATTERNS = [
  /\$\([^)]*\)/, // $(command)
  /`[^`]*`/, // `command`
  /<\([^)]*\)/, // <(command)
  />\([^)]*\)/, // >(command)
];

/**
 * Extract the root command of every segment of a shell command.
 * Examples:
 *   "ls -la" -> ["ls"]
 *   "npm install && npm start" -> ["npm"]
 *   'echo "a; b"' -> ["echo"]   (quoted text is an argument, not a command)
 *
 * Uses the conservative shell parser. If the command is outside the accepted
 * grammar (validateCommand rejects those), falls back to splitting on every
 * separator, including newlines, so the result never under-reports commands.
 */
export function extractRootCommands(command: string): string[] {
  try {
    return getRootCommands(parseShellCommand(command));
  } catch (error) {
    if (!(error instanceof ShellSyntaxError)) {
      throw error;
    }
  }

  const roots: string[] = [];
  const segments = command
    .split(/[;&|\r\n\u0085\u2028\u2029]/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const segment of segments) {
    const firstWord = segment.split(/\s+/)[0];
    if (firstWord && !roots.includes(firstWord)) {
      roots.push(firstWord);
    }
  }
  return roots;
}

/**
 * Check if command contains dangerous patterns
 */
export function isDangerousCommand(command: string): boolean {
  return DANGEROUS_PATTERNS.some((pattern) => pattern.test(command));
}

/**
 * Root commands of the segments that match a dangerous pattern. If the
 * pattern only matches across segments (e.g. a download piped into a shell),
 * every root command is returned.
 */
export function getDangerousRoots(parsed: ParsedShellCommand): string[] {
  const roots = new Set<string>();
  for (const segment of parsed.segments) {
    if (isDangerousCommand(segment.raw) && segment.words[0]) {
      roots.add(segment.words[0].value);
    }
  }
  if (roots.size === 0) {
    const whole = parsed.segments.map((s) => s.raw).join(" | ");
    if (isDangerousCommand(whole)) {
      return getRootCommands(parsed);
    }
  }
  return [...roots];
}

/**
 * Check if command contains command substitution
 */
export function hasCommandSubstitution(command: string): boolean {
  return COMMAND_SUBSTITUTION_PATTERNS.some((pattern) => pattern.test(command));
}

/**
 * Validate command against security policies
 */
export function validateCommand(
  command: string,
  allowCommandSubstitution: boolean = false
): { allowed: boolean; reason?: string } {
  if (!command || !command.trim()) {
    return { allowed: false, reason: "Command cannot be empty" };
  }

  // Check for command substitution
  if (!allowCommandSubstitution && hasCommandSubstitution(command)) {
    return {
      allowed: false,
      reason:
        "Command substitution using $(), ``, <(), or >() is not allowed for security reasons",
    };
  }

  // Structural check: only the conservative grammar is accepted. (Skipped
  // when substitution is explicitly allowed, which execute_shell never does.)
  if (!allowCommandSubstitution) {
    try {
      parseShellCommand(command);
    } catch (error) {
      if (error instanceof ShellSyntaxError) {
        return {
          allowed: false,
          reason: `Unsupported shell syntax: ${error.message}`,
        };
      }
      throw error;
    }
  }

  // Extract root commands for approval checking
  const roots = extractRootCommands(command);
  if (roots.length === 0) {
    return {
      allowed: false,
      reason: "Could not identify command root for security validation",
    };
  }

  return { allowed: true };
}

/**
 * Check if command is in approved list
 */
export function isCommandApproved(
  command: string,
  approvedCommands: Set<string>
): boolean {
  const roots = extractRootCommands(command);
  return roots.every((root) => approvedCommands.has(root));
}

/**
 * Get platform-specific shell configuration
 */
export function getShellConfig(): {
  shell: string;
  args: string[];
  platform: string;
} {
  const platform = os.platform();

  if (platform === "win32") {
    return {
      shell: "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-Command"],
      platform: "Windows",
    };
  } else {
    return {
      shell: "bash",
      args: ["-c"],
      platform: "Unix/Mac",
    };
  }
}

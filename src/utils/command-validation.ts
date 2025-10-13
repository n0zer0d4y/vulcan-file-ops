import os from "os";

/**
 * Dangerous command patterns that should trigger approval
 */
const DANGEROUS_PATTERNS = [
  // Destructive operations
  /\brm\b.*-rf?\b/i,
  /\bdel\b.*\/s\b/i,
  /\bformat\b/i,
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
 * Extract root command from shell command string
 * Examples:
 *   "ls -la" -> "ls"
 *   "npm install && npm start" -> ["npm", "npm"]
 *   "sudo apt install" -> ["sudo", "apt"]
 */
export function extractRootCommands(command: string): string[] {
  const roots: string[] = [];

  // Split by common shell operators
  const segments = command
    .split(/[;&|]/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const segment of segments) {
    // Remove leading/trailing whitespace and extract first word
    const firstWord = segment.trim().split(/\s+/)[0];
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

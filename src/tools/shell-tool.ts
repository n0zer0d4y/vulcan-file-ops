import { zodToJsonSchema } from "zod-to-json-schema";
import { ToolSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  ShellCommandArgsSchema,
  type ShellCommandArgs,
} from "../types/index.js";
import {
  validateCommand,
  getDangerousRoots,
  getShellConfig,
} from "../utils/command-validation.js";
import {
  executeShellCommand,
  type ExecutionResult,
} from "../utils/shell-execution.js";
import { validatePath, getAllowedDirectories } from "../utils/lib.js";
import { findDisallowedCommandPaths } from "../utils/command-path-extraction.js";
import { parseShellCommand, getRootCommands } from "../utils/shell-parser.js";
import { sanitizeToolInputSchema } from "../utils/tool-schema.js";

const ToolInputSchema = ToolSchema.shape.inputSchema;
type ToolInput = any;

// Global state for approved commands
let approvedCommands: Set<string> = new Set();
let alwaysApprovedCommands: Set<string> = new Set();
// Root commands the operator allows to match dangerous patterns
let dangerousCommandAllowlist: Set<string> = new Set();

/**
 * Initialize the shell tool with approved commands and (optionally) the root
 * commands that may run even when they match a dangerous pattern.
 */
export function initializeShellTool(
  commands: string[],
  dangerousCommands: string[] = [],
): void {
  approvedCommands = new Set(commands);
  dangerousCommandAllowlist = new Set(dangerousCommands);
}

export function getDangerousCommandAllowlist(): string[] {
  return Array.from(dangerousCommandAllowlist);
}

/**
 * Get the list of approved commands
 */
export function getApprovedCommands(): string[] {
  return Array.from(approvedCommands);
}

/**
 * Add command to always-approved list (runtime approval)
 */
export function addToAlwaysApproved(command: string): void {
  alwaysApprovedCommands.add(command);
}

/**
 * Get shell tool definition
 */
export function getShellTools() {
  const shellConfig = getShellConfig();
  const currentApprovedCommands = getApprovedCommands();

  // Generate dynamic description with approved commands
  let approvedCommandsText = "";
  if (currentApprovedCommands.length > 0) {
    const cmdList = currentApprovedCommands
      .map((cmd) => `  - ${cmd}`)
      .join("\n");
    approvedCommandsText = `\n\nPRE-APPROVED COMMANDS (no confirmation needed):\n${cmdList}\n\nOther commands may require user approval before execution.`;
  } else {
    approvedCommandsText =
      "\n\nNo pre-approved commands. All commands require user approval before execution.";
  }

  return [
    {
      name: "execute_shell",
      description:
        `Execute shell commands on the host system with security controls. ` +
        `Commands are executed as '${shellConfig.shell} ${shellConfig.args.join(
          " "
        )} <command>' on ${shellConfig.platform}. ` +
        `\n\nThe tool captures stdout, stderr, exit codes, and signals. ` +
        `Commands exceeding the timeout will be automatically terminated. ` +
        `\n\n⚠️  SECURITY REQUIREMENTS:\n` +
        `- At least ONE approved directory must be configured before executing any shell commands\n` +
        `- Working directory (workdir parameter or process.cwd()) MUST be within allowed directories\n` +
        `- All file/directory paths in arguments and redirections are validated against allowed directories (symlinks are resolved)\n` +
        `- Every command in a chain must be approved; chain with ';', '&&', '||' or '|' on a single line` +
        (shellConfig.platform === "Windows"
          ? ` (on Windows use ';' or '|': Windows PowerShell 5.1 does not support '&&' or '||')\n`
          : `\n`) +
        `- Not allowed: newlines, command substitution, backticks, a lone '&', ( ) { } grouping or script blocks, heredocs, escaped quotes (\\" \\')\n` +
        `- Commands matching dangerous patterns are blocked unless the server operator allowed them\n` +
        `\n` +
        `If no workdir is specified, the server's current working directory will be used and validated.` +
        approvedCommandsText +
        `\n\nIMPORTANT: Always provide a clear description of what the command does and why it's needed.`,
      inputSchema: sanitizeToolInputSchema(
        zodToJsonSchema(ShellCommandArgsSchema) as ToolInput
      ),
    },
  ];
}

/**
 * Format execution result for AI assistant
 */
function formatExecutionResult(
  args: ShellCommandArgs,
  result: ExecutionResult,
  workdir: string
): string {
  const lines: string[] = [];

  lines.push("Shell Command Execution Result:");
  lines.push("================================");
  lines.push("");
  lines.push(`Command: ${args.command}`);

  if (args.description) {
    lines.push(`Description: ${args.description}`);
  }

  lines.push(`Working Directory: ${workdir}`);
  lines.push(`Exit Code: ${result.exitCode ?? "(none)"}`);
  lines.push(`Signal: ${result.signal ?? "(none)"}`);

  if (result.timedOut) {
    lines.push(
      `⚠️  TIMEOUT: Command exceeded ${args.timeout || 30000}ms limit`
    );
  }

  lines.push("");
  lines.push("--- Standard Output ---");
  lines.push(result.stdout || "(empty)");
  lines.push("");
  lines.push("--- Standard Error ---");
  lines.push(result.stderr || "(empty)");

  if (result.error) {
    lines.push("");
    lines.push("--- Error ---");
    lines.push(result.error.message);
  }

  return lines.join("\n");
}

/**
 * Handle shell tool execution
 */
export async function handleShellTool(
  name: string,
  args: unknown
): Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}> {
  if (name !== "execute_shell") {
    throw new Error(`Unknown shell tool: ${name}`);
  }

  // Validate arguments
  const validatedArgs = ShellCommandArgsSchema.parse(args);

  // Validate command security (substitution, control characters, grammar)
  const commandValidation = validateCommand(validatedArgs.command, false);
  if (!commandValidation.allowed) {
    throw new Error(
      `Access denied: Command validation failed: ${commandValidation.reason}`
    );
  }
  const parsed = parseShellCommand(validatedArgs.command);

  // Every command in the chain must be approved
  const rootCommands = getRootCommands(parsed);
  const unapprovedCommands = rootCommands.filter(
    (cmd) => !approvedCommands.has(cmd) && !alwaysApprovedCommands.has(cmd)
  );
  if (rootCommands.length === 0 || unapprovedCommands.length > 0) {
    const approvedList = Array.from(approvedCommands).join(", ");
    throw new Error(
      `Access denied: Command not in approved list.\n` +
        `Unapproved commands: ${unapprovedCommands.join(", ")}\n` +
        `Command: ${validatedArgs.command}\n\n` +
        `Approved commands: ${approvedList || "(none configured)"}\n\n` +
        `To execute this command, add it to --approved-commands configuration.`
    );
  }

  // Dangerous patterns are blocked even for approved commands unless the
  // server operator explicitly allowed that root command. The caller cannot
  // opt in: requiresApproval is ignored.
  const blockedDangerousRoots = getDangerousRoots(parsed).filter(
    (cmd) => !dangerousCommandAllowlist.has(cmd)
  );
  if (blockedDangerousRoots.length > 0) {
    throw new Error(
      `Access denied: Dangerous command pattern detected.\n` +
        `Command: ${validatedArgs.command}\n` +
        `Blocked commands: ${blockedDangerousRoots.join(", ")}\n` +
        `The server operator can allow these with --allow-dangerous-commands.`
    );
  }

  // Validate working directory ALWAYS (not just if provided)
  const allowedDirs = getAllowedDirectories();
  if (allowedDirs.length === 0) {
    throw new Error(
      `Access denied: Shell execution requires at least one approved directory.\n` +
        `No allowed directories are currently configured.\n` +
        `\n` +
        `To execute shell commands, you must first configure allowed directories using:\n` +
        `  1. --approved-folders CLI argument when starting the MCP server, OR\n` +
        `  2. register_directory tool to add directories at runtime\n` +
        `\n` +
        `Example: register_directory with path "C:/path/to/your/project"`
    );
  }

  let workdir = validatedArgs.workdir || process.cwd();
  try {
    workdir = await validatePath(workdir);
  } catch (error) {
    throw new Error(
      `Access denied: Working directory is not within allowed directories.\n` +
        `Attempted directory: ${workdir}\n` +
        `Error: ${error instanceof Error ? error.message : String(error)}\n` +
        `\n` +
        `Allowed directories:\n` +
        allowedDirs.map((d) => `  - ${d}`).join("\n") +
        `\n\n` +
        `To execute commands in this directory:\n` +
        `  1. Register the directory using register_directory tool, OR\n` +
        `  2. Specify a workdir parameter within an approved directory`
    );
  }

  // Validate every file system operand (arguments and redirection targets),
  // resolving symlinks/junctions
  let deniedPaths: string[];
  try {
    deniedPaths = await findDisallowedCommandPaths(parsed, workdir);
  } catch (error) {
    throw new Error(
      `Access denied: Path validation failed: ${
        error instanceof Error ? error.message : String(error)
      }\n` +
        `Command blocked for security. Please ensure all paths in the command are within allowed directories.`
    );
  }
  if (deniedPaths.length > 0) {
    throw new Error(
      `Access denied: Command contains paths outside allowed directories:\n` +
        deniedPaths.map((p) => `  - ${p}`).join("\n") +
        `\n\nAllowed directories:\n` +
        allowedDirs.map((d) => `  - ${d}`).join("\n") +
        `\n\nTo access these paths, register their parent directories using register_directory tool.`
    );
  }

  // Execute command
  try {
    const result = await executeShellCommand(validatedArgs.command, {
      workdir,
      timeout: validatedArgs.timeout,
    });

    const formattedResult = formatExecutionResult(
      validatedArgs,
      result,
      workdir
    );

    // Consider non-zero exit codes as errors
    const isError = result.exitCode !== 0 || result.timedOut || !!result.error;

    return {
      content: [{ type: "text", text: formattedResult }],
      isError,
    };
  } catch (error) {
    throw new Error(
      `Command execution failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

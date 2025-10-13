import { zodToJsonSchema } from "zod-to-json-schema";
import { ToolSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  ShellCommandArgsSchema,
  type ShellCommandArgs,
} from "../types/index.js";
import {
  validateCommand,
  isCommandApproved,
  extractRootCommands,
  isDangerousCommand,
  getShellConfig,
} from "../utils/command-validation.js";
import {
  executeShellCommand,
  type ExecutionResult,
} from "../utils/shell-execution.js";
import { validatePath } from "../utils/lib.js";

const ToolInputSchema = ToolSchema.shape.inputSchema;
type ToolInput = any;

// Global state for approved commands
let approvedCommands: Set<string> = new Set();
let alwaysApprovedCommands: Set<string> = new Set();

/**
 * Initialize the shell tool with approved commands
 */
export function initializeShellTool(commands: string[]): void {
  approvedCommands = new Set(commands);
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
        `Working directory can be specified (must be within allowed directories). ` +
        `Commands exceeding the timeout will be automatically terminated. ` +
        `\n\n⚠️  SECURITY: Command substitution and certain dangerous patterns may be restricted.` +
        approvedCommandsText +
        `\n\nIMPORTANT: Always provide a clear description of what the command does and why it's needed.`,
      inputSchema: zodToJsonSchema(ShellCommandArgsSchema) as ToolInput,
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

  // Validate command security
  const commandValidation = validateCommand(validatedArgs.command, false);
  if (!commandValidation.allowed) {
    throw new Error(`Command validation failed: ${commandValidation.reason}`);
  }

  // Extract root commands for approval checking
  const rootCommands = extractRootCommands(validatedArgs.command);
  const allApproved = rootCommands.every(
    (cmd) => approvedCommands.has(cmd) || alwaysApprovedCommands.has(cmd)
  );

  // Check for dangerous patterns
  const isDangerous = isDangerousCommand(validatedArgs.command);

  if (!allApproved && (validatedArgs.requiresApproval || isDangerous)) {
    const unapprovedCommands = rootCommands.filter(
      (cmd) => !approvedCommands.has(cmd) && !alwaysApprovedCommands.has(cmd)
    );

    throw new Error(
      `Command requires approval. Unapproved commands: ${unapprovedCommands.join(
        ", "
      )}\n` +
        `Command: ${validatedArgs.command}\n` +
        `${
          isDangerous
            ? "⚠️  Warning: This command matches dangerous patterns\n"
            : ""
        }` +
        `To approve, add these commands to --approved-commands or .env configuration.`
    );
  }

  // Validate working directory if provided
  let workdir = process.cwd();
  if (validatedArgs.workdir) {
    try {
      workdir = await validatePath(validatedArgs.workdir);
    } catch (error) {
      throw new Error(
        `Invalid working directory: ${validatedArgs.workdir}\n` +
          `Error: ${error instanceof Error ? error.message : String(error)}\n` +
          `Working directory must be within allowed directories.`
      );
    }
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

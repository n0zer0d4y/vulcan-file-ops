import { spawn } from "child_process";
import { getShellConfig } from "./command-validation.js";

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  error?: Error;
}

export interface ExecutionOptions {
  workdir?: string;
  timeout?: number;
  env?: Record<string, string>;
}

/**
 * Execute a shell command with proper security and resource management
 */
export async function executeShellCommand(
  command: string,
  options: ExecutionOptions = {}
): Promise<ExecutionResult> {
  const { workdir = process.cwd(), timeout = 30000, env } = options;
  const shellConfig = getShellConfig();

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let resolved = false;

    // Spawn the shell process
    const child = spawn(shellConfig.shell, [...shellConfig.args, command], {
      cwd: workdir,
      env: { ...process.env, ...env },
      shell: false, // Already using explicit shell
      windowsHide: true,
    });

    // Set up timeout
    const timeoutHandle = setTimeout(() => {
      if (!resolved) {
        timedOut = true;
        child.kill("SIGTERM");

        // Force kill after 5 seconds if SIGTERM doesn't work
        setTimeout(() => {
          if (!resolved) {
            child.kill("SIGKILL");
          }
        }, 5000);
      }
    }, timeout);

    // Capture stdout
    if (child.stdout) {
      child.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });
    }

    // Capture stderr
    if (child.stderr) {
      child.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });
    }

    // Handle process completion
    child.on("close", (exitCode: number | null, signal: string | null) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutHandle);

      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode,
        signal,
        timedOut,
      });
    });

    // Handle errors
    child.on("error", (error: Error) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutHandle);

      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: null,
        signal: null,
        timedOut: false,
        error,
      });
    });
  });
}

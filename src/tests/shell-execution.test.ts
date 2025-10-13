import { describe, test, expect } from "@jest/globals";
import { executeShellCommand } from "../utils/shell-execution.js";
import os from "os";

describe("Shell Execution", () => {
  test("executes simple echo command", async () => {
    const command = "echo hello";
    const result = await executeShellCommand(command);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello");
    expect(result.timedOut).toBe(false);
    expect(result.error).toBeUndefined();
  });

  test("captures standard output", async () => {
    const command =
      os.platform() === "win32" ? "echo testoutput" : "echo testoutput";
    const result = await executeShellCommand(command);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("testoutput");
  });

  test("captures error output", async () => {
    const command =
      os.platform() === "win32"
        ? "Write-Error 'test error'"
        : "echo 'test error' >&2";
    const result = await executeShellCommand(command);

    expect(result.stderr).toContain("test error");
  });

  test("handles command with non-zero exit code", async () => {
    const command = os.platform() === "win32" ? "exit 1" : "exit 1";
    const result = await executeShellCommand(command);

    expect(result.exitCode).toBe(1);
    expect(result.timedOut).toBe(false);
  });

  test("handles timeout", async () => {
    const command =
      os.platform() === "win32" ? "Start-Sleep -Seconds 5" : "sleep 5";
    const result = await executeShellCommand(command, { timeout: 1000 });

    expect(result.timedOut).toBe(true);
  }, 10000);

  test("respects working directory", async () => {
    const testDir = os.tmpdir();
    const command = os.platform() === "win32" ? "pwd" : "pwd";
    const result = await executeShellCommand(command, { workdir: testDir });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toLowerCase()).toContain(testDir.toLowerCase());
  });

  test("handles command that doesn't exist", async () => {
    const command = "nonexistentcommand12345";
    const result = await executeShellCommand(command);

    // Either error is set or exit code is non-zero
    expect(result.error || result.exitCode !== 0).toBeTruthy();
  });

  test("handles chained commands", async () => {
    const command =
      os.platform() === "win32"
        ? "echo first; echo second"
        : "echo first && echo second";
    const result = await executeShellCommand(command);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("first");
    expect(result.stdout).toContain("second");
  });

  test("respects environment variables", async () => {
    const command =
      os.platform() === "win32" ? "echo $env:TEST_VAR" : "echo $TEST_VAR";
    const result = await executeShellCommand(command, {
      env: { TEST_VAR: "test_value" },
    });

    expect(result.stdout).toContain("test_value");
  });

  test("handles empty output", async () => {
    const command = os.platform() === "win32" ? "exit 0" : "true";
    const result = await executeShellCommand(command);

    expect(result.exitCode).toBe(0);
    // stdout may be empty or contain minimal output
    expect(result.stderr).toBe("");
  });

  test("handles multiline output", async () => {
    const command =
      os.platform() === "win32"
        ? "echo line1; echo line2; echo line3"
        : 'echo "line1\nline2\nline3"';
    const result = await executeShellCommand(command);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("line1");
    expect(result.stdout).toContain("line2");
    expect(result.stdout).toContain("line3");
  });

  test("trims output whitespace", async () => {
    const command = "echo test";
    const result = await executeShellCommand(command);

    // Output should be trimmed (no leading/trailing whitespace)
    expect(result.stdout).toBe(result.stdout.trim());
    expect(result.stderr).toBe(result.stderr.trim());
  });
});

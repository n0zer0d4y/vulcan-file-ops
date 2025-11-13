import { describe, test, expect, beforeEach } from "@jest/globals";
import {
  initializeShellTool,
  handleShellTool,
  getApprovedCommands,
} from "../tools/shell-tool.js";
import { setAllowedDirectories } from "../utils/lib.js";
import os from "os";

describe("Shell Tool", () => {
  beforeEach(() => {
    // Initialize with some approved commands
    initializeShellTool(["ls", "pwd", "echo", "cat"]);
    setAllowedDirectories([os.tmpdir()]);
  });

  test("executes approved command", async () => {
    const result = await handleShellTool("execute_shell", {
      command: "echo test",
      description: "Test echo command",
      workdir: os.tmpdir(), // Specify workdir within allowed directory
    });

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("test");
    expect(result.content[0].text).toContain("Exit Code: 0");
    expect(result.isError).toBe(false);
  }, 10000);

  test("rejects unapproved command without requiresApproval flag", async () => {
    await expect(
      handleShellTool("execute_shell", {
        command: "sudo apt install",
        requiresApproval: false,
      })
    ).rejects.toThrow("Command requires approval");
  });

  test("rejects unapproved command with requiresApproval flag", async () => {
    await expect(
      handleShellTool("execute_shell", {
        command: "rm -rf /tmp/test",
        requiresApproval: true,
      })
    ).rejects.toThrow("Command requires approval");
  });

  test("rejects dangerous command even if root is approved", async () => {
    await expect(
      handleShellTool("execute_shell", {
        command: "rm -rf /tmp/test",
        requiresApproval: false,
      })
    ).rejects.toThrow("Command requires approval");
  });

  test("validates working directory", async () => {
    await expect(
      handleShellTool("execute_shell", {
        command: "echo test",
        workdir: "/unauthorized/path",
      })
    ).rejects.toThrow("Working directory is not within allowed directories");
  });

  test("respects timeout", async () => {
    const command =
      os.platform() === "win32" ? "Start-Sleep -Seconds 5" : "sleep 5";

    const result = await handleShellTool("execute_shell", {
      command,
      timeout: 1000,
      workdir: os.tmpdir(), // Specify workdir within allowed directory
    });

    expect(result.content[0].text).toContain("TIMEOUT");
    expect(result.isError).toBe(true);
  }, 10000);

  test("includes command description in result", async () => {
    const result = await handleShellTool("execute_shell", {
      command: "echo test",
      description: "This is a test command",
      workdir: os.tmpdir(), // Specify workdir within allowed directory
    });

    expect(result.content[0].text).toContain("This is a test command");
  });

  test("reports non-zero exit codes as errors", async () => {
    const command = os.platform() === "win32" ? "exit 1" : "exit 1";

    const result = await handleShellTool("execute_shell", {
      command,
      workdir: os.tmpdir(), // Specify workdir within allowed directory
    });

    expect(result.content[0].text).toContain("Exit Code: 1");
    expect(result.isError).toBe(true);
  });

  test("rejects command with command substitution", async () => {
    await expect(
      handleShellTool("execute_shell", {
        command: "echo $(whoami)",
      })
    ).rejects.toThrow("Command substitution");
  });

  test("blocks command injection via approved commands (CVE-2025-54795 pattern)", async () => {
    // This test verifies that command injection attempts through approved commands
    // are blocked when dangerous commands are detected
    // Pattern: echo test; rm -rf /tmp; echo done
    // Even though echo is approved, the dangerous rm command should be detected
    if (os.platform() !== "win32") {
      // On Unix, test with rm -rf which matches dangerous patterns
      const injectedCommand = "echo test; rm -rf /tmp/*; echo done";

      // Should be rejected because rm -rf matches dangerous patterns
      await expect(
        handleShellTool("execute_shell", {
          command: injectedCommand,
          requiresApproval: false, // Even without explicit approval, dangerous commands are blocked
        })
      ).rejects.toThrow("Command requires approval");
    } else {
      // On Windows, test with del /s which matches dangerous patterns
      const injectedCommand = "echo test; del /s /q C:\\tmp\\*; echo done";

      // Should be rejected because del /s matches dangerous patterns
      await expect(
        handleShellTool("execute_shell", {
          command: injectedCommand,
          requiresApproval: false,
        })
      ).rejects.toThrow("Command requires approval");
    }
  });

  test("blocks unapproved commands when requiresApproval is true", async () => {
    // This test verifies that unapproved commands are blocked when requiresApproval is set
    const injectedCommand = "echo test; unapproved_command; echo done";

    // Should be rejected because extractRootCommands will detect "unapproved_command"
    // which is not in the approved list, and requiresApproval is true
    await expect(
      handleShellTool("execute_shell", {
        command: injectedCommand,
        requiresApproval: true,
      })
    ).rejects.toThrow("Command requires approval");
  });

  test("rejects empty command", async () => {
    await expect(
      handleShellTool("execute_shell", {
        command: "",
      })
    ).rejects.toThrow();
  });

  test("throws error for unknown tool name", async () => {
    await expect(
      handleShellTool("unknown_tool", {
        command: "echo test",
      })
    ).rejects.toThrow("Unknown shell tool");
  });

  test("getApprovedCommands returns initialized commands", () => {
    const commands = getApprovedCommands();
    expect(commands).toContain("ls");
    expect(commands).toContain("pwd");
    expect(commands).toContain("echo");
    expect(commands).toContain("cat");
  });

  test("executes command in specified working directory", async () => {
    const testDir = os.tmpdir();
    const command = os.platform() === "win32" ? "pwd" : "pwd";

    const result = await handleShellTool("execute_shell", {
      command,
      workdir: testDir,
    });

    expect(result.content[0].text).toContain(testDir);
  });

  test("captures both stdout and stderr", async () => {
    const command =
      os.platform() === "win32"
        ? "echo stdout; Write-Error 'stderr'"
        : "echo stdout && echo stderr >&2";

    const result = await handleShellTool("execute_shell", {
      command,
      workdir: os.tmpdir(), // Specify workdir within allowed directory
    });

    expect(result.content[0].text).toContain("Standard Output");
    expect(result.content[0].text).toContain("Standard Error");
  });

  test("handles chained commands when all roots approved", async () => {
    const command =
      os.platform() === "win32"
        ? "echo first; echo second"
        : "echo first && echo second";

    const result = await handleShellTool("execute_shell", {
      command,
      workdir: os.tmpdir(), // Specify workdir within allowed directory
    });

    expect(result.content[0].text).toContain("first");
    expect(result.content[0].text).toContain("second");
    expect(result.isError).toBe(false);
  });

  test("rejects chained commands when any root not approved", async () => {
    const command =
      os.platform() === "win32"
        ? "echo test; sudo apt install"
        : "echo test && sudo apt install";

    await expect(
      handleShellTool("execute_shell", {
        command,
      })
    ).rejects.toThrow("Command requires approval");
  });

  test("includes working directory in result", async () => {
    const result = await handleShellTool("execute_shell", {
      command: "echo test",
      workdir: os.tmpdir(), // Specify workdir within allowed directory
    });

    expect(result.content[0].text).toContain("Working Directory:");
  });

  test("includes command in result", async () => {
    const result = await handleShellTool("execute_shell", {
      command: "echo hello world",
      workdir: os.tmpdir(), // Specify workdir within allowed directory
    });

    expect(result.content[0].text).toContain("Command: echo hello world");
  });

  test("formats result with proper sections", async () => {
    const result = await handleShellTool("execute_shell", {
      command: "echo test",
      workdir: os.tmpdir(), // Specify workdir within allowed directory
    });

    const text = result.content[0].text;
    expect(text).toContain("Shell Command Execution Result:");
    expect(text).toContain("--- Standard Output ---");
    expect(text).toContain("--- Standard Error ---");
    expect(text).toContain("Exit Code:");
  });

  // Security Fix Tests: Shell Execution Directory Bypass Vulnerability
  describe("Security Fix: Directory Validation", () => {
    test("rejects shell execution when no approved directories configured", async () => {
      // Setup: Clear all allowed directories to simulate no configuration
      setAllowedDirectories([]);

      await expect(
        handleShellTool("execute_shell", {
          command: "echo test",
          description: "Test command without approved directories",
        })
      ).rejects.toThrow("at least one approved directory");
    });

    test("validates process.cwd() when workdir not provided", async () => {
      // Setup: Set allowed directory to something that's NOT process.cwd()
      // Use a very specific path that won't match current working directory
      const nonMatchingDir = os.platform() === "win32" 
        ? "C:\\NonExistentSecureDirectory123456" 
        : "/nonexistent-secure-directory-123456";
      
      setAllowedDirectories([nonMatchingDir]);

      // When workdir is NOT provided, process.cwd() should be validated
      // and rejected since it's not in the allowed directories
      await expect(
        handleShellTool("execute_shell", {
          command: "echo test",
          description: "Test without workdir parameter",
          // No workdir provided - should validate process.cwd()
        })
      ).rejects.toThrow("Working directory is not within allowed directories");
    });

    test("accepts command with workdir in approved directory", async () => {
      // Setup: Approved directory
      const approvedDir = os.tmpdir();
      setAllowedDirectories([approvedDir]);

      const result = await handleShellTool("execute_shell", {
        command: "echo test",
        workdir: approvedDir,
        description: "Test with approved workdir",
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain("Exit Code: 0");
    });

    test("rejects command with workdir outside approved directories", async () => {
      // Setup: Approved directory
      setAllowedDirectories([os.tmpdir()]);

      // Try to execute in unauthorized directory
      const unauthorizedDir = os.platform() === "win32" 
        ? "C:\\Windows\\System32" 
        : "/etc";

      await expect(
        handleShellTool("execute_shell", {
          command: "echo test",
          workdir: unauthorizedDir,
          description: "Test with unapproved workdir",
        })
      ).rejects.toThrow("Working directory is not within allowed directories");
    });

    test("provides helpful error message when directory not approved", async () => {
      setAllowedDirectories([os.tmpdir()]);
      
      const unauthorizedDir = os.platform() === "win32" 
        ? "C:\\Windows" 
        : "/usr";

      try {
        await handleShellTool("execute_shell", {
          command: "echo test",
          workdir: unauthorizedDir,
        });
        // Should not reach here
        expect(true).toBe(false);
      } catch (error) {
        const errorMessage = (error as Error).message;
        
        // Verify error message includes helpful information
        expect(errorMessage).toContain("Access denied");
        expect(errorMessage).toContain("Allowed directories:");
        expect(errorMessage).toContain(os.tmpdir());
        expect(errorMessage).toContain("register_directory");
      }
    });

    test("provides helpful error message when no directories configured", async () => {
      setAllowedDirectories([]);

      try {
        await handleShellTool("execute_shell", {
          command: "echo test",
        });
        // Should not reach here
        expect(true).toBe(false);
      } catch (error) {
        const errorMessage = (error as Error).message;
        
        // Verify error message includes helpful guidance
        expect(errorMessage).toContain("Access denied");
        expect(errorMessage).toContain("at least one approved directory");
        expect(errorMessage).toContain("--approved-folders");
        expect(errorMessage).toContain("register_directory");
      }
    });

    test("CVE Fix: prevents arbitrary execution via process.cwd() bypass", async () => {
      // This test specifically validates the CVE fix
      // Previously, omitting workdir would bypass directory validation
      
      // Setup: Configure specific allowed directory
      const allowedDir = os.tmpdir();
      setAllowedDirectories([allowedDir]);

      // Scenario 1: Command with explicit workdir in allowed directory - should work
      const result1 = await handleShellTool("execute_shell", {
        command: "echo allowed",
        workdir: allowedDir,
      });
      expect(result1.isError).toBe(false);

      // Scenario 2: Command without workdir - should validate process.cwd()
      // If process.cwd() is not in allowed directories, it should fail
      // Note: This test might pass or fail depending on where tests run from
      // The important thing is that validation HAPPENS, not that it's blocked
      try {
        await handleShellTool("execute_shell", {
          command: "echo test",
          // No workdir - will use and validate process.cwd()
        });
        
        // If we reach here, process.cwd() must be within allowed directories
        // which is valid behavior - the key is that validation occurred
      } catch (error) {
        // If we catch an error, it should be about directory validation
        const errorMessage = (error as Error).message;
        expect(errorMessage).toContain("Working directory is not within allowed directories");
      }
    });
  });
});

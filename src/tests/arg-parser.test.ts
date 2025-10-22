/**
 * Test script for argument parsing enhancement
 * Tests both comma-separated and array element formats for multi-value arguments
 */

import { jest } from "@jest/globals";

// Mock console.error to suppress output during tests
const originalConsoleError = console.error;
beforeAll(() => {
  console.error = jest.fn();
});

afterAll(() => {
  console.error = originalConsoleError;
});

describe("Argument Parser Enhancement", () => {
  // Helper function to simulate argument parsing
  function parseArguments(args: string[]) {
    const approvedFoldersFromArgs: string[] = [];
    const ignoredFolders: string[] = [];
    const enabledToolCategories: string[] = [];
    const enabledTools: string[] = [];
    const approvedCommandsFromArgs: string[] = [];

    let parsingIgnoredFolders = false;
    let parsingEnabledToolCategories = false;
    let parsingEnabledTools = false;
    let parsingApprovedFolders = false;
    let parsingApprovedCommands = false;

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];

      if (arg === "--approved-folders") {
        parsingApprovedFolders = true;
        parsingIgnoredFolders = false;
        parsingEnabledToolCategories = false;
        parsingEnabledTools = false;
        parsingApprovedCommands = false;

        // Look ahead to collect all non-flag arguments
        const folders: string[] = [];
        while (i + 1 < args.length && !args[i + 1].startsWith("--")) {
          folders.push(args[i + 1]);
          i++;
        }

        // Also support comma-separated format for backward compatibility
        const parsed = folders.flatMap((f) =>
          f.split(",").map((dir) => dir.trim()).filter((dir) => dir.length > 0)
        );
        approvedFoldersFromArgs.push(...parsed);

        continue;
      }

      if (arg === "--ignored-folders") {
        parsingIgnoredFolders = true;
        parsingApprovedFolders = false;
        parsingEnabledToolCategories = false;
        parsingEnabledTools = false;
        parsingApprovedCommands = false;

        // Look ahead to collect all non-flag arguments
        const folders: string[] = [];
        while (i + 1 < args.length && !args[i + 1].startsWith("--")) {
          folders.push(args[i + 1]);
          i++;
        }

        // Also support comma-separated format for backward compatibility
        const parsed = folders.flatMap((f) =>
          f.split(",").map((dir) => dir.trim()).filter((dir) => dir.length > 0)
        );
        ignoredFolders.push(...parsed);

        continue;
      }

      if (arg === "--enabled-tool-categories") {
        parsingEnabledToolCategories = true;
        parsingIgnoredFolders = false;
        parsingApprovedFolders = false;
        parsingEnabledTools = false;
        parsingApprovedCommands = false;

        // Look ahead to collect all non-flag arguments
        const categories: string[] = [];
        while (i + 1 < args.length && !args[i + 1].startsWith("--")) {
          categories.push(args[i + 1]);
          i++;
        }

        // Also support comma-separated format for backward compatibility
        const parsed = categories.flatMap((c) =>
          c.split(",").map((cat) => cat.trim()).filter((cat) => cat.length > 0)
        );
        enabledToolCategories.push(...parsed);

        continue;
      }

      if (arg === "--enabled-tools") {
        parsingEnabledTools = true;
        parsingIgnoredFolders = false;
        parsingApprovedFolders = false;
        parsingEnabledToolCategories = false;
        parsingApprovedCommands = false;

        // Look ahead to collect all non-flag arguments
        const tools: string[] = [];
        while (i + 1 < args.length && !args[i + 1].startsWith("--")) {
          tools.push(args[i + 1]);
          i++;
        }

        // Also support comma-separated format for backward compatibility
        const parsed = tools.flatMap((t) =>
          t.split(",").map((tool) => tool.trim()).filter((tool) => tool.length > 0)
        );
        enabledTools.push(...parsed);

        continue;
      }

      if (arg === "--approved-commands") {
        parsingApprovedCommands = true;
        parsingIgnoredFolders = false;
        parsingApprovedFolders = false;
        parsingEnabledToolCategories = false;
        parsingEnabledTools = false;

        // Look ahead to collect all non-flag arguments
        const commands: string[] = [];
        while (i + 1 < args.length && !args[i + 1].startsWith("--")) {
          commands.push(args[i + 1]);
          i++;
        }

        // Also support comma-separated format for backward compatibility
        const parsed = commands.flatMap((c) =>
          c.split(",").map((cmd) => cmd.trim()).filter((cmd) => cmd.length > 0)
        );
        approvedCommandsFromArgs.push(...parsed);

        continue;
      }

      // Reset parsing flags
      parsingIgnoredFolders = false;
      parsingApprovedFolders = false;
      parsingEnabledToolCategories = false;
      parsingEnabledTools = false;
      parsingApprovedCommands = false;
    }

    return {
      approvedFoldersFromArgs,
      ignoredFolders,
      enabledToolCategories,
      enabledTools,
      approvedCommandsFromArgs,
    };
  }

  describe("--approved-folders", () => {
    test("should parse comma-separated string (backward compatibility)", () => {
      const args = ["--approved-folders", "dir1,dir2,dir3"];
      const result = parseArguments(args);
      expect(result.approvedFoldersFromArgs).toEqual(["dir1", "dir2", "dir3"]);
    });

    test("should parse separate array elements (new format)", () => {
      const args = ["--approved-folders", "dir1", "dir2", "dir3"];
      const result = parseArguments(args);
      expect(result.approvedFoldersFromArgs).toEqual(["dir1", "dir2", "dir3"]);
    });

    test("should parse mixed format", () => {
      const args = ["--approved-folders", "dir1,dir2", "dir3"];
      const result = parseArguments(args);
      expect(result.approvedFoldersFromArgs).toEqual(["dir1", "dir2", "dir3"]);
    });

    test("should parse single directory", () => {
      const args = ["--approved-folders", "dir1"];
      const result = parseArguments(args);
      expect(result.approvedFoldersFromArgs).toEqual(["dir1"]);
    });

    test("should ignore empty strings", () => {
      const args = ["--approved-folders", "", "dir1", "  ", "dir2"];
      const result = parseArguments(args);
      expect(result.approvedFoldersFromArgs).toEqual(["dir1", "dir2"]);
    });

    test("should handle paths with spaces (when properly quoted)", () => {
      const args = [
        "--approved-folders",
        "C:/path with spaces/dir1",
        "C:/path with spaces/dir2",
      ];
      const result = parseArguments(args);
      expect(result.approvedFoldersFromArgs).toEqual([
        "C:/path with spaces/dir1",
        "C:/path with spaces/dir2",
      ]);
    });

    test("should stop at next flag", () => {
      const args = [
        "--approved-folders",
        "dir1",
        "dir2",
        "--ignored-folders",
        "node_modules",
      ];
      const result = parseArguments(args);
      expect(result.approvedFoldersFromArgs).toEqual(["dir1", "dir2"]);
      expect(result.ignoredFolders).toEqual(["node_modules"]);
    });
  });

  describe("--ignored-folders", () => {
    test("should parse comma-separated string", () => {
      const args = ["--ignored-folders", "node_modules,dist,.git"];
      const result = parseArguments(args);
      expect(result.ignoredFolders).toEqual(["node_modules", "dist", ".git"]);
    });

    test("should parse array elements", () => {
      const args = ["--ignored-folders", "node_modules", "dist", ".git"];
      const result = parseArguments(args);
      expect(result.ignoredFolders).toEqual(["node_modules", "dist", ".git"]);
    });

    test("should parse mixed format", () => {
      const args = ["--ignored-folders", "node_modules,dist", ".git"];
      const result = parseArguments(args);
      expect(result.ignoredFolders).toEqual(["node_modules", "dist", ".git"]);
    });
  });

  describe("--enabled-tool-categories", () => {
    test("should parse comma-separated string", () => {
      const args = ["--enabled-tool-categories", "read,write,filesystem"];
      const result = parseArguments(args);
      expect(result.enabledToolCategories).toEqual([
        "read",
        "write",
        "filesystem",
      ]);
    });

    test("should parse array elements", () => {
      const args = [
        "--enabled-tool-categories",
        "read",
        "write",
        "filesystem",
      ];
      const result = parseArguments(args);
      expect(result.enabledToolCategories).toEqual([
        "read",
        "write",
        "filesystem",
      ]);
    });

    test("should parse mixed format", () => {
      const args = ["--enabled-tool-categories", "read,write", "filesystem"];
      const result = parseArguments(args);
      expect(result.enabledToolCategories).toEqual([
        "read",
        "write",
        "filesystem",
      ]);
    });
  });

  describe("--enabled-tools", () => {
    test("should parse comma-separated string", () => {
      const args = ["--enabled-tools", "read_file,write_file,list_directory"];
      const result = parseArguments(args);
      expect(result.enabledTools).toEqual([
        "read_file",
        "write_file",
        "list_directory",
      ]);
    });

    test("should parse array elements", () => {
      const args = [
        "--enabled-tools",
        "read_file",
        "write_file",
        "list_directory",
      ];
      const result = parseArguments(args);
      expect(result.enabledTools).toEqual([
        "read_file",
        "write_file",
        "list_directory",
      ]);
    });

    test("should parse mixed format", () => {
      const args = [
        "--enabled-tools",
        "read_file,write_file",
        "list_directory",
      ];
      const result = parseArguments(args);
      expect(result.enabledTools).toEqual([
        "read_file",
        "write_file",
        "list_directory",
      ]);
    });
  });

  describe("--approved-commands", () => {
    test("should parse comma-separated string", () => {
      const args = ["--approved-commands", "npm,node,git"];
      const result = parseArguments(args);
      expect(result.approvedCommandsFromArgs).toEqual(["npm", "node", "git"]);
    });

    test("should parse array elements", () => {
      const args = ["--approved-commands", "npm", "node", "git"];
      const result = parseArguments(args);
      expect(result.approvedCommandsFromArgs).toEqual(["npm", "node", "git"]);
    });

    test("should parse mixed format", () => {
      const args = ["--approved-commands", "npm,node", "git"];
      const result = parseArguments(args);
      expect(result.approvedCommandsFromArgs).toEqual(["npm", "node", "git"]);
    });
  });

  describe("Multiple flags", () => {
    test("should handle multiple different flags", () => {
      const args = [
        "--approved-folders",
        "dir1",
        "dir2",
        "--ignored-folders",
        "node_modules",
        "dist",
        "--enabled-tools",
        "read_file",
        "write_file",
      ];
      const result = parseArguments(args);
      expect(result.approvedFoldersFromArgs).toEqual(["dir1", "dir2"]);
      expect(result.ignoredFolders).toEqual(["node_modules", "dist"]);
      expect(result.enabledTools).toEqual(["read_file", "write_file"]);
    });

    test("should handle complex real-world configuration", () => {
      const args = [
        "--approved-folders",
        "C:/Development/Projects/Test/filesystem-of-a-down-approved-folders-test",
        "C:/Development/Projects/MCP-Servers/filesystem-of-a-down/docs/sample-files",
        "--ignored-folders",
        "node_modules,dist,.git",
        "--enabled-tools",
        "read_file",
        "read_multiple_files",
        "write_file",
        "write_multiple_files",
        "edit_file",
        "create_directory",
        "list_directory",
        "directory_tree",
        "file_operations",
        "get_file_info",
        "register_directory",
        "grep_files",
        "glob_files",
        "delete_files",
        "execute_shell",
      ];
      const result = parseArguments(args);
      expect(result.approvedFoldersFromArgs).toEqual([
        "C:/Development/Projects/Test/filesystem-of-a-down-approved-folders-test",
        "C:/Development/Projects/MCP-Servers/filesystem-of-a-down/docs/sample-files",
      ]);
      expect(result.ignoredFolders).toEqual(["node_modules", "dist", ".git"]);
      expect(result.enabledTools).toHaveLength(15);
      expect(result.enabledTools).toContain("read_file");
      expect(result.enabledTools).toContain("execute_shell");
    });
  });
});


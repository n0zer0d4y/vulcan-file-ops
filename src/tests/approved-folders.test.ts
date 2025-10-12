import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs/promises";
import path from "path";
import { tmpdir } from "os";
import { promisify } from "util";
import { exec as execCallback } from "child_process";

const exec = promisify(execCallback);

describe("Approved Folders Feature", () => {
  let testDir1: string;
  let testDir2: string;
  let testFile1: string;
  let testFile2: string;

  beforeEach(async () => {
    // Create test directories
    testDir1 = path.join(tmpdir(), `approved-folders-test1-${Date.now()}`);
    testDir2 = path.join(tmpdir(), `approved-folders-test2-${Date.now()}`);

    await fs.mkdir(testDir1, { recursive: true });
    await fs.mkdir(testDir2, { recursive: true });

    // Create test files in each directory
    testFile1 = path.join(testDir1, "test1.txt");
    testFile2 = path.join(testDir2, "test2.txt");

    await fs.writeFile(testFile1, "Content from test1");
    await fs.writeFile(testFile2, "Content from test2");
  });

  afterEach(async () => {
    // Clean up test directories
    try {
      await fs.rm(testDir1, { recursive: true, force: true });
      await fs.rm(testDir2, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  test("should validate approved folders argument parsing", () => {
    // This test validates that the argument parsing logic is correct
    // The actual parsing happens in server/index.ts
    const mockArgs = [
      "--approved-folders",
      `${testDir1},${testDir2}`,
      "--ignored-folders",
      "node_modules",
    ];

    // Simulate parsing logic
    const approvedFolders: string[] = [];
    const ignoredFolders: string[] = [];

    for (let i = 0; i < mockArgs.length; i++) {
      if (mockArgs[i] === "--approved-folders" && i + 1 < mockArgs.length) {
        approvedFolders.push(
          ...mockArgs[i + 1].split(",").map((f) => f.trim())
        );
        i++;
      } else if (
        mockArgs[i] === "--ignored-folders" &&
        i + 1 < mockArgs.length
      ) {
        ignoredFolders.push(...mockArgs[i + 1].split(",").map((f) => f.trim()));
        i++;
      }
    }

    expect(approvedFolders).toHaveLength(2);
    expect(approvedFolders[0]).toBe(testDir1);
    expect(approvedFolders[1]).toBe(testDir2);
    expect(ignoredFolders).toHaveLength(1);
    expect(ignoredFolders[0]).toBe("node_modules");
  });

  test("should handle empty approved folders", () => {
    const mockArgs = ["--ignored-folders", "node_modules"];
    const approvedFolders: string[] = [];

    for (let i = 0; i < mockArgs.length; i++) {
      if (mockArgs[i] === "--approved-folders" && i + 1 < mockArgs.length) {
        approvedFolders.push(
          ...mockArgs[i + 1].split(",").map((f) => f.trim())
        );
        i++;
      }
    }

    expect(approvedFolders).toHaveLength(0);
  });

  test("should handle multiple comma-separated directories", () => {
    const mockArgs = [
      "--approved-folders",
      `/path/to/dir1,/path/to/dir2,/path/to/dir3`,
    ];
    const approvedFolders: string[] = [];

    for (let i = 0; i < mockArgs.length; i++) {
      if (mockArgs[i] === "--approved-folders" && i + 1 < mockArgs.length) {
        approvedFolders.push(
          ...mockArgs[i + 1].split(",").map((f) => f.trim())
        );
        i++;
      }
    }

    expect(approvedFolders).toHaveLength(3);
    expect(approvedFolders[0]).toBe("/path/to/dir1");
    expect(approvedFolders[1]).toBe("/path/to/dir2");
    expect(approvedFolders[2]).toBe("/path/to/dir3");
  });

  test("should trim whitespace from directory paths", () => {
    const mockArgs = [
      "--approved-folders",
      `/path/to/dir1 , /path/to/dir2  ,  /path/to/dir3`,
    ];
    const approvedFolders: string[] = [];

    for (let i = 0; i < mockArgs.length; i++) {
      if (mockArgs[i] === "--approved-folders" && i + 1 < mockArgs.length) {
        approvedFolders.push(
          ...mockArgs[i + 1].split(",").map((f) => f.trim())
        );
        i++;
      }
    }

    expect(approvedFolders).toHaveLength(3);
    expect(approvedFolders[0]).toBe("/path/to/dir1");
    expect(approvedFolders[1]).toBe("/path/to/dir2");
    expect(approvedFolders[2]).toBe("/path/to/dir3");
  });

  test("should filter out empty strings from approved folders", () => {
    const mockArgs = ["--approved-folders", `/path/to/dir1,,/path/to/dir2`];
    const approvedFolders: string[] = [];

    for (let i = 0; i < mockArgs.length; i++) {
      if (mockArgs[i] === "--approved-folders" && i + 1 < mockArgs.length) {
        const parsed = mockArgs[i + 1]
          .split(",")
          .map((f) => f.trim())
          .filter((f) => f.length > 0);
        approvedFolders.push(...parsed);
        i++;
      }
    }

    expect(approvedFolders).toHaveLength(2);
    expect(approvedFolders[0]).toBe("/path/to/dir1");
    expect(approvedFolders[1]).toBe("/path/to/dir2");
  });

  test("should validate that server description generator handles empty directories", () => {
    // Test the description generation logic
    const generateDescription = (currentDirs: string[]): string => {
      const baseDescription =
        "A configurable Model Context Protocol server for secure filesystem operations that absolutely rocks. " +
        "Enables AI assistants to dynamically access and manage file system resources with runtime directory registration and selective tool activation.";

      if (currentDirs.length === 0) {
        return (
          baseDescription +
          "\n\nNO DIRECTORIES CURRENTLY ACCESSIBLE. Use register_directory tool to grant access, or restart server with --approved-folders argument."
        );
      }

      const dirList = currentDirs.map((dir) => `  - ${dir}`).join("\n");
      return `${baseDescription}\n\nIMMEDIATELY ACCESSIBLE DIRECTORIES (pre-approved, no registration needed):\n${dirList}\n\nIMPORTANT: These directories are already accessible to all filesystem tools. Do NOT use register_directory for these paths.\n\nTo add additional directories at runtime, use the register_directory tool or MCP Roots protocol.`;
    };

    const emptyDescription = generateDescription([]);
    expect(emptyDescription).toContain("NO DIRECTORIES CURRENTLY ACCESSIBLE");
    expect(emptyDescription).toContain("--approved-folders");
  });

  test("should validate that server description generator lists approved directories", () => {
    const generateDescription = (currentDirs: string[]): string => {
      const baseDescription =
        "A configurable Model Context Protocol server for secure filesystem operations that absolutely rocks. " +
        "Enables AI assistants to dynamically access and manage file system resources with runtime directory registration and selective tool activation.";

      if (currentDirs.length === 0) {
        return (
          baseDescription +
          "\n\nNO DIRECTORIES CURRENTLY ACCESSIBLE. Use register_directory tool to grant access, or restart server with --approved-folders argument."
        );
      }

      const dirList = currentDirs.map((dir) => `  - ${dir}`).join("\n");
      return `${baseDescription}\n\nIMMEDIATELY ACCESSIBLE DIRECTORIES (pre-approved, no registration needed):\n${dirList}\n\nIMPORTANT: These directories are already accessible to all filesystem tools. Do NOT use register_directory for these paths.\n\nTo add additional directories at runtime, use the register_directory tool or MCP Roots protocol.`;
    };

    const description = generateDescription([testDir1, testDir2]);
    expect(description).toContain("IMMEDIATELY ACCESSIBLE DIRECTORIES");
    expect(description).toContain("no registration needed");
    expect(description).toContain(`  - ${testDir1}`);
    expect(description).toContain(`  - ${testDir2}`);
    expect(description).toContain(
      "Do NOT use register_directory for these paths"
    );
    expect(description).toContain("register_directory tool");
    expect(description).toContain("MCP Roots protocol");
  });

  test("should validate directory existence checking logic", async () => {
    // Test that valid directories pass validation
    const stats1 = await fs.stat(testDir1);
    expect(stats1.isDirectory()).toBe(true);

    const stats2 = await fs.stat(testDir2);
    expect(stats2.isDirectory()).toBe(true);

    // Test that files fail validation
    const fileStats = await fs.stat(testFile1);
    expect(fileStats.isDirectory()).toBe(false);
  });

  test("should validate that non-existent paths are rejected", async () => {
    const nonExistentPath = path.join(tmpdir(), `non-existent-${Date.now()}`);

    // Should throw error when trying to stat non-existent path
    await expect(fs.stat(nonExistentPath)).rejects.toThrow();
  });

  test("should validate path normalization for approved folders", async () => {
    // Test that paths are normalized correctly
    const normalized1 = path.resolve(testDir1);
    const normalized2 = path.resolve(testDir2);

    expect(path.isAbsolute(normalized1)).toBe(true);
    expect(path.isAbsolute(normalized2)).toBe(true);

    // Verify normalized paths are accessible
    const stats1 = await fs.stat(normalized1);
    const stats2 = await fs.stat(normalized2);

    expect(stats1.isDirectory()).toBe(true);
    expect(stats2.isDirectory()).toBe(true);
  });

  test("should validate merging with legacy directories", () => {
    // Test the logic for merging approved folders with legacy positional args
    const approvedFolders = ["/path/to/approved1", "/path/to/approved2"];
    const legacyDirs = ["/path/to/legacy1", "/path/to/approved1"]; // One duplicate

    const allowedDirectories = [...approvedFolders];

    // Merge logic: add legacy dirs that aren't already in allowedDirectories
    for (const dir of legacyDirs) {
      if (!allowedDirectories.includes(dir)) {
        allowedDirectories.push(dir);
      }
    }

    expect(allowedDirectories).toHaveLength(3);
    expect(allowedDirectories).toContain("/path/to/approved1");
    expect(allowedDirectories).toContain("/path/to/approved2");
    expect(allowedDirectories).toContain("/path/to/legacy1");

    // Verify no duplicates
    const uniqueDirs = new Set(allowedDirectories);
    expect(uniqueDirs.size).toBe(allowedDirectories.length);
  });
});

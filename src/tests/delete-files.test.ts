import fs from "fs/promises";
import path from "path";
import { handleFileSystemTool } from "../tools/filesystem-tools.js";
import { setAllowedDirectories, getAllowedDirectories } from "../utils/lib.js";

// Mock the validatePath function to allow our test paths
jest.mock("../utils/lib.js", () => {
  const originalModule = jest.requireActual("../utils/lib.js");
  return {
    ...originalModule,
    validatePath: jest.fn(async (path: string) => path),
  };
});

describe("delete_files tool", () => {
  const testDir = path.join(process.cwd(), "test-delete-files");

  beforeEach(async () => {
    // Register test directory
    const currentDirs = getAllowedDirectories();
    setAllowedDirectories([...currentDirs, testDir]);

    // Create test directory structure
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Cleanup
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe("Single File Deletion", () => {
    test("should delete a single file successfully", async () => {
      const testFile = path.join(testDir, "test.txt");
      await fs.writeFile(testFile, "content");

      const result = await handleFileSystemTool("delete_files", {
        paths: [testFile],
      });

      expect(result.content[0].text).toContain("Successfully deleted 1 of 1");
      await expect(fs.access(testFile)).rejects.toThrow();
    });

    test("should fail for non-existent file", async () => {
      const nonExistent = path.join(testDir, "nonexistent.txt");

      await expect(
        handleFileSystemTool("delete_files", {
          paths: [nonExistent],
        })
      ).rejects.toThrow("No valid paths to delete");
    });

    test("should handle file with spaces in name", async () => {
      const testFile = path.join(testDir, "file with spaces.txt");
      await fs.writeFile(testFile, "content");

      const result = await handleFileSystemTool("delete_files", {
        paths: [testFile],
      });

      expect(result.content[0].text).toContain("Successfully deleted 1 of 1");
      await expect(fs.access(testFile)).rejects.toThrow();
    });
  });

  describe("Multiple File Deletion", () => {
    test("should delete multiple files successfully", async () => {
      const file1 = path.join(testDir, "file1.txt");
      const file2 = path.join(testDir, "file2.txt");
      const file3 = path.join(testDir, "file3.txt");
      await fs.writeFile(file1, "content1");
      await fs.writeFile(file2, "content2");
      await fs.writeFile(file3, "content3");

      const result = await handleFileSystemTool("delete_files", {
        paths: [file1, file2, file3],
      });

      expect(result.content[0].text).toContain("Successfully deleted 3 of 3");
      expect(result.content[0].text).toContain("Successful: 3");
      expect(result.content[0].text).toContain("Failed: 0");
      await expect(fs.access(file1)).rejects.toThrow();
      await expect(fs.access(file2)).rejects.toThrow();
      await expect(fs.access(file3)).rejects.toThrow();
    });

    test("should handle mixed success and failure with non-empty directory", async () => {
      const existingFile = path.join(testDir, "exists.txt");
      const nonEmptyDir = path.join(testDir, "nonempty");
      await fs.writeFile(existingFile, "content");
      await fs.mkdir(nonEmptyDir);
      await fs.writeFile(path.join(nonEmptyDir, "file.txt"), "nested");

      const result = await handleFileSystemTool("delete_files", {
        paths: [existingFile, nonEmptyDir],
        recursive: false,
      });

      expect(result.content[0].text).toContain("Successfully deleted 1 of 2");
      expect(result.content[0].text).toContain("Successful: 1");
      expect(result.content[0].text).toContain("Failed: 1");
      await expect(fs.access(existingFile)).rejects.toThrow();
      await expect(fs.access(nonEmptyDir)).resolves.not.toThrow();
    });

    test("should delete files concurrently", async () => {
      const files = [];
      for (let i = 0; i < 10; i++) {
        const file = path.join(testDir, `file${i}.txt`);
        await fs.writeFile(file, `content${i}`);
        files.push(file);
      }

      const result = await handleFileSystemTool("delete_files", {
        paths: files,
      });

      expect(result.content[0].text).toContain("Successfully deleted 10 of 10");
      for (const file of files) {
        await expect(fs.access(file)).rejects.toThrow();
      }
    });
  });

  describe("Directory Deletion", () => {
    test("should delete empty directory without recursive flag", async () => {
      const emptyDir = path.join(testDir, "empty");
      await fs.mkdir(emptyDir);

      const result = await handleFileSystemTool("delete_files", {
        paths: [emptyDir],
        recursive: false,
      });

      expect(result.content[0].text).toContain("Successfully deleted 1 of 1");
      expect(result.content[0].text).toContain("(directory)");
      await expect(fs.access(emptyDir)).rejects.toThrow();
    });

    test("should delete empty directory with default recursive flag", async () => {
      const emptyDir = path.join(testDir, "empty");
      await fs.mkdir(emptyDir);

      const result = await handleFileSystemTool("delete_files", {
        paths: [emptyDir],
      });

      expect(result.content[0].text).toContain("Successfully deleted 1 of 1");
      await expect(fs.access(emptyDir)).rejects.toThrow();
    });

    test("should fail to delete non-empty directory without recursive flag", async () => {
      const nonEmptyDir = path.join(testDir, "nonempty");
      await fs.mkdir(nonEmptyDir);
      await fs.writeFile(path.join(nonEmptyDir, "file.txt"), "content");

      const result = await handleFileSystemTool("delete_files", {
        paths: [nonEmptyDir],
        recursive: false,
      });

      expect(result.content[0].text).toContain("Failed: 1");
      expect(result.content[0].text).toContain(
        "Directory not empty. Use recursive: true"
      );
      // Directory should still exist
      await expect(fs.access(nonEmptyDir)).resolves.not.toThrow();
    });

    test("should delete non-empty directory with recursive flag", async () => {
      const nonEmptyDir = path.join(testDir, "nonempty");
      await fs.mkdir(nonEmptyDir);
      await fs.writeFile(path.join(nonEmptyDir, "file.txt"), "content");

      const result = await handleFileSystemTool("delete_files", {
        paths: [nonEmptyDir],
        recursive: true,
      });

      expect(result.content[0].text).toContain("Successfully deleted 1 of 1");
      expect(result.content[0].text).toContain("Successful: 1");
      await expect(fs.access(nonEmptyDir)).rejects.toThrow();
    });

    test("should delete nested directory structure with recursive flag", async () => {
      const nestedDir = path.join(testDir, "parent", "child", "grandchild");
      await fs.mkdir(nestedDir, { recursive: true });
      await fs.writeFile(path.join(nestedDir, "file.txt"), "content");
      await fs.writeFile(
        path.join(testDir, "parent", "child", "file2.txt"),
        "content2"
      );
      await fs.writeFile(path.join(testDir, "parent", "file3.txt"), "content3");

      const result = await handleFileSystemTool("delete_files", {
        paths: [path.join(testDir, "parent")],
        recursive: true,
      });

      expect(result.content[0].text).toContain("Successfully deleted 1 of 1");
      await expect(fs.access(path.join(testDir, "parent"))).rejects.toThrow();
    });

    test("should delete multiple directories", async () => {
      const dir1 = path.join(testDir, "dir1");
      const dir2 = path.join(testDir, "dir2");
      const dir3 = path.join(testDir, "dir3");
      await fs.mkdir(dir1, { recursive: true });
      await fs.mkdir(dir2, { recursive: true });
      await fs.mkdir(dir3, { recursive: true });

      const result = await handleFileSystemTool("delete_files", {
        paths: [dir1, dir2, dir3],
      });

      expect(result.content[0].text).toContain("Successfully deleted 3 of 3");
      await expect(fs.access(dir1)).rejects.toThrow();
      await expect(fs.access(dir2)).rejects.toThrow();
      await expect(fs.access(dir3)).rejects.toThrow();
    });
  });

  describe("Mixed Files and Directories", () => {
    test("should delete mixed files and directories", async () => {
      const file1 = path.join(testDir, "file1.txt");
      const dir1 = path.join(testDir, "emptydir");
      const dir2 = path.join(testDir, "fulldir");
      await fs.writeFile(file1, "content");
      await fs.mkdir(dir1);
      await fs.mkdir(dir2);
      await fs.writeFile(path.join(dir2, "nested.txt"), "nested content");

      const result = await handleFileSystemTool("delete_files", {
        paths: [file1, dir1, dir2],
        recursive: true,
      });

      expect(result.content[0].text).toContain("Successfully deleted 3 of 3");
      await expect(fs.access(file1)).rejects.toThrow();
      await expect(fs.access(dir1)).rejects.toThrow();
      await expect(fs.access(dir2)).rejects.toThrow();
    });
  });

  describe("Schema Validation", () => {
    test("should reject empty paths array", async () => {
      await expect(
        handleFileSystemTool("delete_files", {
          paths: [],
        })
      ).rejects.toThrow("Invalid arguments for delete_files");
    });

    test("should reject more than 100 paths", async () => {
      const paths = Array(101)
        .fill(null)
        .map((_, i) => path.join(testDir, `file${i}.txt`));

      await expect(
        handleFileSystemTool("delete_files", {
          paths,
        })
      ).rejects.toThrow("Invalid arguments for delete_files");
    });

    test("should accept exactly 100 paths", async () => {
      const paths = [];
      for (let i = 0; i < 100; i++) {
        const file = path.join(testDir, `file${i}.txt`);
        await fs.writeFile(file, `content${i}`);
        paths.push(file);
      }

      const result = await handleFileSystemTool("delete_files", {
        paths,
      });

      expect(result.content[0].text).toContain(
        "Successfully deleted 100 of 100"
      );
    });

    test("should accept valid recursive boolean", async () => {
      const dir = path.join(testDir, "dir");
      await fs.mkdir(dir);

      const result = await handleFileSystemTool("delete_files", {
        paths: [dir],
        recursive: true,
      });

      expect(result).toBeDefined();
      expect(result.content[0].text).toContain("Successfully deleted 1 of 1");
    });

    test("should accept valid force boolean", async () => {
      const file = path.join(testDir, "file.txt");
      await fs.writeFile(file, "content");

      const result = await handleFileSystemTool("delete_files", {
        paths: [file],
        force: true,
      });

      expect(result).toBeDefined();
      expect(result.content[0].text).toContain("Successfully deleted 1 of 1");
    });

    test("should use default values for optional parameters", async () => {
      const file = path.join(testDir, "file.txt");
      await fs.writeFile(file, "content");

      // Not providing recursive or force should use defaults (false)
      const result = await handleFileSystemTool("delete_files", {
        paths: [file],
      });

      expect(result).toBeDefined();
      expect(result.content[0].text).toContain("Successfully deleted 1 of 1");
    });
  });

  describe("Error Handling", () => {
    test("should provide clear error for non-existent paths", async () => {
      const nonExistent1 = path.join(testDir, "nonexistent1.txt");
      const nonExistent2 = path.join(testDir, "nonexistent2.txt");

      await expect(
        handleFileSystemTool("delete_files", {
          paths: [nonExistent1, nonExistent2],
        })
      ).rejects.toThrow("No valid paths to delete");
    });

    test("should handle partial success gracefully", async () => {
      const existing1 = path.join(testDir, "existing1.txt");
      const existing2 = path.join(testDir, "existing2.txt");
      const nonEmptyDir = path.join(testDir, "nonempty");
      await fs.writeFile(existing1, "content1");
      await fs.writeFile(existing2, "content2");
      await fs.mkdir(nonEmptyDir);
      await fs.writeFile(path.join(nonEmptyDir, "file.txt"), "content");

      const result = await handleFileSystemTool("delete_files", {
        paths: [existing1, existing2, nonEmptyDir],
        recursive: false,
      });

      expect(result.content[0].text).toContain("Successfully deleted 2 of 3");
      expect(result.content[0].text).toContain("Successful: 2");
      expect(result.content[0].text).toContain("Failed: 1");
      expect(result.content[0].text).toContain("Failed deletions:");
      await expect(fs.access(existing1)).rejects.toThrow();
      await expect(fs.access(existing2)).rejects.toThrow();
      await expect(fs.access(nonEmptyDir)).resolves.not.toThrow();
    });

    test("should provide helpful error message for directory not empty", async () => {
      const dir = path.join(testDir, "nonempty");
      await fs.mkdir(dir);
      await fs.writeFile(path.join(dir, "file.txt"), "content");

      const result = await handleFileSystemTool("delete_files", {
        paths: [dir],
        recursive: false,
      });

      expect(result.content[0].text).toContain("Failed: 1");
      expect(result.content[0].text).toContain(
        "Directory not empty. Use recursive: true to delete non-empty directories"
      );
    });
  });

  describe("Response Format", () => {
    test("should include correct statistics in response", async () => {
      const file1 = path.join(testDir, "file1.txt");
      const file2 = path.join(testDir, "file2.txt");
      await fs.writeFile(file1, "content1");
      await fs.writeFile(file2, "content2");

      const result = await handleFileSystemTool("delete_files", {
        paths: [file1, file2],
      });

      expect(result.content[0].text).toContain("Total paths: 2");
      expect(result.content[0].text).toContain("Successful: 2");
      expect(result.content[0].text).toContain("Failed: 0");
    });

    test("should list deleted paths", async () => {
      const file1 = path.join(testDir, "file1.txt");
      const file2 = path.join(testDir, "file2.txt");
      await fs.writeFile(file1, "content1");
      await fs.writeFile(file2, "content2");

      const result = await handleFileSystemTool("delete_files", {
        paths: [file1, file2],
      });

      expect(result.content[0].text).toContain("Deleted paths:");
      expect(result.content[0].text).toContain(`✓ ${file1}`);
      expect(result.content[0].text).toContain(`✓ ${file2}`);
    });

    test("should indicate directory type in response", async () => {
      const dir = path.join(testDir, "testdir");
      await fs.mkdir(dir);

      const result = await handleFileSystemTool("delete_files", {
        paths: [dir],
      });

      expect(result.content[0].text).toContain("(directory)");
    });

    test("should show failed deletions separately", async () => {
      const existing = path.join(testDir, "existing.txt");
      const nonEmptyDir = path.join(testDir, "nonempty");
      await fs.writeFile(existing, "content");
      await fs.mkdir(nonEmptyDir);
      await fs.writeFile(path.join(nonEmptyDir, "file.txt"), "nested");

      const result = await handleFileSystemTool("delete_files", {
        paths: [existing, nonEmptyDir],
        recursive: false,
      });

      expect(result.content[0].text).toContain("Failed deletions:");
      expect(result.content[0].text).toContain("✗");
    });
  });

  describe("Force Flag", () => {
    test("should respect force flag", async () => {
      const file = path.join(testDir, "file.txt");
      await fs.writeFile(file, "content");

      const result = await handleFileSystemTool("delete_files", {
        paths: [file],
        force: true,
      });

      expect(result).toBeDefined();
      expect(result.content[0].text).toContain("Successfully deleted 1 of 1");
      await expect(fs.access(file)).rejects.toThrow();
    });

    test("should work with force flag on directories", async () => {
      const dir = path.join(testDir, "dir");
      await fs.mkdir(dir);
      await fs.writeFile(path.join(dir, "file.txt"), "content");

      const result = await handleFileSystemTool("delete_files", {
        paths: [dir],
        recursive: true,
        force: true,
      });

      expect(result).toBeDefined();
      expect(result.content[0].text).toContain("Successfully deleted 1 of 1");
      await expect(fs.access(dir)).rejects.toThrow();
    });
  });

  describe("Edge Cases", () => {
    test("should handle paths with special characters", async () => {
      const specialFile = path.join(testDir, "file-with-dashes.txt");
      await fs.writeFile(specialFile, "content");

      const result = await handleFileSystemTool("delete_files", {
        paths: [specialFile],
      });

      expect(result.content[0].text).toContain("Successfully deleted 1 of 1");
      await expect(fs.access(specialFile)).rejects.toThrow();
    });

    test("should handle deeply nested paths", async () => {
      const deepPath = path.join(
        testDir,
        "a",
        "b",
        "c",
        "d",
        "e",
        "f",
        "deep.txt"
      );
      await fs.mkdir(path.dirname(deepPath), { recursive: true });
      await fs.writeFile(deepPath, "content");

      const result = await handleFileSystemTool("delete_files", {
        paths: [deepPath],
      });

      expect(result.content[0].text).toContain("Successfully deleted 1 of 1");
      await expect(fs.access(deepPath)).rejects.toThrow();
    });

    test("should handle deletion of parent directory containing nested structure", async () => {
      const parentDir = path.join(testDir, "parent");
      const deepPath = path.join(parentDir, "a", "b", "c", "deep.txt");
      await fs.mkdir(path.dirname(deepPath), { recursive: true });
      await fs.writeFile(deepPath, "content");

      const result = await handleFileSystemTool("delete_files", {
        paths: [parentDir],
        recursive: true,
      });

      expect(result.content[0].text).toContain("Successfully deleted 1 of 1");
      await expect(fs.access(parentDir)).rejects.toThrow();
    });

    test("should handle single path in array", async () => {
      const file = path.join(testDir, "single.txt");
      await fs.writeFile(file, "content");

      const result = await handleFileSystemTool("delete_files", {
        paths: [file],
      });

      expect(result.content[0].text).toContain("Successfully deleted 1 of 1");
    });
  });
});

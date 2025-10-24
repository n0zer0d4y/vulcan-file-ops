import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { handleFileSystemTool } from "../tools/filesystem-tools.js";
import { setAllowedDirectories } from "../utils/lib.js";

describe("make_directory tool", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "make-dir-test-"));
    setAllowedDirectories([testDir]);
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe("Single directory creation", () => {
    it("should create a single directory", async () => {
      const dirPath = path.join(testDir, "new-folder");
      const result = await handleFileSystemTool("make_directory", {
        paths: dirPath,
      });

      expect(result.content[0].text).toContain(
        "Successfully created directory"
      );
      await expect(fs.access(dirPath)).resolves.toBeUndefined();
    });

    it("should create nested directory structure", async () => {
      const dirPath = path.join(testDir, "level1", "level2", "level3");
      await handleFileSystemTool("make_directory", {
        paths: dirPath,
      });

      await expect(fs.access(dirPath)).resolves.toBeUndefined();
    });

    it("should be idempotent (existing directory doesn't error)", async () => {
      const dirPath = path.join(testDir, "existing");
      await fs.mkdir(dirPath);

      const result = await handleFileSystemTool("make_directory", {
        paths: dirPath,
      });

      expect(result.content[0].text).toContain("Successfully created");
    });

    it("should work with deeply nested paths", async () => {
      const dirPath = path.join(
        testDir,
        "very",
        "deeply",
        "nested",
        "directory",
        "structure"
      );
      await handleFileSystemTool("make_directory", {
        paths: dirPath,
      });

      await expect(fs.access(dirPath)).resolves.toBeUndefined();
    });
  });

  describe("Batch directory creation", () => {
    it("should create multiple directories concurrently", async () => {
      const paths = [
        path.join(testDir, "dir1"),
        path.join(testDir, "dir2"),
        path.join(testDir, "dir3"),
      ];

      const result = await handleFileSystemTool("make_directory", {
        paths: paths,
      });

      expect(result.content[0].text).toContain(
        "Successfully created 3 directories"
      );

      for (const p of paths) {
        await expect(fs.access(p)).resolves.toBeUndefined();
      }
    });

    it("should create nested structures in batch", async () => {
      const paths = [
        path.join(testDir, "project", "src", "components"),
        path.join(testDir, "project", "dist", "assets"),
        path.join(testDir, "project", "tests", "unit"),
      ];

      await handleFileSystemTool("make_directory", {
        paths: paths,
      });

      for (const p of paths) {
        await expect(fs.access(p)).resolves.toBeUndefined();
      }
    });

    it("should list all created directories in output", async () => {
      const paths = [path.join(testDir, "a"), path.join(testDir, "b")];

      const result = await handleFileSystemTool("make_directory", {
        paths: paths,
      });

      const text = result.content[0].text;
      expect(text).toContain(paths[0]);
      expect(text).toContain(paths[1]);
    });

    it("should handle large batch of directories", async () => {
      const paths = Array.from({ length: 10 }, (_, i) =>
        path.join(testDir, `batch-dir-${i}`)
      );

      const result = await handleFileSystemTool("make_directory", {
        paths: paths,
      });

      expect(result.content[0].text).toContain(
        "Successfully created 10 directories"
      );

      for (const p of paths) {
        await expect(fs.access(p)).resolves.toBeUndefined();
      }
    });
  });

  describe("Error handling", () => {
    it("should throw on invalid path", async () => {
      await expect(
        handleFileSystemTool("make_directory", {
          paths: "/invalid/path/outside/allowed",
        })
      ).rejects.toThrow();
    });

    it("should fail entire batch if one path is invalid", async () => {
      const validPath = path.join(testDir, "valid");
      const paths = [validPath, "/invalid/path"];

      await expect(
        handleFileSystemTool("make_directory", {
          paths: paths,
        })
      ).rejects.toThrow();

      // Valid path should not be created if batch fails
      await expect(fs.access(validPath)).rejects.toThrow();
    });

    it("should throw on invalid arguments", async () => {
      await expect(
        handleFileSystemTool("make_directory", {
          paths: 123, // Invalid type
        })
      ).rejects.toThrow();
    });

    it("should handle empty array gracefully", async () => {
      const result = await handleFileSystemTool("make_directory", {
        paths: [],
      });

      expect(result.content[0].text).toContain("Successfully created 0");
    });

    it("should reject paths with null bytes", async () => {
      await expect(
        handleFileSystemTool("make_directory", {
          paths: path.join(testDir, "bad\x00path"),
        })
      ).rejects.toThrow();
    });
  });

  describe("Backward compatibility", () => {
    it("should work with single string path", async () => {
      const dirPath = path.join(testDir, "compat-test");

      const result = await handleFileSystemTool("make_directory", {
        paths: dirPath,
      });

      expect(result.content[0].text).toContain(
        "Successfully created directory"
      );
      await expect(fs.access(dirPath)).resolves.toBeUndefined();
    });

    it("should format single path output correctly", async () => {
      const dirPath = path.join(testDir, "single");

      const result = await handleFileSystemTool("make_directory", {
        paths: dirPath,
      });

      const text = result.content[0].text;
      expect(text).toContain("Successfully created directory");
      expect(text).not.toContain("directories:");
    });
  });

  describe("Mixed scenarios", () => {
    it("should handle batch with some existing directories", async () => {
      const existingDir = path.join(testDir, "existing");
      const newDir = path.join(testDir, "new");

      await fs.mkdir(existingDir);

      const result = await handleFileSystemTool("make_directory", {
        paths: [existingDir, newDir],
      });

      expect(result.content[0].text).toContain(
        "Successfully created 2 directories"
      );
      await expect(fs.access(existingDir)).resolves.toBeUndefined();
      await expect(fs.access(newDir)).resolves.toBeUndefined();
    });

    it("should create sibling and nested directories together", async () => {
      const paths = [
        path.join(testDir, "sibling1"),
        path.join(testDir, "sibling2"),
        path.join(testDir, "nested", "deep", "structure"),
      ];

      await handleFileSystemTool("make_directory", {
        paths: paths,
      });

      for (const p of paths) {
        await expect(fs.access(p)).resolves.toBeUndefined();
      }
    });
  });
});

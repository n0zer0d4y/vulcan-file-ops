import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import * as fs from "fs/promises";
import { realpathSync } from "fs";
import * as path from "path";
import * as os from "os";
import { handleFileSystemTool } from "../tools/filesystem-tools.js";
import { setAllowedDirectories } from "../utils/lib.js";

describe("make_directory tool", () => {
  let testDir: string;

  beforeEach(async () => {
    // realpath: os.tmpdir() may itself be a symlink (e.g. /var -> /private/var
    // on macOS). The server realpaths --approved-folders the same way.
    testDir = realpathSync(
      await fs.mkdtemp(path.join(os.tmpdir(), "make-dir-test-"))
    );
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

    it("should block prefix collision attacks (CVE-2025-54794 pattern)", async () => {
      // This test verifies that paths with similar prefixes but different directories
      // are correctly rejected, preventing the path restriction bypass vulnerability
      const baseDirName = path.basename(testDir);
      const parentDir = path.dirname(testDir);
      
      // Create a directory with prefix matching the allowed directory name
      // but is actually a sibling, not a subdirectory
      const evilDir = path.join(parentDir, `${baseDirName}_evil`);
      
      // Ensure the evil directory exists (simulating attacker-controlled environment)
      try {
        await fs.mkdir(evilDir, { recursive: true });
      } catch {
        // Directory might already exist, continue
      }
      
      // Attempt to create directory in the evil path - should be blocked
      const attackPath = path.join(evilDir, "unauthorized");
      await expect(
        handleFileSystemTool("make_directory", {
          paths: attackPath,
        })
      ).rejects.toThrow("Access denied");
      
      // Verify the directory was NOT created
      await expect(fs.access(attackPath)).rejects.toThrow();
      
      // Cleanup
      try {
        await fs.rm(evilDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it("should allow legitimate subdirectories despite prefix similarity", async () => {
      // Verify that legitimate subdirectories still work correctly
      const legitPath = path.join(testDir, "project", "src");
      const result = await handleFileSystemTool("make_directory", {
        paths: legitPath,
      });

      expect(result.content[0].text).toContain("Successfully created directory");
      await expect(fs.access(legitPath)).resolves.toBeUndefined();
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

  describe("MCP client serialization workaround", () => {
    it("should handle stringified array from buggy MCP clients", async () => {
      const paths = [
        path.join(testDir, "stringified1"),
        path.join(testDir, "stringified2"),
        path.join(testDir, "stringified3"),
      ];

      // Simulate buggy MCP client behavior - array is stringified
      const stringifiedPaths = JSON.stringify(paths);
      const consoleErrorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});

      try {
        const result = await handleFileSystemTool("make_directory", {
          paths: stringifiedPaths, // Passing stringified array instead of actual array
        });

        expect(result.content[0].text).toContain(
          "Successfully created 3 directories",
        );
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          "[INFO] make_directory: Detected and corrected stringified array parameter",
        );

        for (const p of paths) {
          await expect(fs.access(p)).resolves.toBeUndefined();
        }
      } finally {
        consoleErrorSpy.mockRestore();
      }
    });

    it("should still work with correctly formatted arrays", async () => {
      const paths = [
        path.join(testDir, "correct1"),
        path.join(testDir, "correct2"),
      ];

      // Proper array format (how it should be sent)
      const result = await handleFileSystemTool("make_directory", {
        paths: paths, // Proper array
      });

      expect(result.content[0].text).toContain("Successfully created 2 directories");

      for (const p of paths) {
        await expect(fs.access(p)).resolves.toBeUndefined();
      }
    });

    it("should handle paths that literally start with '[' character", async () => {
      // Edge case: path that looks like it could be an array but isn't valid JSON
      const weirdPath = path.join(testDir, "[bracket-folder]");

      const result = await handleFileSystemTool("make_directory", {
        paths: weirdPath,
      });

      expect(result.content[0].text).toContain("Successfully created directory");
      await expect(fs.access(weirdPath)).resolves.toBeUndefined();
    });

    it("should handle malformed stringified arrays gracefully", async () => {
      // Malformed JSON that starts with '[' but isn't valid
      const malformedPath = path.join(testDir, "[not-valid-json");

      const result = await handleFileSystemTool("make_directory", {
        paths: malformedPath,
      });

      // Should treat as single path since JSON.parse fails
      expect(result.content[0].text).toContain("Successfully created directory");
      await expect(fs.access(malformedPath)).resolves.toBeUndefined();
    });
  });
  describe("Symlink/junction sandbox escape (Issue #3, VFO-05)", () => {
    let outsideDir: string;
    let linkPath: string;
    let linkCreated: boolean;

    beforeEach(async () => {
      outsideDir = realpathSync(
        await fs.mkdtemp(path.join(os.tmpdir(), "make-dir-outside-"))
      );
      linkPath = path.join(testDir, "link");
      try {
        // Junctions need no admin rights on Windows; plain dir symlinks on POSIX
        await fs.symlink(
          outsideDir,
          linkPath,
          process.platform === "win32" ? "junction" : "dir"
        );
        linkCreated = true;
      } catch {
        linkCreated = false;
      }
    });

    afterEach(async () => {
      // Remove the link itself first so rm never follows it
      await fs.rm(linkPath, { force: true }).catch(() => {});
      await fs.unlink(linkPath).catch(() => {});
      await fs.rm(outsideDir, { recursive: true, force: true });
    });

    it("rejects a path that traverses a link pointing outside the allowed directory", async () => {
      if (!linkCreated) {
        console.warn("Skipping: could not create directory link");
        return;
      }
      const target = path.join(linkPath, "created-by-mkdir");

      await expect(
        handleFileSystemTool("make_directory", { paths: target })
      ).rejects.toThrow("Access denied");

      await expect(
        fs.access(path.join(outsideDir, "created-by-mkdir"))
      ).rejects.toThrow();
    });

    it("rejects nested paths below the link and creates nothing outside", async () => {
      if (!linkCreated) {
        console.warn("Skipping: could not create directory link");
        return;
      }
      const target = path.join(linkPath, "a", "b", "c");

      await expect(
        handleFileSystemTool("make_directory", { paths: [target] })
      ).rejects.toThrow("Access denied");

      expect(await fs.readdir(outsideDir)).toEqual([]);
    });

    it("rejects the whole batch when one path escapes via a link (nothing created)", async () => {
      if (!linkCreated) {
        console.warn("Skipping: could not create directory link");
        return;
      }
      const safe1 = path.join(testDir, "safe-1");
      const safe2 = path.join(testDir, "safe-2", "nested");
      const escaping = path.join(linkPath, "escaped");

      await expect(
        handleFileSystemTool("make_directory", {
          paths: [safe1, escaping, safe2],
        })
      ).rejects.toThrow(`Access denied: Path ${escaping}`);

      await expect(fs.access(safe1)).rejects.toThrow();
      await expect(fs.access(path.join(testDir, "safe-2"))).rejects.toThrow();
      expect(await fs.readdir(outsideDir)).toEqual([]);
    });

    it("rejects a relative path that escapes via a link", async () => {
      if (!linkCreated) {
        console.warn("Skipping: could not create directory link");
        return;
      }
      const originalCwd = process.cwd();
      process.chdir(testDir);
      try {
        await expect(
          handleFileSystemTool("make_directory", {
            paths: path.join("link", "relative-escape"),
          })
        ).rejects.toThrow("Access denied");
      } finally {
        process.chdir(originalCwd);
      }
      expect(await fs.readdir(outsideDir)).toEqual([]);
    });

    it("still allows creating directories through a link that stays inside", async () => {
      const innerTarget = path.join(testDir, "real-inner");
      await fs.mkdir(innerTarget);
      const innerLink = path.join(testDir, "inner-link");
      try {
        await fs.symlink(
          innerTarget,
          innerLink,
          process.platform === "win32" ? "junction" : "dir"
        );
      } catch {
        console.warn("Skipping: could not create directory link");
        return;
      }

      const result = await handleFileSystemTool("make_directory", {
        paths: path.join(innerLink, "child"),
      });

      expect(result.content[0].text).toContain("Successfully created directory");
      await expect(
        fs.access(path.join(innerTarget, "child"))
      ).resolves.toBeUndefined();
    });

    it("rejects a path whose existing component is a file", async () => {
      const filePath = path.join(testDir, "plain-file");
      await fs.writeFile(filePath, "x");

      await expect(
        handleFileSystemTool("make_directory", { paths: filePath })
      ).rejects.toThrow();
    });
  });
});

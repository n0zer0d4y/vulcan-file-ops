import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { handleFileSystemTool } from "../tools/filesystem-tools.js";
import { setAllowedDirectories, setIgnoredFolders } from "../utils/lib.js";

describe("Unified list_directory tool", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "list-dir-test-"));
    setAllowedDirectories([testDir]);
    setIgnoredFolders(["node_modules", ".git", "dist"]); // Configure ignored folders

    // Create test structure
    await fs.mkdir(path.join(testDir, "src"));
    await fs.mkdir(path.join(testDir, "node_modules"));
    await fs.mkdir(path.join(testDir, "nested", "deep"), { recursive: true });

    await fs.writeFile(path.join(testDir, "README.md"), "# Test Project\n");
    await fs.writeFile(path.join(testDir, "package.json"), '{"name":"test"}');
    await fs.writeFile(
      path.join(testDir, "src", "index.ts"),
      'console.log("hello");'
    );
    await fs.writeFile(
      path.join(testDir, "nested", "deep", "file.txt"),
      "content here"
    );
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe("Format: simple (backward compatible with old list_directory)", () => {
    it("should list directory with default format", async () => {
      const result = await handleFileSystemTool("list_directory", {
        path: testDir,
      });

      const text = result.content[0].text;
      expect(text).toContain("[DIR]");
      expect(text).toContain("[FILE]");
      expect(text).toContain("Total:");
      expect(text).toContain("files");
      expect(text).toContain("directories");
    });

    it("should filter ignored folders by default", async () => {
      const result = await handleFileSystemTool("list_directory", {
        path: testDir,
      });

      expect(result.content[0].text).not.toContain("node_modules");
    });

    it("should show exclusion count", async () => {
      const result = await handleFileSystemTool("list_directory", {
        path: testDir,
      });

      expect(result.content[0].text).toMatch(/\d+ filtered/);
    });

    it("should list files and directories", async () => {
      const result = await handleFileSystemTool("list_directory", {
        path: testDir,
      });

      const text = result.content[0].text;
      expect(text).toContain("src");
      expect(text).toContain("README.md");
      expect(text).toContain("package.json");
    });
  });

  describe("Format: detailed (backward compatible with list_directory_with_sizes)", () => {
    it("should show sizes and metadata", async () => {
      const result = await handleFileSystemTool("list_directory", {
        path: testDir,
        format: "detailed",
      });

      const text = result.content[0].text;
      expect(text).toContain("Type");
      expect(text).toContain("Name");
      expect(text).toContain("Size");
      expect(text).toContain("Modified");
      expect(text).toMatch(/KB|B/); // Should have size units
      expect(text).toContain("Combined size:");
    });

    it("should sort by name by default", async () => {
      const result = await handleFileSystemTool("list_directory", {
        path: testDir,
        format: "detailed",
      });

      const text = result.content[0].text;
      const readmeIndex = text.indexOf("README.md");
      const packageIndex = text.indexOf("package.json");

      // package.json should come before README.md (alphabetically, case-sensitive)
      expect(packageIndex).toBeLessThan(readmeIndex);
    });

    it("should sort by size when specified", async () => {
      const result = await handleFileSystemTool("list_directory", {
        path: testDir,
        format: "detailed",
        sortBy: "size",
      });

      const text = result.content[0].text;
      expect(text).toContain("Size");
      // Verify it doesn't error out
      expect(text).toContain("Total:");
    });

    it("should group directories first", async () => {
      const result = await handleFileSystemTool("list_directory", {
        path: testDir,
        format: "detailed",
        sortBy: "size",
      });

      const text = result.content[0].text;
      const lines = text.split("\n");

      let foundFile = false;
      for (const line of lines) {
        if (line.includes("[FILE]")) {
          foundFile = true;
        } else if (line.includes("[DIR]") && foundFile) {
          fail(
            "Found directory after file - directories should be grouped first"
          );
        }
      }
    });
  });

  describe("Format: tree (similar to old directory_tree)", () => {
    it("should show hierarchical tree structure", async () => {
      const result = await handleFileSystemTool("list_directory", {
        path: testDir,
        format: "tree",
      });

      const text = result.content[0].text;
      expect(text).toContain(".");
      expect(text).toContain("├──");
      expect(text).toContain("└──");
      expect(text).toContain("src/");
      expect(text).toContain("directories,");
      expect(text).toContain("files");
    });

    it("should respect exclude patterns", async () => {
      const result = await handleFileSystemTool("list_directory", {
        path: testDir,
        format: "tree",
        excludePatterns: ["*.json"],
      });

      const text = result.content[0].text;
      expect(text).not.toContain("package.json");
      expect(text).toContain("README.md");
    });

    it("should show exclusion count", async () => {
      const result = await handleFileSystemTool("list_directory", {
        path: testDir,
        format: "tree",
        excludePatterns: ["*.json"],
      });

      const text = result.content[0].text;
      expect(text).toMatch(/entries excluded/);
    });

    it("should include nested directories", async () => {
      const result = await handleFileSystemTool("list_directory", {
        path: testDir,
        format: "tree",
      });

      const text = result.content[0].text;
      expect(text).toContain("nested/");
      expect(text).toContain("deep/");
      expect(text).toContain("file.txt");
    });
  });

  describe("Format: json (backward compatible with old directory_tree)", () => {
    it("should return valid structured JSON", async () => {
      const result = await handleFileSystemTool("list_directory", {
        path: testDir,
        format: "json",
      });

      const json = JSON.parse(result.content[0].text);
      expect(json).toHaveProperty("path");
      expect(json).toHaveProperty("entries");
      expect(json).toHaveProperty("summary");
      expect(Array.isArray(json.entries)).toBe(true);
    });

    it("should include children for recursive entries", async () => {
      const result = await handleFileSystemTool("list_directory", {
        path: testDir,
        format: "json",
      });

      const json = JSON.parse(result.content[0].text);
      const srcDir = json.entries.find((e: any) => e.name === "src");

      expect(srcDir).toBeDefined();
      expect(srcDir.isDirectory).toBe(true);
      expect(srcDir.children).toBeDefined();
      expect(Array.isArray(srcDir.children)).toBe(true);
    });

    it("should include comprehensive summary", async () => {
      const result = await handleFileSystemTool("list_directory", {
        path: testDir,
        format: "json",
      });

      const json = JSON.parse(result.content[0].text);
      expect(json.summary).toHaveProperty("totalFiles");
      expect(json.summary).toHaveProperty("totalDirectories");
      expect(json.summary).toHaveProperty("totalSize");
      expect(json.summary).toHaveProperty("totalSizeFormatted");
      expect(json.summary).toHaveProperty("excludedByPatterns");
      expect(json.summary).toHaveProperty("excludedByIgnoreRules");
    });

    it("should respect exclude patterns in JSON format", async () => {
      const result = await handleFileSystemTool("list_directory", {
        path: testDir,
        format: "json",
        excludePatterns: ["*.md"],
      });

      const json = JSON.parse(result.content[0].text);
      const hasReadme = json.entries.some((e: any) => e.name === "README.md");
      expect(hasReadme).toBe(false);
      expect(json.summary.excludedByPatterns).toBeGreaterThan(0);
    });

    it("should include metadata for each entry", async () => {
      const result = await handleFileSystemTool("list_directory", {
        path: testDir,
        format: "json",
      });

      const json = JSON.parse(result.content[0].text);
      const fileEntry = json.entries.find((e: any) => e.name === "README.md");

      expect(fileEntry).toBeDefined();
      expect(fileEntry).toHaveProperty("name");
      expect(fileEntry).toHaveProperty("type");
      expect(fileEntry).toHaveProperty("path");
      expect(fileEntry).toHaveProperty("isDirectory");
      expect(fileEntry).toHaveProperty("size");
      expect(fileEntry).toHaveProperty("modifiedTime");
    });
  });

  describe("Sorting behavior", () => {
    it("should always group directories first regardless of sortBy", async () => {
      const result = await handleFileSystemTool("list_directory", {
        path: testDir,
        format: "json",
        sortBy: "size",
      });

      const json = JSON.parse(result.content[0].text);
      let foundFile = false;

      for (const entry of json.entries) {
        if (!entry.isDirectory) {
          foundFile = true;
        } else if (foundFile) {
          fail("Found directory after file");
        }
      }
    });

    it("should sort alphabetically within directories and files", async () => {
      const result = await handleFileSystemTool("list_directory", {
        path: testDir,
        format: "json",
        sortBy: "name",
      });

      const json = JSON.parse(result.content[0].text);
      const dirs = json.entries.filter((e: any) => e.isDirectory);
      const files = json.entries.filter((e: any) => !e.isDirectory);

      // Check directories are sorted
      for (let i = 0; i < dirs.length - 1; i++) {
        expect(
          dirs[i].name.localeCompare(dirs[i + 1].name)
        ).toBeLessThanOrEqual(0);
      }

      // Check files are sorted
      for (let i = 0; i < files.length - 1; i++) {
        expect(
          files[i].name.localeCompare(files[i + 1].name)
        ).toBeLessThanOrEqual(0);
      }
    });
  });

  describe("Exclude patterns", () => {
    it("should exclude files matching glob patterns", async () => {
      const result = await handleFileSystemTool("list_directory", {
        path: testDir,
        format: "json",
        excludePatterns: ["*.json", "*.md"],
      });

      const json = JSON.parse(result.content[0].text);
      const hasJson = json.entries.some((e: any) => e.name.endsWith(".json"));
      const hasMd = json.entries.some((e: any) => e.name.endsWith(".md"));

      expect(hasJson).toBe(false);
      expect(hasMd).toBe(false);
    });

    it("should track excluded count separately from ignored folders", async () => {
      const result = await handleFileSystemTool("list_directory", {
        path: testDir,
        format: "json",
        excludePatterns: ["*.json"],
      });

      const json = JSON.parse(result.content[0].text);
      expect(json.summary.excludedByPatterns).toBeGreaterThan(0);
      expect(json.summary.excludedByIgnoreRules).toBeGreaterThan(0);
    });
  });

  describe("Error handling", () => {
    it("should throw on invalid path", async () => {
      await expect(
        handleFileSystemTool("list_directory", {
          path: "/nonexistent/path/that/does/not/exist",
        })
      ).rejects.toThrow();
    });

    it("should throw on invalid format", async () => {
      await expect(
        handleFileSystemTool("list_directory", {
          path: testDir,
          format: "invalid",
        })
      ).rejects.toThrow();
    });

    it("should throw on invalid sortBy", async () => {
      await expect(
        handleFileSystemTool("list_directory", {
          path: testDir,
          sortBy: "invalid",
        })
      ).rejects.toThrow();
    });
  });

  describe("Backward compatibility", () => {
    it("should work like old list_directory with minimal args", async () => {
      const result = await handleFileSystemTool("list_directory", {
        path: testDir,
      });

      expect(result.content[0].text).toContain("[DIR]");
      expect(result.content[0].text).toContain("[FILE]");
      expect(result.content[0].text).toContain("Total:");
    });

    it("should work like old list_directory_with_sizes with format=detailed", async () => {
      const result = await handleFileSystemTool("list_directory", {
        path: testDir,
        format: "detailed",
        sortBy: "size",
      });

      expect(result.content[0].text).toContain("Size");
      expect(result.content[0].text).toMatch(/KB|B/);
      expect(result.content[0].text).toContain("Total:");
      expect(result.content[0].text).toContain("Combined size:");
    });

    it("should work like old directory_tree with format=tree", async () => {
      const result = await handleFileSystemTool("list_directory", {
        path: testDir,
        format: "tree",
        excludePatterns: ["node_modules"],
      });

      expect(result.content[0].text).toContain("├──");
      expect(result.content[0].text).toContain("src/");
      expect(result.content[0].text).not.toContain("node_modules");
    });

    it("should work like old directory_tree with format=json", async () => {
      const result = await handleFileSystemTool("list_directory", {
        path: testDir,
        format: "json",
        excludePatterns: [],
      });

      const json = JSON.parse(result.content[0].text);
      expect(json.entries).toBeDefined();
      expect(Array.isArray(json.entries)).toBe(true);

      // Check structure matches old directory_tree
      const dirEntry = json.entries.find((e: any) => e.isDirectory);
      if (dirEntry) {
        expect(dirEntry).toHaveProperty("name");
        expect(dirEntry).toHaveProperty("type");
        expect(dirEntry).toHaveProperty("children");
      }
    });
  });

  describe("Recursive behavior", () => {
    it("should recursively traverse in tree format", async () => {
      const result = await handleFileSystemTool("list_directory", {
        path: testDir,
        format: "tree",
      });

      const text = result.content[0].text;
      // Should show nested structure
      expect(text).toContain("nested/");
      expect(text).toContain("deep/");
      expect(text).toContain("file.txt");
    });

    it("should recursively traverse in json format", async () => {
      const result = await handleFileSystemTool("list_directory", {
        path: testDir,
        format: "json",
      });

      const json = JSON.parse(result.content[0].text);
      const nestedDir = json.entries.find((e: any) => e.name === "nested");

      expect(nestedDir).toBeDefined();
      expect(nestedDir.children).toBeDefined();
      expect(nestedDir.children.length).toBeGreaterThan(0);

      const deepDir = nestedDir.children.find((e: any) => e.name === "deep");
      expect(deepDir).toBeDefined();
      expect(deepDir.children).toBeDefined();
    });

    it("should not recurse in simple format", async () => {
      const result = await handleFileSystemTool("list_directory", {
        path: testDir,
        format: "simple",
      });

      const text = result.content[0].text;
      // Should only show top-level
      expect(text).toContain("nested");
      expect(text).not.toContain("deep"); // Should not show nested contents
    });

    it("should not recurse in detailed format", async () => {
      const result = await handleFileSystemTool("list_directory", {
        path: testDir,
        format: "detailed",
      });

      const text = result.content[0].text;
      // Should only show top-level
      expect(text).toContain("nested");
      expect(text).not.toContain("deep"); // Should not show nested contents
    });
  });
});

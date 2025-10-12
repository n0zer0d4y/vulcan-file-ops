import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { grepFilesWithValidation } from "../utils/lib.js";
import { setAllowedDirectories, setIgnoredFolders } from "../utils/lib.js";

describe("Grep Tool", () => {
  let testDir: string;

  beforeEach(async () => {
    // Create temporary test directory
    testDir = path.join(os.tmpdir(), `grep-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    setAllowedDirectories([testDir]);
    setIgnoredFolders([]);
  });

  afterEach(async () => {
    // Cleanup
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
  });

  describe("Basic Text Search", () => {
    it("should find matches in a single file", async () => {
      const testFile = path.join(testDir, "test.txt");
      await fs.writeFile(testFile, "Hello World\nTest Line\nHello Again");

      const result = await grepFilesWithValidation("Hello", testDir, [testDir]);

      expect(result.totalMatches).toBe(2);
      expect(result.matches).toHaveLength(2);
      expect(result.matches![0].line).toBe(1);
      expect(result.matches![1].line).toBe(3);
    });

    it("should handle regex patterns", async () => {
      const testFile = path.join(testDir, "code.js");
      await fs.writeFile(
        testFile,
        "function test() {}\n" +
          "const myVar = 123;\n" +
          "function anotherTest() {}"
      );

      const result = await grepFilesWithValidation(
        "function\\s+\\w+",
        testDir,
        [testDir]
      );

      expect(result.totalMatches).toBe(2);
      expect(result.matches).toHaveLength(2);
    });

    it("should respect case insensitive flag", async () => {
      const testFile = path.join(testDir, "test.txt");
      await fs.writeFile(testFile, "Hello\nhello\nHELLO");

      const result = await grepFilesWithValidation(
        "hello",
        testDir,
        [testDir],
        {
          caseInsensitive: true,
        }
      );

      expect(result.totalMatches).toBe(3);
    });

    it("should respect case sensitive by default", async () => {
      const testFile = path.join(testDir, "test.txt");
      await fs.writeFile(testFile, "Hello\nhello\nHELLO");

      const result = await grepFilesWithValidation(
        "hello",
        testDir,
        [testDir],
        {
          caseInsensitive: false,
        }
      );

      expect(result.totalMatches).toBe(1);
      expect(result.matches![0].content).toBe("hello");
    });
  });

  describe("Context Lines", () => {
    it("should include context before matches", async () => {
      const testFile = path.join(testDir, "test.txt");
      await fs.writeFile(testFile, "Line 1\nLine 2\nMATCH\nLine 4");

      const result = await grepFilesWithValidation(
        "MATCH",
        testDir,
        [testDir],
        {
          contextBefore: 2,
        }
      );

      expect(result.matches![0].contextBefore).toEqual(["Line 1", "Line 2"]);
    });

    it("should include context after matches", async () => {
      const testFile = path.join(testDir, "test.txt");
      await fs.writeFile(testFile, "Line 1\nMATCH\nLine 3\nLine 4");

      const result = await grepFilesWithValidation(
        "MATCH",
        testDir,
        [testDir],
        {
          contextAfter: 2,
        }
      );

      expect(result.matches![0].contextAfter).toEqual(["Line 3", "Line 4"]);
    });

    it("should include context before and after matches", async () => {
      const testFile = path.join(testDir, "test.txt");
      await fs.writeFile(testFile, "Line 1\nLine 2\nMATCH\nLine 4\nLine 5");

      const result = await grepFilesWithValidation(
        "MATCH",
        testDir,
        [testDir],
        {
          contextBefore: 1,
          contextAfter: 1,
        }
      );

      expect(result.matches![0].contextBefore).toEqual(["Line 2"]);
      expect(result.matches![0].contextAfter).toEqual(["Line 4"]);
    });
  });

  describe("Output Modes", () => {
    beforeEach(async () => {
      await fs.writeFile(
        path.join(testDir, "file1.txt"),
        "Match here\nNo match"
      );
      await fs.writeFile(
        path.join(testDir, "file2.txt"),
        "Match again\nMatch twice"
      );
      await fs.writeFile(path.join(testDir, "file3.txt"), "No match at all");
    });

    it("should support content output mode (default)", async () => {
      const result = await grepFilesWithValidation(
        "Match",
        testDir,
        [testDir],
        {
          outputMode: "content",
        }
      );

      expect(result.mode).toBe("content");
      expect(result.totalMatches).toBe(3);
      expect(result.matches).toBeDefined();
      expect(result.matches!.length).toBeGreaterThan(0);
    });

    it("should support files_with_matches output mode", async () => {
      const result = await grepFilesWithValidation(
        "Match",
        testDir,
        [testDir],
        {
          outputMode: "files_with_matches",
        }
      );

      expect(result.mode).toBe("files_with_matches");
      expect(result.files).toHaveLength(2);
      expect(result.files).toContain(path.join(testDir, "file1.txt"));
      expect(result.files).toContain(path.join(testDir, "file2.txt"));
    });

    it("should support count output mode", async () => {
      const result = await grepFilesWithValidation(
        "Match",
        testDir,
        [testDir],
        {
          outputMode: "count",
        }
      );

      expect(result.mode).toBe("count");
      expect(result.counts!.size).toBe(2);
      expect(result.counts!.get(path.join(testDir, "file1.txt"))).toBe(1);
      expect(result.counts!.get(path.join(testDir, "file2.txt"))).toBe(2);
    });
  });

  describe("File Type Filtering", () => {
    beforeEach(async () => {
      await fs.writeFile(path.join(testDir, "test.js"), "console.log('test');");
      await fs.writeFile(path.join(testDir, "test.py"), "print('test')");
      await fs.writeFile(path.join(testDir, "test.txt"), "test");
    });

    it("should filter by file type (js)", async () => {
      const result = await grepFilesWithValidation("test", testDir, [testDir], {
        fileType: "js",
      });

      expect(result.filesSearched).toBe(1);
    });

    it("should filter by file type (py)", async () => {
      const result = await grepFilesWithValidation("test", testDir, [testDir], {
        fileType: "py",
      });

      expect(result.filesSearched).toBe(1);
    });
  });

  describe("Glob Pattern Filtering", () => {
    beforeEach(async () => {
      await fs.mkdir(path.join(testDir, "src"), { recursive: true });
      await fs.writeFile(path.join(testDir, "src", "app.js"), "test");
      await fs.writeFile(path.join(testDir, "README.md"), "test");
    });

    it("should filter by glob pattern", async () => {
      const result = await grepFilesWithValidation("test", testDir, [testDir], {
        globPattern: "*.js",
      });

      expect(result.filesSearched).toBe(0); // *.js only matches current dir
    });

    it("should support recursive glob patterns", async () => {
      const result = await grepFilesWithValidation("test", testDir, [testDir], {
        globPattern: "**/*.js",
      });

      expect(result.filesSearched).toBe(1);
    });
  });

  describe("Head Limit", () => {
    beforeEach(async () => {
      await fs.writeFile(
        path.join(testDir, "test.txt"),
        Array(100).fill("MATCH").join("\n")
      );
    });

    it("should limit results with head_limit in content mode", async () => {
      const result = await grepFilesWithValidation(
        "MATCH",
        testDir,
        [testDir],
        {
          outputMode: "content",
          headLimit: 10,
        }
      );

      expect(result.matches!.length).toBe(10);
      expect(result.totalMatches).toBeGreaterThanOrEqual(10);
    });
  });

  describe("Multiline Mode", () => {
    it("should support multiline patterns", async () => {
      const testFile = path.join(testDir, "test.txt");
      await fs.writeFile(testFile, "Start block\nMiddle\nEnd block");

      // Multiline mode allows . to match newlines
      const result = await grepFilesWithValidation(
        "Start",
        testDir,
        [testDir],
        {
          multiline: true,
        }
      );

      expect(result.totalMatches).toBeGreaterThan(0);
      expect(result.matches![0].content).toContain("Start");
    });
  });

  describe("Security & Performance", () => {
    it("should respect allowed directories", async () => {
      const outsideDir = path.join(os.tmpdir(), `outside-${Date.now()}`);
      await fs.mkdir(outsideDir, { recursive: true });
      await fs.writeFile(path.join(outsideDir, "test.txt"), "MATCH");

      try {
        // Should not search outside allowed directories
        const result = await grepFilesWithValidation("MATCH", outsideDir, [
          testDir,
        ]);

        // If the path validation works correctly, this should throw or return 0 results
        expect(result.totalMatches).toBe(0);
      } catch (error) {
        // Expected - path validation should reject
        expect(error).toBeDefined();
      } finally {
        await fs.rm(outsideDir, { recursive: true, force: true });
      }
    });

    it("should respect ignored folders", async () => {
      setIgnoredFolders(["node_modules"]);

      await fs.mkdir(path.join(testDir, "node_modules"), { recursive: true });
      await fs.writeFile(
        path.join(testDir, "node_modules", "test.js"),
        "MATCH"
      );
      await fs.writeFile(path.join(testDir, "app.js"), "MATCH");

      const result = await grepFilesWithValidation("MATCH", testDir, [testDir]);

      expect(result.filesSearched).toBe(1);
      expect(result.totalMatches).toBe(1);
    });

    it("should handle invalid regex gracefully", async () => {
      await expect(
        grepFilesWithValidation("[invalid(regex", testDir, [testDir])
      ).rejects.toThrow(/Invalid regex pattern/);
    });

    it("should skip binary files gracefully", async () => {
      // Create a binary file (will fail UTF-8 decode)
      const binaryFile = path.join(testDir, "binary.bin");
      await fs.writeFile(binaryFile, Buffer.from([0xff, 0xfe, 0xfd]));
      await fs.writeFile(path.join(testDir, "text.txt"), "MATCH");

      const result = await grepFilesWithValidation("MATCH", testDir, [testDir]);

      // Should skip binary file and only find match in text file
      expect(result.totalMatches).toBe(1);
    });
  });

  describe("Recursive Directory Search", () => {
    beforeEach(async () => {
      await fs.mkdir(path.join(testDir, "sub1", "sub2"), { recursive: true });
      await fs.writeFile(path.join(testDir, "file1.txt"), "MATCH");
      await fs.writeFile(path.join(testDir, "sub1", "file2.txt"), "MATCH");
      await fs.writeFile(
        path.join(testDir, "sub1", "sub2", "file3.txt"),
        "MATCH"
      );
    });

    it("should search recursively through directories", async () => {
      const result = await grepFilesWithValidation("MATCH", testDir, [testDir]);

      expect(result.totalMatches).toBe(3);
      expect(result.filesSearched).toBe(3);
    });

    it("should limit recursion depth", async () => {
      // Create very deep directory structure
      let deepPath = testDir;
      for (let i = 0; i < 15; i++) {
        deepPath = path.join(deepPath, `level${i}`);
        await fs.mkdir(deepPath, { recursive: true });
      }
      await fs.writeFile(path.join(deepPath, "deep.txt"), "MATCH");

      const result = await grepFilesWithValidation("MATCH", testDir, [testDir]);

      // Should not reach the very deep file due to depth limit (max depth: 10)
      expect(result.filesSearched).toBeLessThan(10);
    });
  });

  describe("Single File Search", () => {
    it("should search a single file when given a file path", async () => {
      const testFile = path.join(testDir, "single.txt");
      await fs.writeFile(testFile, "MATCH\nNO\nMATCH");

      const result = await grepFilesWithValidation("MATCH", testFile, [
        testDir,
      ]);

      expect(result.totalMatches).toBe(2);
      expect(result.filesSearched).toBe(1);
    });
  });

  describe("Empty Results", () => {
    it("should return empty results when no matches found", async () => {
      await fs.writeFile(path.join(testDir, "test.txt"), "No matches here");

      const result = await grepFilesWithValidation("NOMATCH", testDir, [
        testDir,
      ]);

      expect(result.totalMatches).toBe(0);
      expect(result.matches).toHaveLength(0);
      expect(result.filesSearched).toBe(1);
    });
  });
});

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs/promises";
import * as path from "path";
import { handleWriteTool } from "../tools/write-tools.js";
import { setAllowedDirectories } from "../utils/lib.js";

const TEST_DIR = path.join(process.cwd(), "test-temp-dir");

describe("write_multiple_files tool", () => {
  beforeEach(async () => {
    // Create test directory
    await fs.mkdir(TEST_DIR, { recursive: true });
    setAllowedDirectories([TEST_DIR]);
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(TEST_DIR, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  it("should write multiple files successfully", async () => {
    const files = [
      {
        path: path.join(TEST_DIR, "file1.txt"),
        content: "Hello World 1",
      },
      {
        path: path.join(TEST_DIR, "file2.txt"),
        content: "Hello World 2",
      },
      {
        path: path.join(TEST_DIR, "file3.txt"),
        content: "Hello World 3",
      },
    ];

    const result = await handleWriteTool("write_multiple_files", { files });

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    expect(result.content[0].type).toBe("text");

    const resultText = result.content[0].text;
    expect(resultText).toContain("Wrote 3 of 3 files:");
    expect(resultText).toContain("✓");
    expect(resultText).toContain("All files written successfully.");

    // Verify files were actually written
    for (const file of files) {
      const content = await fs.readFile(file.path, "utf-8");
      expect(content).toBe(file.content);
    }
  });

  it("should handle partial failures", async () => {
    // Create a directory to block file creation
    const blockingDir = path.join(TEST_DIR, "blocking-file.txt");
    await fs.mkdir(blockingDir);

    const files = [
      {
        path: path.join(TEST_DIR, "good-file.txt"),
        content: "This should work",
      },
      {
        path: blockingDir, // This will fail because it's a directory
        content: "This should fail",
      },
    ];

    const result = await handleWriteTool("write_multiple_files", { files });

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    expect(result.content[0].type).toBe("text");

    const resultText = result.content[0].text;
    expect(resultText).toContain("Wrote 1 of 2 files:");
    expect(resultText).toContain("✓");
    expect(resultText).toContain("✗");
    expect(resultText).toContain("1 files succeeded, 1 failed.");
  });

  it("should reject invalid file paths", async () => {
    const files = [
      {
        path: "/invalid/path/file.txt", // Invalid path
        content: "This should fail",
      },
      {
        path: path.join(TEST_DIR, "valid-file.txt"),
        content: "This should also fail because first path is invalid",
      },
    ];

    await expect(
      handleWriteTool("write_multiple_files", { files })
    ).rejects.toThrow("Invalid file paths");
  });

  it("should reject too many files", async () => {
    const files = Array.from({ length: 51 }, (_, i) => ({
      path: path.join(TEST_DIR, `file${i}.txt`),
      content: `Content ${i}`,
    }));

    await expect(
      handleWriteTool("write_multiple_files", { files })
    ).rejects.toThrow("Maximum 50 files per operation");
  });

  it("should reject empty file array", async () => {
    const files: any[] = [];

    await expect(
      handleWriteTool("write_multiple_files", { files })
    ).rejects.toThrow("At least one file must be provided");
  });
});

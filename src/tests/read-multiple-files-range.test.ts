import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import { handleReadTool } from "../tools/read-tools.js";
import { setAllowedDirectories } from "../utils/lib.js";
import fs from "fs/promises";
import path from "path";
import os from "os";

const TEST_WORKSPACE = path.join(os.tmpdir(), "test-read-multiple");

describe("read_multiple_files with mode support", () => {
  let file1: string;
  let file2: string;
  let file3: string;

  beforeAll(async () => {
    await fs.mkdir(TEST_WORKSPACE, { recursive: true });

    // Create test files
    file1 = path.join(TEST_WORKSPACE, "file1.txt");
    file2 = path.join(TEST_WORKSPACE, "file2.txt");
    file3 = path.join(TEST_WORKSPACE, "file3.txt");

    const lines1 = Array.from({ length: 100 }, (_, i) => `File1 Line ${i + 1}`);
    const lines2 = Array.from({ length: 100 }, (_, i) => `File2 Line ${i + 1}`);
    const lines3 = Array.from({ length: 100 }, (_, i) => `File3 Line ${i + 1}`);

    await fs.writeFile(file1, lines1.join("\n"));
    await fs.writeFile(file2, lines2.join("\n"));
    await fs.writeFile(file3, lines3.join("\n"));

    setAllowedDirectories([TEST_WORKSPACE]);
  });

  afterAll(async () => {
    await fs.rm(TEST_WORKSPACE, { recursive: true, force: true });
  });

  test("reads multiple files with different modes", async () => {
    const result = await handleReadTool("read_multiple_files", {
      files: [
        { path: file1, mode: "range", startLine: 10, endLine: 20 },
        { path: file2, mode: "head", lines: 5 },
        { path: file3, mode: "tail", lines: 3 },
      ],
    });

    expect(result.content).toBeDefined();
    expect(result.content[0].type).toBe("text");
    const text = (result.content[0] as { type: string; text: string }).text;

    // File 1 should contain lines 10-20
    expect(text).toContain("File1 Line 10");
    expect(text).toContain("File1 Line 20");
    expect(text).not.toContain("File1 Line 9");
    expect(text).not.toContain("File1 Line 21");

    // File 2 should contain first 5 lines
    expect(text).toContain("File2 Line 1");
    expect(text).toContain("File2 Line 5");
    expect(text).not.toContain("File2 Line 6");

    // File 3 should contain last 3 lines
    expect(text).toContain("File3 Line 98");
    expect(text).toContain("File3 Line 100");
    expect(text).not.toContain("File3 Line 97");
  });

  test("defaults to full mode when mode not specified", async () => {
    const result = await handleReadTool("read_multiple_files", {
      files: [
        { path: file1 }, // No mode specified
        { path: file2, mode: "full" },
      ],
    });

    const text = (result.content[0] as { type: string; text: string }).text;

    // Both should read full files
    expect(text).toContain("File1 Line 1");
    expect(text).toContain("File1 Line 100");
    expect(text).toContain("File2 Line 1");
    expect(text).toContain("File2 Line 100");
  });

  test("handles errors in individual files without stopping others", async () => {
    const result = await handleReadTool("read_multiple_files", {
      files: [
        { path: file1, mode: "head", lines: 5 },
        { path: path.join(TEST_WORKSPACE, "nonexistent.txt"), mode: "full" },
        { path: file2, mode: "tail", lines: 3 },
      ],
    });

    const text = (result.content[0] as { type: string; text: string }).text;

    // File 1 should succeed
    expect(text).toContain("File1 Line 1");
    expect(text).toContain("File1 Line 5");

    // File 2 should succeed despite nonexistent file error
    expect(text).toContain("File2 Line 98");
    expect(text).toContain("File2 Line 100");

    // Error should be reported
    expect(text).toContain("Error");
    expect(text).toContain("nonexistent.txt");
  });

  test("validates per-file mode parameters", async () => {
    // Invalid: range mode without startLine
    await expect(
      handleReadTool("read_multiple_files", {
        files: [{ path: file1, mode: "range", endLine: 20 }],
      })
    ).rejects.toThrow();

    // Invalid: head mode without lines
    await expect(
      handleReadTool("read_multiple_files", {
        files: [{ path: file1, mode: "head" }],
      })
    ).rejects.toThrow();

    // Invalid: range mode with lines parameter
    await expect(
      handleReadTool("read_multiple_files", {
        files: [
          { path: file1, mode: "range", startLine: 10, endLine: 20, lines: 5 },
        ],
      })
    ).rejects.toThrow();
  });

  test("processes files concurrently (performance check)", async () => {
    const start = Date.now();

    await handleReadTool("read_multiple_files", {
      files: [
        { path: file1, mode: "head", lines: 10 },
        { path: file2, mode: "head", lines: 10 },
        { path: file3, mode: "head", lines: 10 },
      ],
    });

    const duration = Date.now() - start;

    // Concurrent processing should be reasonably fast
    // This is a loose check; adjust based on system performance
    expect(duration).toBeLessThan(1000);
  });

  test("handles mixed modes efficiently", async () => {
    const result = await handleReadTool("read_multiple_files", {
      files: [
        { path: file1, mode: "range", startLine: 1, endLine: 10 },
        { path: file2, mode: "range", startLine: 50, endLine: 60 },
        { path: file3, mode: "full" },
      ],
    });

    const text = (result.content[0] as { type: string; text: string }).text;

    // Verify each file's content
    expect(text).toContain("File1 Line 1");
    expect(text).toContain("File1 Line 10");
    expect(text).toContain("File2 Line 50");
    expect(text).toContain("File2 Line 60");
    expect(text).toContain("File3 Line 1");
    expect(text).toContain("File3 Line 100");
  });

  test("respects file separation with ---", async () => {
    const result = await handleReadTool("read_multiple_files", {
      files: [
        { path: file1, mode: "head", lines: 2 },
        { path: file2, mode: "head", lines: 2 },
      ],
    });

    const text = (result.content[0] as { type: string; text: string }).text;

    // Files should be separated by ---
    expect(text).toContain("---");

    const parts = text.split("\n---\n");
    expect(parts.length).toBe(2);
  });

  test("handles empty files gracefully", async () => {
    const emptyFile = path.join(TEST_WORKSPACE, "empty.txt");
    await fs.writeFile(emptyFile, "");

    const result = await handleReadTool("read_multiple_files", {
      files: [
        { path: file1, mode: "head", lines: 2 },
        { path: emptyFile, mode: "full" },
        { path: file2, mode: "head", lines: 2 },
      ],
    });

    const text = (result.content[0] as { type: string; text: string }).text;

    // Should handle empty file without errors
    expect(text).toContain("File1 Line 1");
    expect(text).toContain("File2 Line 1");

    await fs.unlink(emptyFile);
  });

  test("handles maximum file limit", async () => {
    // Create 50 files (maximum allowed)
    const files = [];
    for (let i = 0; i < 50; i++) {
      const filePath = path.join(TEST_WORKSPACE, `temp-${i}.txt`);
      await fs.writeFile(filePath, `Content ${i}`);
      files.push({ path: filePath, mode: "full" as const });
    }

    // Should succeed with 50 files
    const result = await handleReadTool("read_multiple_files", { files });
    expect(result.content).toBeDefined();

    // Cleanup
    for (let i = 0; i < 50; i++) {
      await fs.unlink(path.join(TEST_WORKSPACE, `temp-${i}.txt`));
    }

    // Should reject with 51 files
    const tooManyFiles = [...files, { path: file1, mode: "full" as const }];
    await expect(
      handleReadTool("read_multiple_files", { files: tooManyFiles })
    ).rejects.toThrow();
  });

  test("handles single line reads via range mode", async () => {
    const result = await handleReadTool("read_multiple_files", {
      files: [
        { path: file1, mode: "range", startLine: 42, endLine: 42 },
        { path: file2, mode: "range", startLine: 50, endLine: 50 },
      ],
    });

    const text = (result.content[0] as { type: string; text: string }).text;

    expect(text).toContain("File1 Line 42");
    expect(text).not.toContain("File1 Line 41");
    expect(text).not.toContain("File1 Line 43");

    expect(text).toContain("File2 Line 50");
    expect(text).not.toContain("File2 Line 49");
    expect(text).not.toContain("File2 Line 51");
  });

  test("validates minimum file requirement", async () => {
    // Should reject empty files array
    await expect(
      handleReadTool("read_multiple_files", { files: [] })
    ).rejects.toThrow();
  });
});

import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import { rangeFile } from "../utils/lib.js";
import { handleReadTool } from "../tools/read-tools.js";
import { setAllowedDirectories } from "../utils/lib.js";
import fs from "fs/promises";
import path from "path";
import os from "os";

const TEST_WORKSPACE = path.join(os.tmpdir(), "test-range-file");

describe("rangeFile utility function", () => {
  let testFilePath: string;

  beforeAll(async () => {
    // Create test workspace
    await fs.mkdir(TEST_WORKSPACE, { recursive: true });
    setAllowedDirectories([TEST_WORKSPACE]);
  });

  afterAll(async () => {
    // Cleanup test workspace
    await fs.rm(TEST_WORKSPACE, { recursive: true, force: true });
  });

  beforeEach(async () => {
    // Create test file with known content
    testFilePath = path.join(TEST_WORKSPACE, "test-range-file.txt");
    const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`);
    await fs.writeFile(testFilePath, lines.join("\n"));
  });

  afterEach(async () => {
    try {
      await fs.unlink(testFilePath);
    } catch {
      // File may not exist
    }
  });

  test("should read middle range of lines", async () => {
    const result = await rangeFile(testFilePath, 10, 20);
    const lines = result.split("\n");
    expect(lines).toHaveLength(11); // 10 to 20 inclusive
    expect(lines[0]).toBe("Line 10");
    expect(lines[10]).toBe("Line 20");
  });

  test("should read single line", async () => {
    const result = await rangeFile(testFilePath, 42, 42);
    expect(result).toBe("Line 42");
  });

  test("should read first few lines (equivalent to head)", async () => {
    const result = await rangeFile(testFilePath, 1, 5);
    const lines = result.split("\n");
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe("Line 1");
    expect(lines[4]).toBe("Line 5");
  });

  test("should read last few lines (similar to tail)", async () => {
    const result = await rangeFile(testFilePath, 96, 100);
    const lines = result.split("\n");
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe("Line 96");
    expect(lines[4]).toBe("Line 100");
  });

  test("should handle range extending beyond file end", async () => {
    const result = await rangeFile(testFilePath, 95, 200);
    const lines = result.split("\n");
    expect(lines.length).toBeLessThanOrEqual(6); // Only 95-100 exist
    expect(lines[0]).toBe("Line 95");
  });

  test("should handle empty result when startLine > file length", async () => {
    const result = await rangeFile(testFilePath, 200, 300);
    expect(result).toBe("");
  });

  test("should handle large ranges efficiently", async () => {
    // Create larger test file
    const largeFilePath = path.join(TEST_WORKSPACE, "large-test.txt");
    const largeLines = Array.from({ length: 10000 }, (_, i) => `Line ${i + 1}`);
    await fs.writeFile(largeFilePath, largeLines.join("\n"));

    const result = await rangeFile(largeFilePath, 5000, 6000);
    const lines = result.split("\n");
    expect(lines).toHaveLength(1001); // 5000 to 6000 inclusive
    expect(lines[0]).toBe("Line 5000");
    expect(lines[1000]).toBe("Line 6000");

    await fs.unlink(largeFilePath);
  });

  test("should handle files without trailing newline", async () => {
    const noNewlinePath = path.join(TEST_WORKSPACE, "no-newline.txt");
    await fs.writeFile(noNewlinePath, "Line 1\nLine 2\nLine 3");

    const result = await rangeFile(noNewlinePath, 2, 3);
    const lines = result.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("Line 2");
    expect(lines[1]).toBe("Line 3");

    await fs.unlink(noNewlinePath);
  });

  test("should handle CRLF line endings", async () => {
    const crlfPath = path.join(TEST_WORKSPACE, "crlf.txt");
    await fs.writeFile(crlfPath, "Line 1\r\nLine 2\r\nLine 3\r\n");

    const result = await rangeFile(crlfPath, 1, 2);
    const lines = result.split("\n");
    expect(lines).toHaveLength(2);
    // CRLF should be handled - \r remains with the line
    expect(lines[0]).toBe("Line 1\r");
    expect(lines[1]).toBe("Line 2\r");

    await fs.unlink(crlfPath);
  });

  test("should handle empty file", async () => {
    const emptyPath = path.join(TEST_WORKSPACE, "empty.txt");
    await fs.writeFile(emptyPath, "");

    const result = await rangeFile(emptyPath, 1, 10);
    expect(result).toBe("");

    await fs.unlink(emptyPath);
  });

  test("should handle very long lines (>1KB)", async () => {
    const longLinePath = path.join(TEST_WORKSPACE, "long-lines.txt");
    const longLine1 = "A".repeat(2000);
    const longLine2 = "B".repeat(2000);
    const longLine3 = "C".repeat(2000);
    await fs.writeFile(
      longLinePath,
      `${longLine1}\n${longLine2}\n${longLine3}`
    );

    const result = await rangeFile(longLinePath, 2, 2);
    expect(result).toBe(longLine2);

    await fs.unlink(longLinePath);
  });
});

describe("read_file with range mode", () => {
  let testFilePath: string;

  beforeAll(async () => {
    await fs.mkdir(TEST_WORKSPACE, { recursive: true });
    setAllowedDirectories([TEST_WORKSPACE]);

    // Create test file
    testFilePath = path.join(TEST_WORKSPACE, "test-integration.txt");
    const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`);
    await fs.writeFile(testFilePath, lines.join("\n"));
  });

  afterAll(async () => {
    await fs.rm(TEST_WORKSPACE, { recursive: true, force: true });
  });

  test("should validate range parameters correctly", async () => {
    // Valid range request
    const result = await handleReadTool("read_file", {
      path: testFilePath,
      mode: "range",
      startLine: 10,
      endLine: 20,
    });

    expect(result.content).toBeDefined();
    expect(result.content[0].type).toBe("text");
    const text = (result.content[0] as { type: string; text: string }).text;
    expect(text).toContain("Line 10");
    expect(text).toContain("Line 20");
  });

  test("should reject range without startLine", async () => {
    await expect(
      handleReadTool("read_file", {
        path: testFilePath,
        mode: "range",
        endLine: 20,
      })
    ).rejects.toThrow();
  });

  test("should reject range without endLine", async () => {
    await expect(
      handleReadTool("read_file", {
        path: testFilePath,
        mode: "range",
        startLine: 10,
      })
    ).rejects.toThrow();
  });

  test("should reject range where startLine > endLine", async () => {
    await expect(
      handleReadTool("read_file", {
        path: testFilePath,
        mode: "range",
        startLine: 20,
        endLine: 10,
      })
    ).rejects.toThrow();
  });

  test("should reject range with lines parameter", async () => {
    await expect(
      handleReadTool("read_file", {
        path: testFilePath,
        mode: "range",
        startLine: 10,
        endLine: 20,
        lines: 5, // Should not be provided in range mode
      })
    ).rejects.toThrow();
  });

  test("should reject head mode with startLine/endLine", async () => {
    await expect(
      handleReadTool("read_file", {
        path: testFilePath,
        mode: "head",
        lines: 10,
        startLine: 1,
      })
    ).rejects.toThrow();
  });

  test("should reject full mode with any parameters", async () => {
    await expect(
      handleReadTool("read_file", {
        path: testFilePath,
        mode: "full",
        lines: 10,
      })
    ).rejects.toThrow();
  });

  test("should work with existing modes (head, tail, full)", async () => {
    // Test head mode still works
    const headResult = await handleReadTool("read_file", {
      path: testFilePath,
      mode: "head",
      lines: 5,
    });
    const headText = (headResult.content[0] as { type: string; text: string })
      .text;
    expect(headText).toContain("Line 1");
    expect(headText).toContain("Line 5");

    // Test tail mode still works
    const tailResult = await handleReadTool("read_file", {
      path: testFilePath,
      mode: "tail",
      lines: 5,
    });
    const tailText = (tailResult.content[0] as { type: string; text: string })
      .text;
    expect(tailText).toContain("Line 96");
    expect(tailText).toContain("Line 100");

    // Test full mode still works
    const fullResult = await handleReadTool("read_file", {
      path: testFilePath,
      mode: "full",
    });
    const fullText = (fullResult.content[0] as { type: string; text: string })
      .text;
    expect(fullText).toContain("Line 1");
    expect(fullText).toContain("Line 100");
  });
});

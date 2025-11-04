import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { handleReadTool } from "../tools/read-tools.js";
import { setAllowedDirectories, getAllowedDirectories } from "../utils/lib.js";

const TEST_FIXTURES_DIR = path.join(__dirname, "fixtures");
const TEST_WORKSPACE = path.join(os.tmpdir(), `vulcan-test-read-docs-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
const FIXTURES_DIR = path.join(TEST_WORKSPACE, "fixtures");

// Helper to set test roots
async function setupTestEnvironment() {
  // Create test workspace and fixtures directory
  await fs.mkdir(FIXTURES_DIR, { recursive: true });

  // Create regular text file for testing
  await fs.writeFile(
    path.join(FIXTURES_DIR, "text.txt"),
    "Plain text content\nLine 2\nLine 3"
  );

  // Register test directories (include test fixtures and test workspace)
  const currentDirs = getAllowedDirectories();
  setAllowedDirectories([...currentDirs, TEST_FIXTURES_DIR, TEST_WORKSPACE]);
}

async function cleanupTestEnvironment() {
  try {
    await fs.rm(TEST_WORKSPACE, { recursive: true, force: true });
  } catch (error) {
    // Ignore cleanup errors
  }
}

describe("read_file with documents", () => {
  beforeAll(async () => {
    await setupTestEnvironment();
  });

  afterAll(async () => {
    await cleanupTestEnvironment();
  });

  // FIXME: PDF parsing broken due to pdfjs-dist import.meta issue in Jest
  test.skip("reads PDF through read_file", async () => {
    const result = await handleReadTool("read_file", {
      path: path.join(TEST_FIXTURES_DIR, "sample.pdf"),
    });

    expect(result.content).toBeDefined();
    expect(result.content[0].type).toBe("text");

    const content = result.content[0] as { type: string; text: string };
    expect(content.text).toContain("Document:");
    expect(content.text).toContain("Format: PDF");
  }, 10000);

  test("reads text file through read_file (unchanged behavior)", async () => {
    const result = await handleReadTool("read_file", {
      path: path.join(FIXTURES_DIR, "text.txt"),
    });

    expect(result.content).toBeDefined();
    expect(result.content[0].type).toBe("text");

    const content = result.content[0] as { type: string; text: string };
    expect(content.text).toContain("Plain text content");
    expect(content.text).not.toContain("Document:");
    expect(content.text).not.toContain("Format:");
  });

  // FIXME: PDF parsing broken due to pdfjs-dist import.meta issue in Jest
  test.skip("mode parameters ignored for PDF documents", async () => {
    const resultFull = await handleReadTool("read_file", {
      path: path.join(TEST_FIXTURES_DIR, "sample.pdf"),
      mode: "full",
    });

    const resultHead = await handleReadTool("read_file", {
      path: path.join(TEST_FIXTURES_DIR, "sample.pdf"),
      mode: "head",
      lines: 5,
    });

    const resultTail = await handleReadTool("read_file", {
      path: path.join(TEST_FIXTURES_DIR, "sample.pdf"),
      mode: "tail",
      lines: 5,
    });

    // All should return the same full document content
    const contentFull = resultFull.content[0] as { type: string; text: string };
    const contentHead = resultHead.content[0] as { type: string; text: string };
    const contentTail = resultTail.content[0] as { type: string; text: string };

    expect(contentFull.text).toBe(contentHead.text);
    expect(contentFull.text).toBe(contentTail.text);
  }, 10000);

  test("mode parameters work for text files", async () => {
    const resultFull = await handleReadTool("read_file", {
      path: path.join(FIXTURES_DIR, "text.txt"),
      mode: "full",
    });

    const resultHead = await handleReadTool("read_file", {
      path: path.join(FIXTURES_DIR, "text.txt"),
      mode: "head",
      lines: 2,
    });

    // Head should have less content than full
    const contentFull = resultFull.content[0] as { type: string; text: string };
    const contentHead = resultHead.content[0] as { type: string; text: string };

    expect(contentHead.text.length).toBeLessThan(contentFull.text.length);
    expect(contentHead.text).toContain("Plain text content");
    expect(contentHead.text).toContain("Line 2");
  });
});

describe("read_multiple_files with documents", () => {
  beforeAll(async () => {
    await setupTestEnvironment();
  });

  afterAll(async () => {
    await cleanupTestEnvironment();
  });

  // FIXME: PDF parsing broken due to pdfjs-dist import.meta issue in Jest
  test.skip("reads mixed text and document files", async () => {
    const result = await handleReadTool("read_multiple_files", {
      files: [
        { path: path.join(FIXTURES_DIR, "text.txt") },
        { path: path.join(TEST_FIXTURES_DIR, "sample.pdf") },
      ],
    });

    expect(result.content).toBeDefined();
    expect(result.content[0].type).toBe("text");

    const content = result.content[0] as { type: string; text: string };
    const text = content.text;

    // Should contain both files
    expect(text).toContain("text.txt");
    expect(text).toContain("sample.pdf");

    // Text file should have plain content
    expect(text).toContain("Plain text content");

    // PDF should have format indicator
    expect(text).toContain("Format: PDF");

    // Should be separated
    expect(text).toContain("---");
  }, 10000);

  test("handles errors gracefully in batch operations", async () => {
    // Create another valid text file for testing
    await fs.writeFile(path.join(FIXTURES_DIR, "valid.txt"), "Valid content");

    const result = await handleReadTool("read_multiple_files", {
      files: [
        { path: path.join(FIXTURES_DIR, "text.txt") },
        { path: path.join(FIXTURES_DIR, "nonexistent.txt") },
        { path: path.join(FIXTURES_DIR, "valid.txt") },
      ],
    });

    const content = result.content[0] as { type: string; text: string };
    const text = content.text;

    // Should process valid files
    expect(text).toContain("text.txt");
    expect(text).toContain("valid.txt");
    expect(text).toContain("Plain text content");
    expect(text).toContain("Valid content");

    // Should show error for invalid file
    expect(text).toContain("nonexistent.txt");
    expect(text).toContain("Error");
  }, 10000);

  // FIXME: PDF parsing broken due to pdfjs-dist import.meta issue in Jest
  test.skip("returns consistent format for document files", async () => {
    const result = await handleReadTool("read_multiple_files", {
      files: [{ path: path.join(TEST_FIXTURES_DIR, "sample.pdf") }],
    });

    const content = result.content[0] as { type: string; text: string };
    const text = content.text;

    // Should have file path
    expect(text).toContain("sample.pdf");

    // Should have format indicator
    expect(text).toContain("Format: PDF");
  }, 10000);
});

describe("read_file backwards compatibility", () => {
  beforeAll(async () => {
    await setupTestEnvironment();
  });

  afterAll(async () => {
    await cleanupTestEnvironment();
  });

  test("head mode still works for text files", async () => {
    const result = await handleReadTool("read_file", {
      path: path.join(FIXTURES_DIR, "text.txt"),
      mode: "head",
      lines: 1,
    });

    const content = result.content[0] as { type: string; text: string };
    expect(content.text).toContain("Plain text content");
    expect(content.text).not.toContain("Line 2");
  });

  test("tail mode still works for text files", async () => {
    const result = await handleReadTool("read_file", {
      path: path.join(FIXTURES_DIR, "text.txt"),
      mode: "tail",
      lines: 1,
    });

    const content = result.content[0] as { type: string; text: string };
    expect(content.text).toContain("Line 3");
    expect(content.text).not.toContain("Plain text content");
  });

  test("full mode still works for text files", async () => {
    const result = await handleReadTool("read_file", {
      path: path.join(FIXTURES_DIR, "text.txt"),
      mode: "full",
    });

    const content = result.content[0] as { type: string; text: string };
    expect(content.text).toContain("Plain text content");
    expect(content.text).toContain("Line 2");
    expect(content.text).toContain("Line 3");
  });
});

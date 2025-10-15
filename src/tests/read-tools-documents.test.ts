import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import { promises as fs } from "fs";
import path from "path";
import { handleReadTool } from "../tools/read-tools.js";
import { setAllowedDirectories, getAllowedDirectories } from "../utils/lib.js";

const FIXTURES_DIR = path.join(__dirname, "fixtures");
const TEST_WORKSPACE = path.join(__dirname, "..", "..", "test-workspace");

// Helper to set test roots
async function setupTestEnvironment() {
  // Create fixtures directory
  await fs.mkdir(FIXTURES_DIR, { recursive: true });

  // Create workspace directory
  await fs.mkdir(TEST_WORKSPACE, { recursive: true });

  // Create a minimal valid PDF
  const minimalPDF = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>
endobj
4 0 obj
<< /Length 50 >>
stream
BT
/F1 12 Tf
100 700 Td
(Integration Test PDF) Tj
ET
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000074 00000 n 
0000000133 00000 n 
0000000341 00000 n 
trailer
<< /Size 5 /Root 1 0 R >>
startxref
440
%%EOF`;

  await fs.writeFile(path.join(FIXTURES_DIR, "sample.pdf"), minimalPDF);

  // Create regular text file
  await fs.writeFile(
    path.join(FIXTURES_DIR, "text.txt"),
    "Plain text content\nLine 2\nLine 3"
  );

  // Register test directories
  const currentDirs = getAllowedDirectories();
  setAllowedDirectories([...currentDirs, FIXTURES_DIR, TEST_WORKSPACE]);
}

async function cleanupTestEnvironment() {
  try {
    await fs.rm(FIXTURES_DIR, { recursive: true, force: true });
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

  test("reads PDF through read_file", async () => {
    const result = await handleReadTool("read_file", {
      path: path.join(FIXTURES_DIR, "sample.pdf"),
    });

    expect(result.content).toBeDefined();
    expect(result.content[0].type).toBe("text");

    const content = result.content[0] as { type: string; text: string };
    expect(content.text).toContain("Document:");
    expect(content.text).toContain("Format: PDF");
  });

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

  test("mode parameters ignored for PDF documents", async () => {
    const resultFull = await handleReadTool("read_file", {
      path: path.join(FIXTURES_DIR, "sample.pdf"),
      mode: "full",
    });

    const resultHead = await handleReadTool("read_file", {
      path: path.join(FIXTURES_DIR, "sample.pdf"),
      mode: "head",
      lines: 5,
    });

    const resultTail = await handleReadTool("read_file", {
      path: path.join(FIXTURES_DIR, "sample.pdf"),
      mode: "tail",
      lines: 5,
    });

    // All should return the same full document content
    const contentFull = resultFull.content[0] as { type: string; text: string };
    const contentHead = resultHead.content[0] as { type: string; text: string };
    const contentTail = resultTail.content[0] as { type: string; text: string };

    expect(contentFull.text).toBe(contentHead.text);
    expect(contentFull.text).toBe(contentTail.text);
  });

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

  test("reads mixed text and document files", async () => {
    const result = await handleReadTool("read_multiple_files", {
      paths: [
        path.join(FIXTURES_DIR, "text.txt"),
        path.join(FIXTURES_DIR, "sample.pdf"),
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
  });

  test("handles errors gracefully in batch operations", async () => {
    const result = await handleReadTool("read_multiple_files", {
      paths: [
        path.join(FIXTURES_DIR, "text.txt"),
        path.join(FIXTURES_DIR, "nonexistent.pdf"),
        path.join(FIXTURES_DIR, "sample.pdf"),
      ],
    });

    const content = result.content[0] as { type: string; text: string };
    const text = content.text;

    // Should process valid files
    expect(text).toContain("text.txt");
    expect(text).toContain("sample.pdf");

    // Should show error for invalid file
    expect(text).toContain("nonexistent.pdf");
    expect(text).toContain("Error");
  });

  test("returns consistent format for document files", async () => {
    const result = await handleReadTool("read_multiple_files", {
      paths: [path.join(FIXTURES_DIR, "sample.pdf")],
    });

    const content = result.content[0] as { type: string; text: string };
    const text = content.text;

    // Should have file path
    expect(text).toContain("sample.pdf");

    // Should have format indicator
    expect(text).toContain("Format: PDF");
  });
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

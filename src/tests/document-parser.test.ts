import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import { promises as fs } from "fs";
import path from "path";
import {
  isDocumentFile,
  parseDocument,
  DocumentParseError,
} from "../utils/document-parser.js";

const TEST_FIXTURES_DIR = path.join(__dirname, "fixtures");
const TEST_WORKSPACE = path.join(__dirname, "..", "..", "test-workspace");
const FIXTURES_DIR = path.join(TEST_WORKSPACE, "fixtures");

// Helper to create test fixtures
async function createTestFixtures() {
  try {
    // Ensure the test workspace directory exists
    await fs.mkdir(TEST_WORKSPACE, { recursive: true });
    await fs.mkdir(FIXTURES_DIR, { recursive: true });

    // Create oversized file (>50MB)
    const largeContent = Buffer.alloc(51 * 1024 * 1024, "x"); // 51MB
    await fs.writeFile(path.join(FIXTURES_DIR, "huge-file.pdf"), largeContent);

    // Create legacy .doc placeholder
    await fs.writeFile(path.join(FIXTURES_DIR, "legacy.doc"), "placeholder");

    // Create regular text file
    await fs.writeFile(
      path.join(FIXTURES_DIR, "text.txt"),
      "Plain text content"
    );
  } catch (error) {
    console.error("Failed to create test fixtures:", error);
    throw error;
  }
}

async function cleanupTestFixtures() {
  try {
    await fs.rm(TEST_WORKSPACE, { recursive: true, force: true });
  } catch (error) {
    // Ignore cleanup errors
  }
}

describe("Document Parser", () => {
  beforeAll(async () => {
    await createTestFixtures();
  });

  afterAll(async () => {
    await cleanupTestFixtures();
  });

  describe("isDocumentFile", () => {
    test("detects PDF files", () => {
      expect(isDocumentFile("document.pdf")).toBe(true);
      expect(isDocumentFile("DOCUMENT.PDF")).toBe(true);
      expect(isDocumentFile("/path/to/file.pdf")).toBe(true);
    });

    test("detects DOCX files", () => {
      expect(isDocumentFile("doc.docx")).toBe(true);
      expect(isDocumentFile("DOC.DOCX")).toBe(true);
    });

    test("detects Office files", () => {
      expect(isDocumentFile("slides.pptx")).toBe(true);
      expect(isDocumentFile("data.xlsx")).toBe(true);
      expect(isDocumentFile("document.odt")).toBe(true);
      expect(isDocumentFile("presentation.odp")).toBe(true);
      expect(isDocumentFile("spreadsheet.ods")).toBe(true);
    });

    test("rejects text files", () => {
      expect(isDocumentFile("file.txt")).toBe(false);
      expect(isDocumentFile("code.js")).toBe(false);
      expect(isDocumentFile("style.css")).toBe(false);
      expect(isDocumentFile("README.md")).toBe(false);
    });

    test("rejects legacy .doc format", () => {
      expect(isDocumentFile("legacy.doc")).toBe(false);
    });

    test("handles files without extensions", () => {
      expect(isDocumentFile("README")).toBe(false);
      expect(isDocumentFile("Makefile")).toBe(false);
    });
  });

  describe("parseDocument", () => {
    test("parses PDF with pdf2json or pdf-parse fallback", async () => {
      const result = await parseDocument(
        path.join(TEST_FIXTURES_DIR, "sample.pdf")
      );

      expect(result.text).toBeDefined();
      expect(result.text.length).toBeGreaterThan(0);
      // Can use either pdf2json (primary) or pdf-parse (fallback)
      expect(["pdf2json", "pdf-parse"]).toContain(result.parser);
      expect(result.metadata?.format).toBe("PDF");
    }, 10000); // 10 second timeout for PDF parsing

    test("rejects oversized files", async () => {
      await expect(
        parseDocument(path.join(FIXTURES_DIR, "huge-file.pdf"))
      ).rejects.toThrow("too large");

      await expect(
        parseDocument(path.join(FIXTURES_DIR, "huge-file.pdf"))
      ).rejects.toThrow("Maximum: 50MB");
    });

    test("rejects legacy .doc format with helpful message", async () => {
      await expect(
        parseDocument(path.join(FIXTURES_DIR, "legacy.doc"))
      ).rejects.toThrow("Legacy .doc format not supported");

      await expect(
        parseDocument(path.join(FIXTURES_DIR, "legacy.doc"))
      ).rejects.toThrow("Convert to .docx");
    });

    test("rejects non-existent files", async () => {
      await expect(
        parseDocument(path.join(FIXTURES_DIR, "nonexistent.pdf"))
      ).rejects.toThrow();
    });

    test("rejects unsupported document formats", async () => {
      await expect(
        parseDocument(path.join(FIXTURES_DIR, "text.txt"))
      ).rejects.toThrow("Unsupported document format");
    });
  });

  describe("DocumentParseError", () => {
    test("creates error with correct properties", () => {
      const originalError = new Error("Original error message");
      const docError = new DocumentParseError(
        "/path/to/file.pdf",
        ".pdf",
        "Failed to parse PDF",
        originalError
      );

      expect(docError.name).toBe("DocumentParseError");
      expect(docError.message).toBe("Failed to parse PDF");
      expect(docError.filePath).toBe("/path/to/file.pdf");
      expect(docError.fileType).toBe(".pdf");
      expect(docError.originalError).toBe(originalError);
    });

    test("works without original error", () => {
      const docError = new DocumentParseError(
        "/path/to/file.pdf",
        ".pdf",
        "Failed to parse PDF"
      );

      expect(docError.originalError).toBeUndefined();
    });
  });
});

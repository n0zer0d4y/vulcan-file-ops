import path from "path";
import { promises as fs } from "fs";
import type { DocumentParseResult } from "../types/index.js";

// Lazy-loaded parsers (imported only when needed)
let pdfParse: any = null;
let mammoth: any = null;
let officeParser: any = null;

const DOCUMENT_EXTENSIONS = [
  ".pdf",
  ".docx",
  ".pptx",
  ".xlsx",
  ".odt",
  ".odp",
  ".ods",
] as const;

/**
 * Checks if file is a supported document format
 */
export function isDocumentFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return DOCUMENT_EXTENSIONS.includes(ext as any);
}

/**
 * Parse document with automatic format detection and fallback strategy
 */
export async function parseDocument(
  filePath: string
): Promise<DocumentParseResult> {
  const ext = path.extname(filePath).toLowerCase();
  const stats = await fs.stat(filePath);

  // File size validation
  const MAX_SIZE = 50 * 1024 * 1024; // 50MB
  if (stats.size > MAX_SIZE) {
    throw new Error(
      `Document too large (${(stats.size / 1024 / 1024).toFixed(1)}MB). ` +
        `Maximum: 50MB`
    );
  }

  // Check for legacy .doc format
  if (ext === ".doc") {
    throw new Error(
      "Legacy .doc format not supported. Convert to .docx:\n" +
        "- Microsoft Word: File > Save As > Word Document (.docx)\n" +
        "- LibreOffice: File > Save As > Word 2007-365 (.docx)\n" +
        "- Online: https://cloudconvert.com/doc-to-docx"
    );
  }

  try {
    switch (ext) {
      case ".pdf":
        return await parsePDF(filePath);

      case ".docx":
        return await parseDOCX(filePath);

      case ".pptx":
      case ".xlsx":
      case ".odt":
      case ".odp":
      case ".ods":
        return await parseOfficeDocument(filePath, ext);

      default:
        throw new Error(`Unsupported document format: ${ext}`);
    }
  } catch (error) {
    // Fallback to officeparser for Office formats only (NOT PDF)
    if ([".docx", ".pptx", ".xlsx", ".odt", ".odp", ".ods"].includes(ext)) {
      try {
        return await parseOfficeDocument(filePath, ext);
      } catch (fallbackError) {
        throw createUserFriendlyError(
          filePath,
          ext,
          error instanceof Error ? error : new Error(String(error))
        );
      }
    }
    throw error;
  }
}

/**
 * Parse PDF using pdf-parse
 */
async function parsePDF(filePath: string): Promise<DocumentParseResult> {
  // Lazy load pdf-parse
  if (!pdfParse) {
    const module = await import("pdf-parse");
    // Handle both ESM (PDFParse) and CommonJS (default function) exports
    pdfParse = (module as any).PDFParse || (module as any).default;
  }

  const buffer = await fs.readFile(filePath);

  // Check if it's a class or a function
  const data =
    typeof pdfParse === "function" && !pdfParse.prototype?.constructor
      ? await pdfParse(buffer) // Function-style API
      : await new pdfParse({ data: buffer }).getText(); // Class-style API

  return {
    text: data.text,
    metadata: {
      pages: data.numpages || data.info?.total,
      author: data.info?.Author,
      title: data.info?.Title,
      format: "PDF",
    },
    parser: "pdf-parse",
  };
}

/**
 * Parse DOCX using mammoth (primary) - WITH MARKDOWN FORMATTING
 */
async function parseDOCX(filePath: string): Promise<DocumentParseResult> {
  // Lazy load mammoth
  if (!mammoth) {
    mammoth = await import("mammoth");
  }

  // Use convertToMarkdown to preserve document structure
  const result = await mammoth.default.convertToMarkdown({
    path: filePath,
  });

  return {
    text: result.value,
    metadata: {
      format: "DOCX (Markdown)",
    },
    parser: "mammoth",
  };
}

/**
 * Parse Office documents using officeparser (fallback + other formats)
 */
async function parseOfficeDocument(
  filePath: string,
  ext: string
): Promise<DocumentParseResult> {
  // Lazy load officeparser
  if (!officeParser) {
    const module = await import("officeparser");
    officeParser = module.parseOfficeAsync;
  }

  const config = {
    outputErrorToConsole: false,
    newlineDelimiter: "\n",
    ignoreNotes: false,
    putNotesAtLast: false,
  };

  const text = await officeParser(filePath, config);

  return {
    text,
    metadata: {
      format: ext.toUpperCase().slice(1),
    },
    parser: "officeparser",
  };
}

/**
 * Custom error class for document parsing errors
 */
export class DocumentParseError extends Error {
  constructor(
    public filePath: string,
    public fileType: string,
    message: string,
    public originalError?: Error
  ) {
    super(message);
    this.name = "DocumentParseError";
  }
}

/**
 * Enhanced error messages for better user experience
 */
function createUserFriendlyError(
  filePath: string,
  ext: string,
  error: Error
): DocumentParseError {
  if (
    error.message.includes("encrypted") ||
    error.message.includes("password")
  ) {
    return new DocumentParseError(
      filePath,
      ext,
      `Password-protected ${ext.toUpperCase()} files are not supported. ` +
        `Please remove password protection and try again.`,
      error
    );
  }

  if (
    error.message.includes("corrupted") ||
    error.message.includes("invalid")
  ) {
    return new DocumentParseError(
      filePath,
      ext,
      `File appears to be corrupted or is not a valid ${ext.toUpperCase()} document.`,
      error
    );
  }

  return new DocumentParseError(
    filePath,
    ext,
    `Failed to parse ${ext.toUpperCase()} document: ${error.message}`,
    error
  );
}

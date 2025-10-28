/**
 * HTML-to-Document Conversion Utilities
 *
 * Provides HTML to PDF and HTML to DOCX conversion capabilities
 * using lightweight libraries (no browser/Chromium required).
 *
 * Libraries used:
 * - html-to-pdfmake + pdfmake: HTML → PDF conversion
 * - html-to-docx: HTML → DOCX conversion
 * - jsdom: DOM emulation for Node.js
 */

import { promises as fs } from "fs";

// Lazy-loaded libraries (imported only when needed)
let pdfMake: any = null;
let pdfFonts: any = null;
let htmlToPdfmake: any = null;
let HTMLtoDOCX: any = null;
let jsdom: any = null;

/**
 * Detect if content is HTML
 * Checks for common HTML tags and patterns
 */
export function isHTMLContent(content: string): boolean {
  // Trim whitespace for accurate detection
  const trimmed = content.trim();

  // Check for common HTML patterns
  const htmlPatterns = [
    /<html/i,
    /<body/i,
    /<head/i,
    /<h[1-6]>/i,
    /<p>/i,
    /<div>/i,
    /<table>/i,
    /<ul>/i,
    /<ol>/i,
    /<li>/i,
    /<span>/i,
    /<strong>/i,
    /<em>/i,
    /<br\s*\/?>/i,
  ];

  return htmlPatterns.some((pattern) => pattern.test(trimmed));
}

/**
 * Sanitize HTML for DOCX conversion
 * Converts problematic Unicode characters to HTML entities or safe alternatives
 */
function sanitizeHTMLForDOCX(html: string): string {
  // Replace common problematic Unicode characters with HTML entities or text alternatives
  return (
    html
      // Arrows
      .replace(/↑/g, "&uarr;") // Up arrow
      .replace(/↓/g, "&darr;") // Down arrow
      .replace(/→/g, "&rarr;") // Right arrow
      .replace(/←/g, "&larr;") // Left arrow
      .replace(/↔/g, "&harr;") // Left-right arrow
      // Math symbols
      .replace(/×/g, "&times;") // Multiplication
      .replace(/÷/g, "&divide;") // Division
      .replace(/±/g, "&plusmn;") // Plus-minus
      // Common typographic characters
      .replace(/—/g, "&mdash;") // Em dash
      .replace(/–/g, "&ndash;") // En dash
      .replace(/"/g, "&ldquo;") // Left double quote
      .replace(/"/g, "&rdquo;") // Right double quote
      .replace(/'/g, "&lsquo;") // Left single quote
      .replace(/'/g, "&rsquo;") // Right single quote
      .replace(/…/g, "&hellip;") // Ellipsis
      // Degree and other symbols
      .replace(/°/g, "&deg;") // Degree
      .replace(/©/g, "&copy;") // Copyright
      .replace(/®/g, "&reg;") // Registered
      .replace(/™/g, "&trade;") // Trademark
      // Bullets and special punctuation
      .replace(/•/g, "&bull;") // Bullet
      .replace(/§/g, "&sect;")
  ); // Section
}

/**
 * Convert HTML to PDF buffer using html-to-pdfmake + pdfmake
 *
 * This provides lightweight PDF generation without requiring Chromium.
 * Supports rich formatting including:
 * - Headings, paragraphs, text formatting
 * - Tables with borders and styling
 * - Lists (ordered and unordered)
 * - Colors, fonts, alignment
 * - Page breaks
 *
 * @param htmlContent - HTML string to convert
 * @param options - PDF generation options
 * @returns Buffer containing the PDF
 */
export async function htmlToPDF(
  htmlContent: string,
  options: {
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string[];
  } = {}
): Promise<Buffer> {
  // Lazy load dependencies
  if (!pdfMake) {
    const pdfmakeModule = await import("pdfmake/build/pdfmake.js");
    pdfMake = (pdfmakeModule as any).default || pdfmakeModule;
  }
  if (!pdfFonts) {
    const fontsModule = await import("pdfmake/build/vfs_fonts.js");
    pdfFonts = (fontsModule as any).default || fontsModule;
  }
  if (!htmlToPdfmake) {
    const htmlToPdfmakeModule = await import("html-to-pdfmake");
    htmlToPdfmake = (htmlToPdfmakeModule as any).default || htmlToPdfmakeModule;
  }
  if (!jsdom) {
    const jsdomModule = await import("jsdom");
    jsdom = jsdomModule.JSDOM;
  }

  // Initialize PDFMake fonts - handle different module structures
  if (!pdfMake.vfs) {
    // Try different ways to access the fonts
    if (pdfFonts.pdfMake && pdfFonts.pdfMake.vfs) {
      pdfMake.vfs = pdfFonts.pdfMake.vfs;
    } else if (pdfFonts.vfs) {
      pdfMake.vfs = pdfFonts.vfs;
    } else {
      // Last resort: assign the entire fonts object
      pdfMake.vfs = pdfFonts;
    }
  }

  // Create DOM window for html-to-pdfmake
  const { window } = new jsdom("");

  // Convert HTML to PDFMake format with styling
  const converted = htmlToPdfmake(htmlContent, {
    window,
    defaultStyles: {
      // Headings with colors
      h1: {
        fontSize: 24,
        bold: true,
        marginBottom: 10,
        color: "#2c3e50",
      },
      h2: {
        fontSize: 20,
        bold: true,
        marginBottom: 8,
        color: "#34495e",
      },
      h3: {
        fontSize: 18,
        bold: true,
        marginBottom: 6,
        color: "#34495e",
      },
      h4: {
        fontSize: 16,
        bold: true,
        marginBottom: 5,
      },
      h5: {
        fontSize: 14,
        bold: true,
        marginBottom: 5,
      },
      h6: {
        fontSize: 12,
        bold: true,
        marginBottom: 5,
      },
      // Paragraphs with spacing
      p: {
        margin: [0, 5, 0, 10],
      },
      // Tables with spacing
      table: {
        marginBottom: 10,
      },
      // Table headers with background
      th: {
        bold: true,
        fillColor: "#ecf0f1",
        color: "#2c3e50",
      },
      // Text formatting
      strong: {
        bold: true,
      },
      b: {
        bold: true,
      },
      em: {
        italics: true,
      },
      i: {
        italics: true,
      },
      u: {
        decoration: "underline",
      },
      s: {
        decoration: "lineThrough",
      },
      del: {
        decoration: "lineThrough",
      },
      // Lists
      ul: {
        marginBottom: 5,
      },
      ol: {
        marginBottom: 5,
      },
      li: {
        marginBottom: 3,
      },
    },
    tableAutoSize: true, // Auto-calculate table dimensions
    removeExtraBlanks: true, // Clean up whitespace
  });

  // Create PDF document definition
  const docDefinition = {
    content: converted,
    info: {
      title: options.title || "Document",
      author: options.author || "vulcan-file-ops",
      subject: options.subject || "",
      keywords: options.keywords?.join(", ") || "",
      creator: "Vulcan File Ops MCP Server",
      producer: "pdfmake + html-to-pdfmake",
    },
    // Default page settings
    pageSize: "A4",
    pageMargins: [40, 60, 40, 60],
  };

  // Generate PDF and return as Buffer
  return new Promise((resolve, reject) => {
    try {
      const pdfDoc = pdfMake.createPdf(docDefinition);
      pdfDoc.getBuffer((buffer: Buffer) => {
        resolve(buffer);
      });
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Convert HTML to DOCX buffer using html-to-docx
 *
 * Creates Word-compatible DOCX files with formatting.
 * Supports:
 * - Headings, paragraphs, text formatting
 * - Tables
 * - Lists
 * - Images (Base64)
 * - Page breaks
 * - Headers and footers (via options)
 *
 * @param htmlContent - HTML string to convert
 * @param options - DOCX generation options
 * @returns Buffer containing the DOCX
 */
export async function htmlToDOCX(
  htmlContent: string,
  options: {
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string[];
    orientation?: "portrait" | "landscape";
  } = {}
): Promise<Buffer> {
  // Lazy load @turbodocx/html-to-docx (maintained fork with better Word compatibility)
  if (!HTMLtoDOCX) {
    const module = await import("@turbodocx/html-to-docx");
    HTMLtoDOCX = (module as any).default || module;
  }

  // Sanitize HTML to handle problematic Unicode characters
  const sanitizedHTML = sanitizeHTMLForDOCX(htmlContent);

  // DOCX generation options
  const docxOptions = {
    title: options.title || "Document",
    creator: options.author || "vulcan-file-ops",
    subject: options.subject || "",
    keywords: options.keywords || [],
    description: options.subject || "",
    orientation: (options.orientation || "portrait") as
      | "portrait"
      | "landscape",
    margins: {
      top: 1440, // 1 inch in TWIP units
      right: 1800, // 1.25 inches
      bottom: 1440, // 1 inch
      left: 1800, // 1.25 inches
    },
    font: "Arial",
    fontSize: 22, // 22 HIP = 11pt
    // Enable page numbers in footer
    pageNumber: false,
    footer: false,
    header: false,
  };

  // Convert HTML to DOCX
  const buffer = await HTMLtoDOCX(sanitizedHTML, null, docxOptions);

  return buffer;
}

/**
 * Enhanced HTML-to-PDF conversion with error handling and fallback
 *
 * @param htmlContent - HTML string to convert
 * @param options - Conversion options
 * @returns PDF buffer or throws error
 */
export async function convertHTMLToPDF(
  htmlContent: string,
  options: {
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string[];
  } = {}
): Promise<Buffer> {
  try {
    // Handle empty or whitespace-only HTML
    const trimmed = htmlContent.trim();
    if (!trimmed) {
      // Return a minimal PDF with at least a paragraph
      htmlContent = "<html><body><p></p></body></html>";
    }

    return await htmlToPDF(htmlContent, options);
  } catch (error) {
    throw new Error(
      `Failed to convert HTML to PDF: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Enhanced HTML-to-DOCX conversion with error handling and fallback
 *
 * @param htmlContent - HTML string to convert
 * @param options - Conversion options
 * @returns DOCX buffer or throws error
 */
export async function convertHTMLToDOCX(
  htmlContent: string,
  options: {
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string[];
    orientation?: "portrait" | "landscape";
  } = {}
): Promise<Buffer> {
  try {
    // Handle empty or whitespace-only HTML
    const trimmed = htmlContent.trim();
    if (!trimmed) {
      // Return a minimal DOCX with at least a paragraph
      htmlContent = "<html><body><p></p></body></html>";
    }

    return await htmlToDOCX(htmlContent, options);
  } catch (error) {
    throw new Error(
      `Failed to convert HTML to DOCX: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

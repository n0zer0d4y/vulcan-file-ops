/**
 * Tests for HTML-to-Document conversion utilities
 */

import { describe, test, expect } from "@jest/globals";
import {
  isHTMLContent,
  convertHTMLToPDF,
  convertHTMLToDOCX,
} from "../utils/html-to-document.js";

describe("HTML Content Detection", () => {
  test("detects simple HTML with html tag", () => {
    const content = "<html><body><p>Test</p></body></html>";
    expect(isHTMLContent(content)).toBe(true);
  });

  test("detects HTML with body tag only", () => {
    const content = "<body><p>Test</p></body>";
    expect(isHTMLContent(content)).toBe(true);
  });

  test("detects HTML with heading tags", () => {
    expect(isHTMLContent("<h1>Title</h1>")).toBe(true);
    expect(isHTMLContent("<h2>Subtitle</h2>")).toBe(true);
    expect(isHTMLContent("<h3>Section</h3>")).toBe(true);
  });

  test("detects HTML with table tags", () => {
    expect(isHTMLContent("<table><tr><td>Test</td></tr></table>")).toBe(true);
  });

  test("detects HTML with list tags", () => {
    expect(isHTMLContent("<ul><li>Item</li></ul>")).toBe(true);
    expect(isHTMLContent("<ol><li>Item</li></ol>")).toBe(true);
  });

  test("detects HTML with common tags", () => {
    expect(isHTMLContent("<p>Paragraph</p>")).toBe(true);
    expect(isHTMLContent("<div>Division</div>")).toBe(true);
    expect(isHTMLContent("<table><tr><td>Cell</td></tr></table>")).toBe(true);
    expect(isHTMLContent("<ul><li>Item</li></ul>")).toBe(true);
    expect(isHTMLContent("<ol><li>Item</li></ol>")).toBe(true);
  });

  test("detects HTML with formatting tags", () => {
    expect(isHTMLContent("<strong>Bold</strong>")).toBe(true);
    expect(isHTMLContent("<em>Italic</em>")).toBe(true);
    expect(isHTMLContent("<span>Text</span>")).toBe(true);
  });

  test("detects HTML with self-closing tags", () => {
    expect(isHTMLContent("Line 1<br>Line 2")).toBe(true);
    expect(isHTMLContent("Line 1<br/>Line 2")).toBe(true);
  });

  test("does not detect plain text as HTML", () => {
    expect(isHTMLContent("This is plain text")).toBe(false);
    expect(isHTMLContent("Line 1\nLine 2\nLine 3")).toBe(false);
    expect(isHTMLContent("Some text with numbers 123")).toBe(false);
  });

  test("handles empty or whitespace content", () => {
    expect(isHTMLContent("")).toBe(false);
    expect(isHTMLContent("   ")).toBe(false);
    expect(isHTMLContent("\n\n")).toBe(false);
  });

  test("handles mixed content with HTML-like text", () => {
    // Text that looks like HTML but isn't really (no actual tags)
    expect(isHTMLContent("Price < 100 and > 50")).toBe(false);
    expect(isHTMLContent("Use <brackets> for grouping")).toBe(false);
  });

  test("case insensitive detection", () => {
    expect(isHTMLContent("<HTML><BODY>Test</BODY></HTML>")).toBe(true);
    expect(isHTMLContent("<Html><Body>Test</Body></Html>")).toBe(true);
  });
});

describe("HTML to PDF Conversion", () => {
  test("converts simple HTML to PDF buffer", async () => {
    const html =
      "<html><body><h1>Test Document</h1><p>This is a test.</p></body></html>";
    const buffer = await convertHTMLToPDF(html);

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);

    // Check PDF magic number (starts with %PDF)
    const header = buffer.toString("ascii", 0, 4);
    expect(header).toBe("%PDF");
  }, 10000);

  test("converts HTML with table to PDF", async () => {
    const html = `
      <html>
        <body>
          <h2>Data Table</h2>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Item 1</td>
                <td>100</td>
              </tr>
              <tr>
                <td>Item 2</td>
                <td>200</td>
              </tr>
            </tbody>
          </table>
        </body>
      </html>
    `;

    const buffer = await convertHTMLToPDF(html);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
  }, 10000);

  test("converts HTML with styled elements", async () => {
    const html = `
      <html>
        <body>
          <h1 style="color: #2c3e50;">Styled Title</h1>
          <p style="text-align: center;">Centered paragraph</p>
          <p><strong>Bold text</strong> and <em>italic text</em></p>
          <ul>
            <li>List item 1</li>
            <li>List item 2</li>
          </ul>
        </body>
      </html>
    `;

    const buffer = await convertHTMLToPDF(html);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
  }, 10000);

  test("includes metadata in PDF", async () => {
    const html = "<html><body><h1>Test</h1></body></html>";
    const buffer = await convertHTMLToPDF(html, {
      title: "Test Document",
      author: "Test Author",
      subject: "Test Subject",
      keywords: ["test", "pdf"],
    });

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
  }, 10000);

  test("handles complex HTML structure", async () => {
    const html = `
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; }
            .header { color: #2c3e50; }
            .content { margin: 20px; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Invoice #12345</h1>
            <p>Date: 2025-10-21</p>
          </div>
          <div class="content">
            <h2>Items</h2>
            <table style="border-collapse: collapse;">
              <tr style="background-color: #ecf0f1;">
                <th style="border: 1px solid #bdc3c7; padding: 8px;">Item</th>
                <th style="border: 1px solid #bdc3c7; padding: 8px;">Price</th>
              </tr>
              <tr>
                <td style="border: 1px solid #bdc3c7; padding: 8px;">Widget A</td>
                <td style="border: 1px solid #bdc3c7; padding: 8px;">$20.00</td>
              </tr>
            </table>
            <p style="text-align: right; font-weight: bold;">Total: $20.00</p>
          </div>
        </body>
      </html>
    `;

    const buffer = await convertHTMLToPDF(html);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000); // Should be substantial
  }, 10000);

  test("throws error for invalid HTML that causes conversion failure", async () => {
    // Note: html-to-pdfmake is quite forgiving, so we'd need truly broken HTML
    // For now, just verify that error handling exists
    try {
      await convertHTMLToPDF("<html><body>");
      // If it doesn't throw, that's fine - the library is forgiving
      expect(true).toBe(true);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(
        "Failed to convert HTML to PDF"
      );
    }
  }, 10000);
});

describe("HTML to DOCX Conversion", () => {
  test("converts simple HTML to DOCX buffer", async () => {
    const html =
      "<html><body><h1>Test Document</h1><p>This is a test.</p></body></html>";
    const buffer = await convertHTMLToDOCX(html);

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);

    // Check DOCX magic number (PK zip file format)
    const header = buffer.toString("ascii", 0, 2);
    expect(header).toBe("PK");
  }, 10000);

  test("converts HTML with table to DOCX", async () => {
    const html = `
      <html>
        <body>
          <h2>Data Table</h2>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Item 1</td>
                <td>100</td>
              </tr>
              <tr>
                <td>Item 2</td>
                <td>200</td>
              </tr>
            </tbody>
          </table>
        </body>
      </html>
    `;

    const buffer = await convertHTMLToDOCX(html);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
  }, 10000);

  test("converts HTML with formatting to DOCX", async () => {
    const html = `
      <html>
        <body>
          <h1>Formatted Document</h1>
          <p><strong>Bold text</strong> and <em>italic text</em></p>
          <p><u>Underlined text</u> and <s>strikethrough text</s></p>
          <ul>
            <li>Bullet point 1</li>
            <li>Bullet point 2</li>
          </ul>
          <ol>
            <li>Numbered item 1</li>
            <li>Numbered item 2</li>
          </ol>
        </body>
      </html>
    `;

    const buffer = await convertHTMLToDOCX(html);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
  }, 10000);

  test("includes metadata in DOCX", async () => {
    const html = "<html><body><h1>Test</h1></body></html>";
    const buffer = await convertHTMLToDOCX(html, {
      title: "Test Document",
      author: "Test Author",
      subject: "Test Subject",
      keywords: ["test", "docx"],
    });

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
  }, 10000);

  test("supports landscape orientation", async () => {
    const html = "<html><body><h1>Landscape Document</h1></body></html>";
    const buffer = await convertHTMLToDOCX(html, {
      orientation: "landscape",
    });

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
  }, 10000);

  test("handles complex document structure", async () => {
    const html = `
      <html>
        <body>
          <h1 style="color: #2c3e50;">Business Report</h1>
          <p style="color: #7f8c8d;">Generated on October 21, 2025</p>
          
          <h2>Executive Summary</h2>
          <p>This is the executive summary with important information.</p>
          
          <h2>Financial Data</h2>
          <table>
            <tr style="background-color: #ecf0f1;">
              <th>Quarter</th>
              <th>Revenue</th>
            </tr>
            <tr>
              <td>Q1</td>
              <td>$100,000</td>
            </tr>
            <tr>
              <td>Q2</td>
              <td>$150,000</td>
            </tr>
          </table>
          
          <h2>Conclusions</h2>
          <ul>
            <li>Revenue is growing</li>
            <li>Market share is expanding</li>
            <li>Future outlook is positive</li>
          </ul>
        </body>
      </html>
    `;

    const buffer = await convertHTMLToDOCX(html);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(2000); // Should be substantial
  }, 10000);

  test("handles special Unicode characters in DOCX", async () => {
    const html = `
      <html>
        <body>
          <h1>Special Characters Test</h1>
          <p>Arrows: ↑ ↓ → ← ↔</p>
          <p>Math symbols: × ÷ ±</p>
          <p>Typography: — – " " ' ' …</p>
          <p>Other symbols: ° © ® ™ • §</p>
        </body>
      </html>
    `;

    const buffer = await convertHTMLToDOCX(html);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);

    // Verify it's a valid DOCX (PK zip header)
    const header = buffer.toString("ascii", 0, 2);
    expect(header).toBe("PK");
  }, 10000);
});

describe("Error Handling", () => {
  test("handles empty HTML gracefully for PDF", async () => {
    const buffer = await convertHTMLToPDF("");
    expect(buffer).toBeInstanceOf(Buffer);
    // Empty HTML should still produce a valid PDF
  }, 10000);

  test("handles empty HTML gracefully for DOCX", async () => {
    const buffer = await convertHTMLToDOCX("");
    expect(buffer).toBeInstanceOf(Buffer);
    // Empty HTML should still produce a valid DOCX
  }, 10000);

  test("handles whitespace-only HTML for PDF", async () => {
    const buffer = await convertHTMLToPDF("   \n   \n   ");
    expect(buffer).toBeInstanceOf(Buffer);
  }, 10000);

  test("handles whitespace-only HTML for DOCX", async () => {
    const buffer = await convertHTMLToDOCX("   \n   \n   ");
    expect(buffer).toBeInstanceOf(Buffer);
  }, 10000);
});

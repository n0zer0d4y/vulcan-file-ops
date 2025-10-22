import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

export interface CreatePDFOptions {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string[];
}

/**
 * Create a new PDF document
 */
export async function createPDF(
  options: CreatePDFOptions = {}
): Promise<PDFDocument> {
  const pdfDoc = await PDFDocument.create();

  if (options.title) pdfDoc.setTitle(options.title);
  if (options.author) pdfDoc.setAuthor(options.author);
  if (options.subject) pdfDoc.setSubject(options.subject);
  if (options.keywords) pdfDoc.setKeywords(options.keywords);

  return pdfDoc;
}

/**
 * Save PDF to buffer
 */
export async function savePDFToBuffer(pdfDoc: PDFDocument): Promise<Buffer> {
  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

/**
 * Create simple text-based PDF from string content
 * This is the main function called by write_file tool
 */
export async function createSimpleTextPDF(
  content: string,
  options: CreatePDFOptions = {}
): Promise<Buffer> {
  const pdfDoc = await createPDF(options);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // A4 size: 595 x 842 points
  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 50;
  const fontSize = 12;
  const lineHeight = 14;
  const maxWidth = pageWidth - 2 * margin;

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  // Split content into lines
  const lines = content.split("\n");

  for (const line of lines) {
    // Check if we need a new page
    if (y < margin) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }

    // Handle empty lines
    if (line.trim() === "") {
      y -= lineHeight;
      continue;
    }

    // Simple word wrapping
    const words = line.split(" ");
    let currentLine = "";

    for (const word of words) {
      const testLine = currentLine + (currentLine ? " " : "") + word;
      const textWidth = font.widthOfTextAtSize(testLine, fontSize);

      if (textWidth > maxWidth && currentLine) {
        // Draw current line and start new one
        page.drawText(currentLine, {
          x: margin,
          y,
          size: fontSize,
          font,
          color: rgb(0, 0, 0),
        });
        y -= lineHeight;
        currentLine = word;

        // Check if we need a new page
        if (y < margin) {
          page = pdfDoc.addPage([pageWidth, pageHeight]);
          y = pageHeight - margin;
        }
      } else {
        currentLine = testLine;
      }
    }

    // Draw remaining text
    if (currentLine) {
      page.drawText(currentLine, {
        x: margin,
        y,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
      });
      y -= lineHeight;
    }
  }

  return await savePDFToBuffer(pdfDoc);
}


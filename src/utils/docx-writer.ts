import { Document, Packer, Paragraph, TextRun } from "docx";

export interface CreateDOCXOptions {
  title?: string;
  subject?: string;
  creator?: string;
  keywords?: string[];
  description?: string;
}

/**
 * Create simple DOCX from plain text content
 * This is the main function called by write_file tool
 */
export async function createSimpleDOCX(
  content: string,
  options: CreateDOCXOptions = {}
): Promise<Buffer> {
  // Split content into paragraphs by newlines
  const lines = content.split("\n");

  // Create paragraphs from each line
  const paragraphs = lines.map(
    (line) =>
      new Paragraph({
        children: [new TextRun(line || " ")], // Use space for empty lines to preserve spacing
      })
  );

  // Create document with metadata
  const doc = new Document({
    creator: options.creator || "vulcan-file-ops",
    title: options.title,
    subject: options.subject,
    keywords: options.keywords?.join(", "),
    description: options.description,
    sections: [
      {
        properties: {},
        children: paragraphs,
      },
    ],
  });

  // Convert to buffer
  return Buffer.from(await Packer.toBuffer(doc));
}

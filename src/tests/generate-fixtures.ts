/**
 * Fixture generation script for document parser tests
 * Run with: npx ts-node src/tests/generate-fixtures.ts
 */

import { promises as fs } from "fs";
import path from "path";

const FIXTURES_DIR = path.join(__dirname, "fixtures");

async function generatePDF() {
  // Create a minimal valid PDF with text content
  const pdfContent = `%PDF-1.4
1 0 obj
<<
/Type /Catalog
/Pages 2 0 R
>>
endobj
2 0 obj
<<
/Type /Pages
/Kids [3 0 R]
/Count 1
>>
endobj
3 0 obj
<<
/Type /Page
/Parent 2 0 R
/MediaBox [0 0 612 792]
/Contents 4 0 R
/Resources <<
/Font <<
/F1 <<
/Type /Font
/Subtype /Type1
/BaseFont /Helvetica
>>
>>
>>
>>
endobj
4 0 obj
<<
/Length 44
>>
stream
BT
/F1 12 Tf
100 700 Td
(Hello from PDF!) Tj
ET
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000317 00000 n 
trailer
<<
/Size 5
/Root 1 0 R
>>
startxref
410
%%EOF`;

  await fs.writeFile(path.join(FIXTURES_DIR, "sample.pdf"), pdfContent);
  console.log("✓ Created sample.pdf");
}

async function generateDOCX() {
  // Create a minimal DOCX (ZIP file with XML structure)
  // For simplicity, we'll create a text file that represents expected content
  // In actual tests, we'll use mammoth to verify parsing works
  const docxNote = `This would be a valid DOCX file.
For testing purposes, we'll create it using a library or manually.
Content: Hello from DOCX!`;

  await fs.writeFile(path.join(FIXTURES_DIR, "sample.docx.txt"), docxNote);
  console.log("⚠ sample.docx needs to be created manually or with a library");
}

async function generateTextFiles() {
  // Create regular text file for comparison tests
  await fs.writeFile(
    path.join(FIXTURES_DIR, "text.txt"),
    "Hello from plain text file!\nLine 2\nLine 3"
  );
  console.log("✓ Created text.txt");

  // Create a large file for size validation testing
  const largeContent = "x".repeat(60 * 1024 * 1024); // 60MB
  await fs.writeFile(path.join(FIXTURES_DIR, "huge-file.pdf"), largeContent);
  console.log("✓ Created huge-file.pdf (oversized)");
}

async function generateLegacyDoc() {
  // Create a placeholder for legacy .doc format
  await fs.writeFile(
    path.join(FIXTURES_DIR, "legacy.doc"),
    "This is a placeholder for legacy .doc format"
  );
  console.log("✓ Created legacy.doc (placeholder)");
}

async function main() {
  console.log("Generating test fixtures...\n");

  try {
    await generatePDF();
    await generateDOCX();
    await generateTextFiles();
    await generateLegacyDoc();

    console.log("\n✅ Fixture generation complete!");
    console.log(
      "\nNote: Some fixtures (DOCX, PPTX, XLSX, ODT, ODP, ODS) need to be created manually"
    );
    console.log("or using appropriate libraries for comprehensive testing.");
  } catch (error) {
    console.error("❌ Error generating fixtures:", error);
    process.exit(1);
  }
}

main();

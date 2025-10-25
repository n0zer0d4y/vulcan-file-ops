/**
 * Mock for html-to-pdfmake module
 *
 * This mock converts HTML to pdfmake document definition format.
 */

export default function htmlToPdfmake(htmlContent: string, options?: any): any {
  // Simple mock conversion that extracts basic text
  const text = htmlContent
    .replace(/<[^>]*>/g, " ") // Remove HTML tags
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim();

  // Return a simple pdfmake document definition
  return [
    {
      text: text || "Empty document",
      fontSize: 12,
      margin: [0, 5, 0, 10],
    },
  ];
}

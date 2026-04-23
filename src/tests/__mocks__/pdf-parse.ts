/**
 * Mock for pdf-parse module
 *
 * This mock allows tests to run without loading the problematic pdfjs-dist ESM module
 * which uses import.meta and other ESM-only features incompatible with Jest.
 */

export default async function pdfParse(buffer: Buffer): Promise<{
  text: string;
  numpages: number;
  info: {
    Author?: string;
    Title?: string;
    Subject?: string;
    Creator?: string;
    Producer?: string;
    CreationDate?: string;
  };
}> {
  const bufferText = buffer.toString("latin1");
  const textMatch = bufferText.match(/VULCAN_MOCK_TEXT:\s*([^\r\n]+)/);
  const titleMatch = bufferText.match(/VULCAN_MOCK_TITLE:\s*([^\r\n]+)/);

  // Return mocked PDF content
  return {
    text:
      textMatch?.[1]?.trim() ||
      "This is mocked PDF content.\nLine 2 of PDF.\nLine 3 of PDF.",
    numpages: 1,
    info: {
      Author: "Mock Author",
      Title: titleMatch?.[1]?.trim() || "Mock PDF Title",
      Subject: "Mock Subject",
      Creator: "Mock Creator",
      Producer: "Mock Producer",
      CreationDate: new Date().toISOString(),
    },
  };
}

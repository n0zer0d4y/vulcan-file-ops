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
  // Return mocked PDF content
  return {
    text: "This is mocked PDF content.\nLine 2 of PDF.\nLine 3 of PDF.",
    numpages: 1,
    info: {
      Author: "Mock Author",
      Title: "Mock PDF Title",
      Subject: "Mock Subject",
      Creator: "Mock Creator",
      Producer: "Mock Producer",
      CreationDate: new Date().toISOString(),
    },
  };
}

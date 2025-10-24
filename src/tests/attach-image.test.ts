import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import { promises as fs } from "fs";
import path from "path";
import { handleReadTool } from "../tools/read-tools.js";
import { setAllowedDirectories, getAllowedDirectories } from "../utils/lib.js";

const SAMPLE_FILES_DIR = path.join(
  __dirname,
  "..",
  "..",
  "docs",
  "sample-files"
);
const TEST_WORKSPACE = path.join(__dirname, "..", "..", "test-workspace");
const FIXTURES_DIR = path.join(TEST_WORKSPACE, "fixtures");

// Test image files provided by user
const TEST_IMAGE_1 = path.join(
  SAMPLE_FILES_DIR,
  "pexels-stephen-alicia-1315397-3063411.jpg"
);
const TEST_IMAGE_2 = path.join(SAMPLE_FILES_DIR, "pexels-stywo-1054218.jpg");

async function setupTestEnvironment() {
  await fs.mkdir(FIXTURES_DIR, { recursive: true });

  // Register test directories
  const currentDirs = getAllowedDirectories();
  setAllowedDirectories([...currentDirs, SAMPLE_FILES_DIR, TEST_WORKSPACE]);
}

async function cleanupTestEnvironment() {
  try {
    await fs.rm(TEST_WORKSPACE, { recursive: true, force: true });
  } catch (error) {
    // Ignore cleanup errors
  }
}

describe("attach_image tool", () => {
  beforeAll(async () => {
    await setupTestEnvironment();
  });

  afterAll(async () => {
    await cleanupTestEnvironment();
  });

  describe("successful image attachment", () => {
    test("attaches JPEG image in correct MCP format", async () => {
      const result = await handleReadTool("attach_image", {
        path: TEST_IMAGE_1,
      });

      // Verify response structure
      expect(result.content).toBeDefined();
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content.length).toBe(1);

      const content = result.content[0] as any;

      // Verify MCP format (type, data, mimeType)
      expect(content.type).toBe("image");
      expect(content.data).toBeTruthy();
      expect(typeof content.data).toBe("string");
      expect(content.mimeType).toBe("image/jpeg");

      // Old source wrapper should NOT exist
      expect(content.source).toBeUndefined();

      // Verify base64 is valid
      expect(() => Buffer.from(content.data, "base64")).not.toThrow();

      // Verify base64 data is substantial (not empty/corrupted)
      const decoded = Buffer.from(content.data, "base64");
      expect(decoded.length).toBeGreaterThan(1000); // Real images should be >1KB
    });

    test("attaches second JPEG image successfully", async () => {
      const result = await handleReadTool("attach_image", {
        path: TEST_IMAGE_2,
      });

      expect(result.content).toBeDefined();
      expect((result.content[0] as any).type).toBe("image");
      expect((result.content[0] as any).mimeType).toBe("image/jpeg");
      expect((result.content[0] as any).data).toBeTruthy();

      // Verify different images have different base64 data
      const result1 = await handleReadTool("attach_image", {
        path: TEST_IMAGE_1,
      });
      expect((result.content[0] as any).data).not.toBe(
        (result1.content[0] as any).data
      );
    });

    test("handles .jpg extension (alternative JPEG)", async () => {
      // Create a copy with .jpg extension
      const jpgPath = path.join(FIXTURES_DIR, "test-image.jpg");
      await fs.copyFile(TEST_IMAGE_1, jpgPath);

      const result = await handleReadTool("attach_image", {
        path: jpgPath,
      });

      expect((result.content[0] as any).mimeType).toBe("image/jpeg");
      expect((result.content[0] as any).data).toBeTruthy();
    });

    test("returns no 'data' or 'mimeType' at root level (old format)", async () => {
      const result = await handleReadTool("attach_image", {
        path: TEST_IMAGE_1,
      });

      const content = result.content[0] as any;

      // Correct MCP format has data and mimeType at root level
      expect(content.data).toBeDefined();
      expect(content.mimeType).toBeDefined();
      expect(content.type).toBe("image");

      // Old source wrapper should NOT exist
      expect(content.source).toBeUndefined();
    });
  });

  describe("supported image formats", () => {
    test("supports PNG format", async () => {
      // Create a minimal 1x1 PNG
      const pngPath = path.join(FIXTURES_DIR, "test.png");
      const pngData = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        "base64"
      );
      await fs.writeFile(pngPath, pngData);

      const result = await handleReadTool("attach_image", {
        path: pngPath,
      });

      expect((result.content[0] as any).mimeType).toBe("image/png");
    });

    test("supports GIF format", async () => {
      // Create a minimal 1x1 GIF
      const gifPath = path.join(FIXTURES_DIR, "test.gif");
      const gifData = Buffer.from(
        "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
        "base64"
      );
      await fs.writeFile(gifPath, gifData);

      const result = await handleReadTool("attach_image", {
        path: gifPath,
      });

      expect((result.content[0] as any).mimeType).toBe("image/gif");
    });

    test("supports WebP format", async () => {
      const webpPath = path.join(FIXTURES_DIR, "test.webp");
      // Minimal WebP file (1x1 pixel)
      const webpData = Buffer.from(
        "UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=",
        "base64"
      );
      await fs.writeFile(webpPath, webpData);

      const result = await handleReadTool("attach_image", {
        path: webpPath,
      });

      expect((result.content[0] as any).mimeType).toBe("image/webp");
    });

    test("supports BMP format", async () => {
      const bmpPath = path.join(FIXTURES_DIR, "test.bmp");
      // Minimal BMP file header + 1x1 pixel
      const bmpData = Buffer.from(
        "Qk1+AAAAAAAAAHoAAAAMAAAAAAEAAQABACAAACQA",
        "base64"
      );
      await fs.writeFile(bmpPath, bmpData);

      const result = await handleReadTool("attach_image", {
        path: bmpPath,
      });

      expect((result.content[0] as any).mimeType).toBe("image/bmp");
    });

    test("supports SVG format", async () => {
      const svgPath = path.join(FIXTURES_DIR, "test.svg");
      const svgData =
        '<svg width="1" height="1"><rect width="1" height="1" fill="red"/></svg>';
      await fs.writeFile(svgPath, svgData);

      const result = await handleReadTool("attach_image", {
        path: svgPath,
      });

      expect((result.content[0] as any).mimeType).toBe("image/svg+xml");
    });
  });

  describe("error handling", () => {
    test("rejects unsupported audio formats (MP3)", async () => {
      const mp3Path = path.join(FIXTURES_DIR, "test.mp3");
      await fs.writeFile(mp3Path, Buffer.from("fake audio data"));

      await expect(
        handleReadTool("attach_image", { path: mp3Path })
      ).rejects.toThrow("Unsupported image format: .mp3");

      await expect(
        handleReadTool("attach_image", { path: mp3Path })
      ).rejects.toThrow("Supported formats: PNG, JPEG, GIF, WebP, BMP, SVG");
    });

    test("rejects unsupported audio formats (WAV)", async () => {
      const wavPath = path.join(FIXTURES_DIR, "test.wav");
      await fs.writeFile(wavPath, Buffer.from("fake audio data"));

      await expect(
        handleReadTool("attach_image", { path: wavPath })
      ).rejects.toThrow("Unsupported image format: .wav");
    });

    test("rejects unsupported audio formats (OGG)", async () => {
      const oggPath = path.join(FIXTURES_DIR, "test.ogg");
      await fs.writeFile(oggPath, Buffer.from("fake audio data"));

      await expect(
        handleReadTool("attach_image", { path: oggPath })
      ).rejects.toThrow("Unsupported image format: .ogg");
    });

    test("rejects unsupported audio formats (FLAC)", async () => {
      const flacPath = path.join(FIXTURES_DIR, "test.flac");
      await fs.writeFile(flacPath, Buffer.from("fake audio data"));

      await expect(
        handleReadTool("attach_image", { path: flacPath })
      ).rejects.toThrow("Unsupported image format: .flac");
    });

    test("rejects unsupported file formats (PDF)", async () => {
      const pdfPath = path.join(SAMPLE_FILES_DIR, "sample.pdf");

      await expect(
        handleReadTool("attach_image", { path: pdfPath })
      ).rejects.toThrow("Unsupported image format: .pdf");
    });

    test("rejects unsupported file formats (TXT)", async () => {
      const txtPath = path.join(FIXTURES_DIR, "test.txt");
      await fs.writeFile(txtPath, "plain text");

      await expect(
        handleReadTool("attach_image", { path: txtPath })
      ).rejects.toThrow("Unsupported image format: .txt");
    });

    test("rejects paths outside allowed directories", async () => {
      const outsidePath = path.join("/", "tmp", "image.png");

      await expect(
        handleReadTool("attach_image", { path: outsidePath })
      ).rejects.toThrow();
    });

    test("handles missing files gracefully", async () => {
      const nonExistentPath = path.join(FIXTURES_DIR, "nonexistent.png");

      await expect(
        handleReadTool("attach_image", { path: nonExistentPath })
      ).rejects.toThrow();
    });

    test("validates arguments schema", async () => {
      await expect(handleReadTool("attach_image", {})).rejects.toThrow(
        "Invalid arguments for attach_image"
      );

      await expect(
        handleReadTool("attach_image", { path: 123 })
      ).rejects.toThrow("Invalid arguments for attach_image");

      await expect(
        handleReadTool("attach_image", { wrong_field: "test.png" })
      ).rejects.toThrow("Invalid arguments for attach_image");
    });

    test("handles corrupted image files", async () => {
      const corruptedPath = path.join(FIXTURES_DIR, "corrupted.png");
      await fs.writeFile(corruptedPath, "not a real PNG file");

      // Should still return the data (MCP client will handle validation)
      const result = await handleReadTool("attach_image", {
        path: corruptedPath,
      });

      expect((result.content[0] as any).mimeType).toBe("image/png");
      expect((result.content[0] as any).data).toBeTruthy();
    });
  });

  describe("case sensitivity", () => {
    test("handles uppercase extensions (PNG)", async () => {
      const upperPath = path.join(FIXTURES_DIR, "test.PNG");
      await fs.copyFile(TEST_IMAGE_1, upperPath);

      const result = await handleReadTool("attach_image", {
        path: upperPath,
      });

      expect((result.content[0] as any).mimeType).toBe("image/png");
    });

    test("handles uppercase extensions (JPG)", async () => {
      const upperPath = path.join(FIXTURES_DIR, "test.JPG");
      await fs.copyFile(TEST_IMAGE_1, upperPath);

      const result = await handleReadTool("attach_image", {
        path: upperPath,
      });

      expect((result.content[0] as any).mimeType).toBe("image/jpeg");
    });

    test("handles mixed case extensions (JpEg)", async () => {
      const mixedPath = path.join(FIXTURES_DIR, "test.JpEg");
      await fs.copyFile(TEST_IMAGE_1, mixedPath);

      const result = await handleReadTool("attach_image", {
        path: mixedPath,
      });

      expect((result.content[0] as any).mimeType).toBe("image/jpeg");
    });
  });

  describe("base64 encoding validation", () => {
    test("base64 data can be decoded back to binary", async () => {
      const result = await handleReadTool("attach_image", {
        path: TEST_IMAGE_1,
      });

      const base64Data = (result.content[0] as any).data;
      const decoded = Buffer.from(base64Data, "base64");

      // Verify decoded buffer is valid
      expect(decoded.length).toBeGreaterThan(0);

      // JPEG files start with FF D8 FF
      expect(decoded[0]).toBe(0xff);
      expect(decoded[1]).toBe(0xd8);
      expect(decoded[2]).toBe(0xff);
    });

    test("base64 encoding preserves file content", async () => {
      const originalFile = await fs.readFile(TEST_IMAGE_1);
      const result = await handleReadTool("attach_image", {
        path: TEST_IMAGE_1,
      });

      const base64Data = (result.content[0] as any).data;
      const decoded = Buffer.from(base64Data, "base64");

      // Decoded data should match original file exactly
      expect(decoded.equals(originalFile)).toBe(true);
    });

    test("base64 contains no whitespace or newlines", async () => {
      const result = await handleReadTool("attach_image", {
        path: TEST_IMAGE_1,
      });

      const base64Data = (result.content[0] as any).data;

      // Base64 should be continuous without whitespace
      expect(base64Data).not.toMatch(/\s/);
      expect(base64Data).not.toMatch(/\n/);
      expect(base64Data).not.toMatch(/\r/);
    });
  });

  describe("MCP specification compliance", () => {
    test("returns exact MCP format structure", async () => {
      const result = await handleReadTool("attach_image", {
        path: TEST_IMAGE_1,
      });

      // Verify top-level structure
      expect(result).toHaveProperty("content");
      expect(Array.isArray(result.content)).toBe(true);

      // Verify content item structure - new correct format
      const content = result.content[0] as any;
      expect(content).toHaveProperty("type");
      expect(content).toHaveProperty("data");
      expect(content).toHaveProperty("mimeType");
      expect(content.type).toBe("image");
      expect(content.mimeType).toBe("image/jpeg");
      expect(typeof content.data).toBe("string");

      // Old source wrapper should NOT exist
      expect(content).not.toHaveProperty("source");
    });

    test("content array contains exactly one item", async () => {
      const result = await handleReadTool("attach_image", {
        path: TEST_IMAGE_1,
      });

      expect(result.content.length).toBe(1);
    });

    test("media_type uses correct MIME format", async () => {
      const formats = [
        { ext: "png", mime: "image/png" },
        { ext: "jpg", mime: "image/jpeg" },
        { ext: "gif", mime: "image/gif" },
        { ext: "webp", mime: "image/webp" },
        { ext: "bmp", mime: "image/bmp" },
      ];

      for (const format of formats) {
        const testPath = path.join(FIXTURES_DIR, `test.${format.ext}`);
        await fs.copyFile(TEST_IMAGE_1, testPath);

        const result = await handleReadTool("attach_image", {
          path: testPath,
        });

        expect((result.content[0] as any).mimeType).toBe(format.mime);
        expect((result.content[0] as any).mimeType).toMatch(/^image\//);
      }
    });
  });

  describe("Batch Image Attachment", () => {
    test("attaches multiple images in a single call", async () => {
      const result = await handleReadTool("attach_image", {
        path: [TEST_IMAGE_1, TEST_IMAGE_2],
      });

      // Should return array with both images
      expect(result.content).toBeDefined();
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content.length).toBe(2);

      // First image
      const image1 = result.content[0] as any;
      expect(image1.type).toBe("image");
      expect(image1.data).toBeTruthy();
      expect(image1.mimeType).toBe("image/jpeg");
      expect(typeof image1.data).toBe("string");

      // Second image
      const image2 = result.content[1] as any;
      expect(image2.type).toBe("image");
      expect(image2.data).toBeTruthy();
      expect(image2.mimeType).toBe("image/jpeg");
      expect(typeof image2.data).toBe("string");

      // Images should have different base64 data
      expect(image1.data).not.toBe(image2.data);
    });

    test("handles mixed image formats in batch", async () => {
      // Create a PNG copy for testing
      const pngPath = path.join(FIXTURES_DIR, "test-batch.png");
      await fs.copyFile(TEST_IMAGE_1, pngPath);

      const result = await handleReadTool("attach_image", {
        path: [TEST_IMAGE_2, pngPath],
      });

      expect(result.content.length).toBe(2);
      expect((result.content[0] as any).mimeType).toBe("image/jpeg");
      expect((result.content[1] as any).mimeType).toBe("image/png");
    });

    test("single path string still works (backward compatibility)", async () => {
      const result = await handleReadTool("attach_image", {
        path: TEST_IMAGE_1, // Single string, not array
      });

      expect(result.content).toBeDefined();
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content.length).toBe(1);
      expect((result.content[0] as any).type).toBe("image");
      expect((result.content[0] as any).mimeType).toBe("image/jpeg");
    });

    test("rejects batch with unsupported format", async () => {
      const mp3Path = path.join(FIXTURES_DIR, "test.mp3");
      await fs.writeFile(mp3Path, "fake mp3 content");

      await expect(
        handleReadTool("attach_image", {
          path: [TEST_IMAGE_1, mp3Path],
        })
      ).rejects.toThrow(/Unsupported image format/);
    });

    test("batch with nonexistent file fails gracefully", async () => {
      await expect(
        handleReadTool("attach_image", {
          path: [TEST_IMAGE_1, path.join(FIXTURES_DIR, "nonexistent.jpg")],
        })
      ).rejects.toThrow();
    });
  });
});

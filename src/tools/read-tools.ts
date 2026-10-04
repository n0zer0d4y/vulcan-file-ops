import { createReadStream, promises as fs } from "fs";
import path from "path";
import { zodToJsonSchema } from "zod-to-json-schema";
import { ToolSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  ReadFileArgsSchema,
  AttachImageArgsSchema,
  ReadMultipleFilesArgsSchema,
  ReadFileRequestSchema,
  type ReadFileArgs,
  type AttachImageArgs,
  type ReadMultipleFilesArgs,
  type ReadFileRequest,
} from "../types/index.js";
import {
  validatePath,
  tailFile,
  headFile,
  rangeFile,
} from "../utils/lib.js";
import { isDocumentFile, parseDocument } from "../utils/document-parser.js";
import {
  MAX_IMAGE_ATTACH_BYTES,
  MAX_IMAGE_ATTACH_TOTAL_BYTES,
  MAX_TEXT_READ_BYTES,
} from "../utils/limits.js";
import {
  createPathArraySchema,
  sanitizeToolInputSchema,
} from "../utils/tool-schema.js";

const ToolInputSchema = ToolSchema.shape.inputSchema;
type ToolInput = any;

const formatMB = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// Reads a file as a stream of buffers, concatenates them, and then encodes
// the result to a Base64 string. At most `maxBytes` are read: a file that
// grew past the limit after it was checked is rejected rather than read.
async function readFileAsBase64Stream(
  filePath: string,
  maxBytes: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath, { start: 0, end: maxBytes });
    const chunks: Buffer[] = [];
    let total = 0;
    stream.on("data", (chunk) => {
      total += (chunk as Buffer).length;
      chunks.push(chunk as Buffer);
    });
    stream.on("end", () => {
      if (total > maxBytes) {
        reject(
          new Error(
            `Image ${path.basename(filePath)} exceeds the ${formatMB(maxBytes)} limit`
          )
        );
        return;
      }
      const finalBuffer = Buffer.concat(chunks);
      resolve(finalBuffer.toString("base64"));
    });
    stream.on("error", (err) => reject(err));
  });
}

/**
 * Read a whole text file ("full" mode), refusing files larger than
 * MAX_TEXT_READ_BYTES (VFO-15). The read itself is bounded too, so a file
 * that grows after the size check (or a device/FIFO that reports size 0)
 * cannot exhaust memory.
 */
async function readFullTextFile(filePath: string): Promise<string> {
  const tooLarge = (size: string) =>
    new Error(
      `File is too large to read in full mode (${size}; limit ` +
        `${formatMB(MAX_TEXT_READ_BYTES)}). Use mode "head", "tail" or "range" ` +
        `to read part of it.`
    );

  const handle = await fs.open(filePath, "r");
  try {
    const { size } = await handle.stat();
    if (size > MAX_TEXT_READ_BYTES) {
      throw tooLarge(formatMB(size));
    }

    const buffer = Buffer.alloc(64 * 1024);
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > MAX_TEXT_READ_BYTES) {
        throw tooLarge(`more than ${formatMB(MAX_TEXT_READ_BYTES)}`);
      }
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    return Buffer.concat(chunks).toString("utf-8");
  } finally {
    await handle.close();
  }
}

export function getReadTools() {
  return [
    {
      name: "read_file",
      description:
        "Read files with flexible modes. Supports text and documents " +
        "(PDF, DOCX, PPTX, XLSX, ODT, ODP, ODS). " +
        "PDF: Extracts with format metadata (fonts, colors, layout). " +
        "Modes: full (entire file), head (first N lines), tail (last N lines), " +
        "range (lines from startLine to endLine, inclusive, 1-indexed). " +
        "Document files ignore mode parameters and always return full content. " +
        "Only works within allowed directories.",
      inputSchema: sanitizeToolInputSchema(
        zodToJsonSchema(ReadFileArgsSchema) as ToolInput
      ),
    },
    {
      name: "attach_image",
      description:
        "Attach an image file for AI vision analysis. The image will be presented " +
        "to the AI model as if uploaded directly by the user, enabling the AI to see " +
        "and describe visual content, read text in images, analyze diagrams, etc. " +
        "Supports attaching a single image or multiple images at once. " +
        "Supports PNG, JPEG, GIF, WebP, BMP, and SVG formats. " +
        "Note: This requires the MCP client to support vision capabilities. " +
        "Only works within allowed directories.",
      inputSchema: {
        type: "object",
        properties: {
          path: createPathArraySchema(
            "Path(s) to image file(s) to attach for AI vision analysis. For maximum MCP client compatibility, provide an array even when attaching a single image."
          ),
        },
        required: ["path"],
        additionalProperties: false,
      } as ToolInput,
    },
    {
      name: "read_multiple_files",
      description:
        "Batch read multiple files concurrently with per-file mode control. " +
        "Supports text and documents (PDF, DOCX, PPTX, XLSX, ODT, ODP, ODS). " +
        "Each file can specify its own read mode: full, head (first N lines), " +
        "tail (last N lines), or range (arbitrary line range). " +
        "Document files ignore mode parameters and return full content. " +
        "Processes files concurrently for performance. Maximum 50 files per operation. " +
        "Only works within allowed directories.",
      inputSchema: sanitizeToolInputSchema(
        zodToJsonSchema(ReadMultipleFilesArgsSchema) as ToolInput
      ),
    },
  ];
}

export async function handleReadTool(name: string, args: any) {
  switch (name) {
    case "read_file": {
      const parsed = ReadFileArgsSchema.safeParse(args);
      if (!parsed.success) {
        throw new Error(`Invalid arguments for read_file: ${parsed.error}`);
      }

      const validPath = await validatePath(parsed.data.path);

      // Check if document file (automatic detection)
      if (isDocumentFile(validPath)) {
        // Parse document (ignores mode/lines parameters for documents)
        const result = await parseDocument(validPath);

        let output = result.text;

        // Add metadata header if available
        if (result.metadata) {
          const meta = result.metadata;
          let header = `Document: ${path.basename(validPath)}\n`;
          if (meta.format) header += `Format: ${meta.format}\n`;
          if (meta.pages) header += `Pages: ${meta.pages}\n`;
          if (meta.author) header += `Author: ${meta.author}\n`;
          if (meta.title) header += `Title: ${meta.title}\n`;

          output = header + "\n" + output;
        }

        return {
          content: [{ type: "text", text: output }],
        };
      }

      // Regular text file handling (existing logic)
      const mode = parsed.data.mode || "full";

      switch (mode) {
        case "tail": {
          const tailContent = await tailFile(validPath, parsed.data.lines!);
          return {
            content: [{ type: "text", text: tailContent }],
          };
        }

        case "head": {
          const headContent = await headFile(validPath, parsed.data.lines!);
          return {
            content: [{ type: "text", text: headContent }],
          };
        }

        case "range": {
          const rangeContent = await rangeFile(
            validPath,
            parsed.data.startLine!,
            parsed.data.endLine!
          );
          return {
            content: [{ type: "text", text: rangeContent }],
          };
        }

        case "full":
        default: {
          const content = await readFullTextFile(validPath);
          return {
            content: [{ type: "text", text: content }],
          };
        }
      }
    }

    case "attach_image": {
      const parsed = AttachImageArgsSchema.safeParse(args);
      if (!parsed.success) {
        throw new Error(`Invalid arguments for attach_image: ${parsed.error}`);
      }

      // Support both single path and array of paths
      const paths = Array.isArray(parsed.data.path)
        ? parsed.data.path
        : [parsed.data.path];

      // Supported image formats only (no audio)
      const mimeTypes: Record<string, string> = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".bmp": "image/bmp",
        ".svg": "image/svg+xml",
      };

      // Validate all images and check sizes before reading any of them
      const images = await Promise.all(
        paths.map(async (imagePath) => {
          const validPath = await validatePath(imagePath);
          const extension = path.extname(validPath).toLowerCase();
          const mimeType = mimeTypes[extension];

          if (!mimeType) {
            throw new Error(
              `Unsupported image format: ${extension}. ` +
                `Supported formats: PNG, JPEG, GIF, WebP, BMP, SVG`
            );
          }

          const { size } = await fs.stat(validPath);
          return { imagePath, validPath, mimeType, size };
        })
      );

      // Size caps (VFO-15): per image and per call
      const oversized = images.filter((i) => i.size > MAX_IMAGE_ATTACH_BYTES);
      if (oversized.length > 0) {
        throw new Error(
          `Image(s) exceed the ${formatMB(MAX_IMAGE_ATTACH_BYTES)} per-image limit: ` +
            oversized
              .map((i) => `${i.imagePath} (${formatMB(i.size)})`)
              .join(", ")
        );
      }
      const totalSize = images.reduce((sum, i) => sum + i.size, 0);
      if (totalSize > MAX_IMAGE_ATTACH_TOTAL_BYTES) {
        throw new Error(
          `Images total ${formatMB(totalSize)}, which exceeds the ` +
            `${formatMB(MAX_IMAGE_ATTACH_TOTAL_BYTES)} limit per attach_image call. ` +
            `Attach fewer images per call.`
        );
      }

      const imageContents = await Promise.all(
        images.map(async ({ validPath, mimeType }) => ({
          type: "image" as const,
          data: await readFileAsBase64Stream(validPath, MAX_IMAGE_ATTACH_BYTES),
          mimeType: mimeType,
        }))
      );

      // Return all images in MCP-compliant format
      return {
        content: imageContents,
      };
    }

    case "read_multiple_files": {
      const parsed = ReadMultipleFilesArgsSchema.safeParse(args);
      if (!parsed.success) {
        throw new Error(
          `Invalid arguments for read_multiple_files: ${parsed.error}`
        );
      }

      // Helper function to read a single file with mode support
      async function readSingleFile(
        fileRequest: ReadFileRequest
      ): Promise<string> {
        try {
          const validPath = await validatePath(fileRequest.path);

          // Check if document file (documents ignore mode parameters)
          if (isDocumentFile(validPath)) {
            const result = await parseDocument(validPath);

            let output = `${fileRequest.path}:\n`;
            if (result.metadata?.format) {
              output += `Format: ${result.metadata.format}\n`;
            }

            // Add formatting information if available
            if (result.formatting) {
              if (
                result.formatting.fonts &&
                result.formatting.fonts.length > 0
              ) {
                output += `Fonts: ${result.formatting.fonts
                  .map((f) => f.name)
                  .join(", ")}\n`;
              }
              if (
                result.formatting.colors &&
                result.formatting.colors.length > 0
              ) {
                output += `Colors: ${result.formatting.colors.join(", ")}\n`;
              }
              if (result.formatting.layout?.pages) {
                output += `Layout: ${
                  result.formatting.layout.pages.length
                } page(s) with ${result.formatting.layout.pages.reduce(
                  (sum, p) => sum + p.texts.length,
                  0
                )} positioned elements\n`;
              }
            }

            output += result.text + "\n";
            return output;
          }

          // Handle text files with mode support
          const mode = fileRequest.mode || "full";
          let content: string;

          switch (mode) {
            case "tail":
              content = await tailFile(validPath, fileRequest.lines!);
              break;
            case "head":
              content = await headFile(validPath, fileRequest.lines!);
              break;
            case "range":
              content = await rangeFile(
                validPath,
                fileRequest.startLine!,
                fileRequest.endLine!
              );
              break;
            case "full":
            default:
              content = await readFullTextFile(validPath);
              break;
          }

          return `${fileRequest.path}:\n${content}\n`;
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          return `${fileRequest.path}: Error - ${errorMessage}`;
        }
      }

      // Process all files concurrently
      const results = await Promise.all(parsed.data.files.map(readSingleFile));

      return {
        content: [{ type: "text", text: results.join("\n---\n") }],
      };
    }

    default:
      throw new Error(`Unknown read tool: ${name}`);
  }
}

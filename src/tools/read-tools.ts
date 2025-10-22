import { createReadStream } from "fs";
import path from "path";
import { zodToJsonSchema } from "zod-to-json-schema";
import { ToolSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  ReadFileArgsSchema,
  ReadMediaFileArgsSchema,
  ReadMultipleFilesArgsSchema,
  type ReadFileArgs,
  type ReadMediaFileArgs,
  type ReadMultipleFilesArgs,
} from "../types/index.js";
import {
  validatePath,
  readFileContent,
  tailFile,
  headFile,
} from "../utils/lib.js";
import { isDocumentFile, parseDocument } from "../utils/document-parser.js";

const ToolInputSchema = ToolSchema.shape.inputSchema;
type ToolInput = any;

// Reads a file as a stream of buffers, concatenates them, and then encodes
// the result to a Base64 string. This is a memory-efficient way to handle
// binary data from a stream before the final encoding.
async function readFileAsBase64Stream(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    const chunks: Buffer[] = [];
    stream.on("data", (chunk) => {
      chunks.push(chunk as Buffer);
    });
    stream.on("end", () => {
      const finalBuffer = Buffer.concat(chunks);
      resolve(finalBuffer.toString("base64"));
    });
    stream.on("error", (err) => reject(err));
  });
}

export function getReadTools() {
  return [
    {
      name: "read_file",
      description:
        "Read files with flexible modes. Supports text and documents " +
        "(PDF, DOCX, PPTX, XLSX, ODT, ODP, ODS). " +
        "PDF: Extracts with format metadata (fonts, colors, layout). " +
        "Modes: full, head (first N lines), tail (last N lines). " +
        "Only works within allowed directories.",
      inputSchema: zodToJsonSchema(ReadFileArgsSchema) as ToolInput,
    },
    {
      name: "read_media_file",
      description:
        "Process image and audio files by converting them to base64-encoded format. " +
        "Returns the encoded data along with the detected MIME type for proper content handling. " +
        "Supports common image formats (PNG, JPEG, GIF, WebP, BMP, SVG) and audio formats (MP3, WAV, OGG, FLAC). " +
        "Only works within allowed directories.",
      inputSchema: zodToJsonSchema(ReadMediaFileArgsSchema) as ToolInput,
    },
    {
      name: "read_multiple_files",
      description:
        "Batch read multiple files concurrently. Supports text and documents " +
        "(PDF, DOCX, PPTX, XLSX, ODT, ODP, ODS). " +
        "PDF: Extracts with format metadata. " +
        "Parameter: paths (array of file paths). " +
        "Only works within allowed directories.",
      inputSchema: zodToJsonSchema(ReadMultipleFilesArgsSchema) as ToolInput,
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

        case "full":
        default: {
          const content = await readFileContent(validPath);
          return {
            content: [{ type: "text", text: content }],
          };
        }
      }
    }

    case "read_media_file": {
      const parsed = ReadMediaFileArgsSchema.safeParse(args);
      if (!parsed.success) {
        throw new Error(
          `Invalid arguments for read_media_file: ${parsed.error}`
        );
      }
      const validPath = await validatePath(parsed.data.path);
      const extension = path.extname(validPath).toLowerCase();
      const mimeTypes: Record<string, string> = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".bmp": "image/bmp",
        ".svg": "image/svg+xml",
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".ogg": "audio/ogg",
        ".flac": "audio/flac",
      };
      const mimeType = mimeTypes[extension] || "application/octet-stream";
      const data = await readFileAsBase64Stream(validPath);
      const type = mimeType.startsWith("image/")
        ? "image"
        : mimeType.startsWith("audio/")
        ? "audio"
        : "blob";
      return {
        content: [{ type, data, mimeType }],
      };
    }

    case "read_multiple_files": {
      const parsed = ReadMultipleFilesArgsSchema.safeParse(args);
      if (!parsed.success) {
        throw new Error(
          `Invalid arguments for read_multiple_files: ${parsed.error}`
        );
      }
      const results = await Promise.all(
        parsed.data.paths.map(async (filePath: string) => {
          try {
            const validPath = await validatePath(filePath);

            // Auto-detect document vs text file
            if (isDocumentFile(validPath)) {
              const result = await parseDocument(validPath);

              let output = `${filePath}:\n`;
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
            } else {
              // Regular text file
              const content = await readFileContent(validPath);
              return `${filePath}:\n${content}\n`;
            }
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            return `${filePath}: Error - ${errorMessage}`;
          }
        })
      );
      return {
        content: [{ type: "text", text: results.join("\n---\n") }],
      };
    }

    default:
      throw new Error(`Unknown read tool: ${name}`);
  }
}

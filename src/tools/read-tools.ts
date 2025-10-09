import { createReadStream } from "fs";
import path from "path";
import { zodToJsonSchema } from "zod-to-json-schema";
import { ToolSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  ReadTextFileArgsSchema,
  ReadMediaFileArgsSchema,
  ReadMultipleFilesArgsSchema,
  type ReadTextFileArgs,
  type ReadMediaFileArgs,
  type ReadMultipleFilesArgs,
} from "../types/index.js";
import {
  validatePath,
  readFileContent,
  tailFile,
  headFile,
} from "../utils/lib.js";

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
        "Read the complete contents of a file as text. DEPRECATED: Use read_text_file instead.",
      inputSchema: zodToJsonSchema(ReadTextFileArgsSchema) as ToolInput,
    },
    {
      name: "read_text_file",
      description:
        "Read the complete contents of a file from the file system as text. " +
        "Handles various text encodings and provides detailed error messages " +
        "if the file cannot be read. Use this tool when you need to examine " +
        "the contents of a single file. Use the 'head' parameter to read only " +
        "the first N lines of a file, or the 'tail' parameter to read only " +
        "the last N lines of a file. Operates on the file as text regardless of extension. " +
        "Only works within allowed directories.",
      inputSchema: zodToJsonSchema(ReadTextFileArgsSchema) as ToolInput,
    },
    {
      name: "read_media_file",
      description:
        "Read an image or audio file. Returns the base64 encoded data and MIME type. " +
        "Only works within allowed directories.",
      inputSchema: zodToJsonSchema(ReadMediaFileArgsSchema) as ToolInput,
    },
    {
      name: "read_multiple_files",
      description:
        "Read the contents of multiple files simultaneously. This is more " +
        "efficient than reading files one by one when you need to analyze " +
        "or compare multiple files. Each file's content is returned with its " +
        "path as a reference. Failed reads for individual files won't stop " +
        "the entire operation. Only works within allowed directories.",
      inputSchema: zodToJsonSchema(ReadMultipleFilesArgsSchema) as ToolInput,
    },
  ];
}

export async function handleReadTool(name: string, args: any) {
  switch (name) {
    case "read_file":
    case "read_text_file": {
      const parsed = ReadTextFileArgsSchema.safeParse(args);
      if (!parsed.success) {
        throw new Error(
          `Invalid arguments for read_text_file: ${parsed.error}`
        );
      }
      const validPath = await validatePath(parsed.data.path);

      if (parsed.data.head && parsed.data.tail) {
        throw new Error(
          "Cannot specify both head and tail parameters simultaneously"
        );
      }

      if (parsed.data.tail) {
        // Use memory-efficient tail implementation for large files
        const tailContent = await tailFile(validPath, parsed.data.tail);
        return {
          content: [{ type: "text", text: tailContent }],
        };
      }

      if (parsed.data.head) {
        // Use memory-efficient head implementation for large files
        const headContent = await headFile(validPath, parsed.data.head);
        return {
          content: [{ type: "text", text: headContent }],
        };
      }
      const content = await readFileContent(validPath);
      return {
        content: [{ type: "text", text: content }],
      };
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
            const content = await readFileContent(validPath);
            return `${filePath}:\n${content}\n`;
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

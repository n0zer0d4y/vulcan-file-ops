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
        "Read file contents with flexible read modes. Supports three distinct reading modes:\n\n" +
        "FULL MODE (default): Reads the complete file from start to finish. Use this when you need all file contents. " +
        "Best for configuration files, source code, small to medium documents.\n\n" +
        "HEAD MODE: Reads only the first N lines of the file. Ideal for previewing file structure, examining headers, " +
        "or checking the beginning of large files without loading everything. Perfect for checking CSV headers, " +
        "viewing file preamble, previewing log file start.\n\n" +
        "TAIL MODE: Reads only the last N lines of the file. Perfect for checking recent entries in log files, " +
        "viewing the end of output files, or examining latest data appends. Great for monitoring recent log entries, " +
        "checking build completion status, viewing latest transactions.\n\n" +
        "Performance: HEAD and TAIL modes are memory-efficient, loading only requested lines instead of the entire file. " +
        "Recommended for files larger than 1MB or when you only need specific portions.\n\n" +
        "Parameters:\n" +
        "- path (required): File path to read\n" +
        "- mode (optional, default: 'full'): Reading mode - 'full', 'head', or 'tail'\n" +
        "- lines (conditional): Number of lines to read. Required when mode is 'head' or 'tail', must be positive integer.\n\n" +
        "Only works within allowed directories.",
      inputSchema: zodToJsonSchema(ReadFileArgsSchema) as ToolInput,
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
    case "read_file": {
      const parsed = ReadFileArgsSchema.safeParse(args);
      if (!parsed.success) {
        throw new Error(`Invalid arguments for read_file: ${parsed.error}`);
      }

      const validPath = await validatePath(parsed.data.path);
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

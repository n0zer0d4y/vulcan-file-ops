import { zodToJsonSchema } from "zod-to-json-schema";
import { ToolSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  WriteFileArgsSchema,
  WriteMultipleFilesArgsSchema,
  EditFileArgsSchema,
  type WriteFileArgs,
  type WriteMultipleFilesArgs,
  type EditFileArgs,
} from "../types/index.js";
import {
  validatePath,
  writeFileContent,
  applyFileEdits,
} from "../utils/lib.js";

const ToolInputSchema = ToolSchema.shape.inputSchema;
type ToolInput = any;

export function getWriteTools() {
  return [
    {
      name: "write_file",
      description:
        "Create new files or replace existing file contents entirely. " +
        "Warning: This operation overwrites files without confirmation, so use carefully. " +
        "Processes text content with appropriate UTF-8 encoding for reliable storage. " +
        "Only works within allowed directories.",
      inputSchema: zodToJsonSchema(WriteFileArgsSchema) as ToolInput,
    },
    {
      name: "edit_file",
      description:
        "Apply precise line-based modifications to text files. " +
        "Performs exact text substitution by matching and replacing specific line sequences. " +
        "Provides git-style diff output showing exactly what changed for verification and review. " +
        "Only works within allowed directories.",
      inputSchema: zodToJsonSchema(EditFileArgsSchema) as ToolInput,
    },
    {
      name: "write_multiple_files",
      description:
        "Write multiple files simultaneously with concurrent processing. " +
        "Each file operation is atomic and secure. Failed writes for individual " +
        "files won't stop other files from being written. Returns detailed " +
        "results for each file operation. Only works within allowed directories.",
      inputSchema: zodToJsonSchema(WriteMultipleFilesArgsSchema) as ToolInput,
    },
  ];
}

export async function handleWriteTool(name: string, args: any) {
  switch (name) {
    case "write_file": {
      const parsed = WriteFileArgsSchema.safeParse(args);
      if (!parsed.success) {
        throw new Error(`Invalid arguments for write_file: ${parsed.error}`);
      }
      const validPath = await validatePath(parsed.data.path);
      await writeFileContent(validPath, parsed.data.content);
      return {
        content: [
          { type: "text", text: `Successfully wrote to ${parsed.data.path}` },
        ],
      };
    }

    case "edit_file": {
      const parsed = EditFileArgsSchema.safeParse(args);
      if (!parsed.success) {
        throw new Error(`Invalid arguments for edit_file: ${parsed.error}`);
      }
      const validPath = await validatePath(parsed.data.path);
      const result = await applyFileEdits(
        validPath,
        parsed.data.edits,
        parsed.data.dryRun
      );
      return {
        content: [{ type: "text", text: result }],
      };
    }

    case "write_multiple_files": {
      const parsed = WriteMultipleFilesArgsSchema.safeParse(args);
      if (!parsed.success) {
        throw new Error(
          `Invalid arguments for write_multiple_files: ${parsed.error}`
        );
      }

      // Validate all paths before any writing
      const validationPromises = parsed.data.files.map(async (file) => {
        try {
          const validPath = await validatePath(file.path);
          return {
            path: file.path,
            validPath,
            content: file.content,
            success: true,
          };
        } catch (error) {
          return {
            path: file.path,
            content: file.content,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      });

      const validatedFiles = await Promise.all(validationPromises);

      // Separate valid and invalid files
      const validFiles = validatedFiles.filter((f) => f.success) as Array<{
        path: string;
        validPath: string;
        content: string;
        success: true;
      }>;
      const invalidFiles = validatedFiles.filter((f) => !f.success);

      // If any paths are invalid, fail the entire operation
      if (invalidFiles.length > 0) {
        const errorMessages = invalidFiles
          .map((f) => `${f.path}: ${f.error || "Unknown error"}`)
          .join("\n");
        throw new Error(`Invalid file paths:\n${errorMessages}`);
      }

      // Write all valid files concurrently
      const writePromises = validFiles.map(async (file) => {
        try {
          await writeFileContent(file.validPath, file.content);
          return {
            path: file.path,
            success: true,
            size: Buffer.byteLength(file.content, "utf8"),
          };
        } catch (error) {
          return {
            path: file.path,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      });

      const results = await Promise.allSettled(writePromises);
      const successful = results.filter(
        (r) => r.status === "fulfilled" && r.value.success
      ).length;
      const failed = results.filter(
        (r) => r.status === "fulfilled" && !r.value.success
      ).length;

      // Format results
      const resultLines = results.map((result, index) => {
        if (result.status === "rejected") {
          return `✗ ${parsed.data.files[index].path} - Unexpected error`;
        }
        const file = result.value;
        if (file && file.success) {
          return `✓ ${file.path} (${file.size} bytes)`;
        } else if (file) {
          return `✗ ${file.path} - Error: ${file.error || "Unknown error"}`;
        } else {
          return `✗ ${parsed.data.files[index].path} - Unknown error`;
        }
      });

      const summary = `\nWrote ${successful} of ${parsed.data.files.length} files:`;
      const resultText = summary + "\n" + resultLines.join("\n");

      if (failed === 0) {
        return {
          content: [
            {
              type: "text",
              text: resultText + "\n\nAll files written successfully.",
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: "text",
              text:
                resultText +
                `\n\n${successful} files succeeded, ${failed} failed.`,
            },
          ],
        };
      }
    }

    default:
      throw new Error(`Unknown write tool: ${name}`);
  }
}

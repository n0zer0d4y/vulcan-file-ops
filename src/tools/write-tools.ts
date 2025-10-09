import { zodToJsonSchema } from "zod-to-json-schema";
import { ToolSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  WriteFileArgsSchema,
  EditFileArgsSchema,
  type WriteFileArgs,
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
        "Create a new file or completely overwrite an existing file with new content. " +
        "Use with caution as it will overwrite existing files without warning. " +
        "Handles text content with proper encoding. Only works within allowed directories.",
      inputSchema: zodToJsonSchema(WriteFileArgsSchema) as ToolInput,
    },
    {
      name: "edit_file",
      description:
        "Make line-based edits to a text file. Each edit replaces exact line sequences " +
        "with new content. Returns a git-style diff showing the changes made. " +
        "Only works within allowed directories.",
      inputSchema: zodToJsonSchema(EditFileArgsSchema) as ToolInput,
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

    default:
      throw new Error(`Unknown write tool: ${name}`);
  }
}

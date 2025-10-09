import { zodToJsonSchema } from "zod-to-json-schema";
import { ToolSchema } from "@modelcontextprotocol/sdk/types.js";
import { SearchFilesArgsSchema, type SearchFilesArgs } from "../types/index.js";
import {
  validatePath,
  searchFilesWithValidation,
  getAllowedDirectories,
} from "../utils/lib.js";

const ToolInputSchema = ToolSchema.shape.inputSchema;
type ToolInput = any;

export function getSearchTools() {
  return [
    {
      name: "search_files",
      description:
        "Recursively search for files and directories matching a pattern. " +
        "The patterns should be glob-style patterns that match paths relative to the working directory. " +
        "Use pattern like '*.ext' to match files in current directory, and '**/*.ext' to match files in all subdirectories. " +
        "Returns full paths to all matching items. Great for finding files when you don't know their exact location. " +
        "Only searches within allowed directories.",
      inputSchema: zodToJsonSchema(SearchFilesArgsSchema) as ToolInput,
    },
  ];
}

export async function handleSearchTool(name: string, args: any) {
  switch (name) {
    case "search_files": {
      const parsed = SearchFilesArgsSchema.safeParse(args);
      if (!parsed.success) {
        throw new Error(`Invalid arguments for search_files: ${parsed.error}`);
      }
      const validPath = await validatePath(parsed.data.path);
      const results = await searchFilesWithValidation(
        validPath,
        parsed.data.pattern,
        getAllowedDirectories(),
        { excludePatterns: parsed.data.excludePatterns }
      );
      return {
        content: [
          {
            type: "text",
            text: results.length > 0 ? results.join("\n") : "No matches found",
          },
        ],
      };
    }

    default:
      throw new Error(`Unknown search tool: ${name}`);
  }
}

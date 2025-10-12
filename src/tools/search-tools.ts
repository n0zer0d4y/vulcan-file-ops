import { zodToJsonSchema } from "zod-to-json-schema";
import { ToolSchema } from "@modelcontextprotocol/sdk/types.js";
import { SearchFilesArgsSchema, type SearchFilesArgs } from "../types/index.js";
import {
  validatePath,
  searchFilesWithValidation,
  getAllowedDirectories,
  getIgnoredFolders,
} from "../utils/lib.js";

const ToolInputSchema = ToolSchema.shape.inputSchema;
type ToolInput = any;

export function getSearchTools() {
  return [
    {
      name: "search_files",
      description:
        "Perform recursive pattern-based searches for files and directories. " +
        "Accepts glob-style patterns matching paths relative to the search root. " +
        "Use simple patterns like '*.ext' for current directory matches, or '**/*.ext' for deep subdirectory searches. " +
        "Returns absolute paths to all discovered items. " +
        "Excellent for locating files when exact paths are unknown. " +
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
      // Combine user-specified patterns with global ignored folders
      const allExcludePatterns = [
        ...parsed.data.excludePatterns,
        ...getIgnoredFolders(),
      ];
      const results = await searchFilesWithValidation(
        validPath,
        parsed.data.pattern,
        getAllowedDirectories(),
        { excludePatterns: allExcludePatterns }
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

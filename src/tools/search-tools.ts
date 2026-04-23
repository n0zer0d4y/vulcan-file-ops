import { zodToJsonSchema } from "zod-to-json-schema";
import { ToolSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  SearchFilesArgsSchema,
  GrepArgsSchema,
  type SearchFilesArgs,
  type GrepArgs,
} from "../types/index.js";
import {
  validatePath,
  searchFilesWithValidation,
  grepFilesWithValidation,
  getAllowedDirectories,
  getIgnoredFolders,
  type GrepOptions,
} from "../utils/lib.js";
import { sanitizeToolInputSchema } from "../utils/tool-schema.js";

const ToolInputSchema = ToolSchema.shape.inputSchema;
type ToolInput = any;

export function getSearchTools() {
  return [
    {
      name: "glob_files",
      description:
        "Perform recursive pattern-based searches for files and directories. " +
        "Accepts glob-style patterns matching paths relative to the search root. " +
        "Use simple patterns like '*.ext' for current directory matches, or '**/*.ext' for deep subdirectory searches. " +
        "Returns absolute paths to all discovered items. Excellent for locating files when exact paths are unknown. " +
        "Only searches within allowed directories.",
      inputSchema: sanitizeToolInputSchema(
        zodToJsonSchema(SearchFilesArgsSchema) as ToolInput
      ),
    },
    {
      name: "grep_files",
      description:
        "Search text patterns within file contents using regex. Returns matching line numbers and context - use with read_file/read_multiple_files to retrieve actual content. " +
        "Supports: regex patterns, case-insensitive (-i), context lines (-A/-B/-C), file type filters (type: js/py/ts/etc), glob patterns, multiline mode. " +
        "Output modes: content (lines+context), files_with_matches (paths only), count (match counts). " +
        "Respects ignored folders. Use head_limit to cap results. Only searches within allowed directories.",
      inputSchema: sanitizeToolInputSchema(
        zodToJsonSchema(GrepArgsSchema) as ToolInput
      ),
    },
  ];
}

export async function handleSearchTool(name: string, args: any) {
  switch (name) {
    case "glob_files": {
      const parsed = SearchFilesArgsSchema.safeParse(args);
      if (!parsed.success) {
        throw new Error(`Invalid arguments for glob_files: ${parsed.error}`);
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

    case "grep_files": {
      const parsed = GrepArgsSchema.safeParse(args);
      if (!parsed.success) {
        throw new Error(`Invalid arguments for grep_files: ${parsed.error}`);
      }

      // Determine search path (default to first allowed directory if not specified)
      let searchPath = parsed.data.path;
      if (!searchPath) {
        const allowedDirs = getAllowedDirectories();
        if (allowedDirs.length === 0) {
          throw new Error(
            "No allowed directories configured. Use register_directory or configure --approved-folders."
          );
        }
        searchPath = allowedDirs[0];
      }

      const validPath = await validatePath(searchPath);

      // Prepare grep options
      const grepOptions: GrepOptions = {
        caseInsensitive: parsed.data["-i"],
        contextBefore:
          parsed.data["-B"] || (parsed.data["-C"] ? parsed.data["-C"] : 0),
        contextAfter:
          parsed.data["-A"] || (parsed.data["-C"] ? parsed.data["-C"] : 0),
        outputMode: parsed.data.output_mode,
        headLimit: parsed.data.head_limit,
        multiline: parsed.data.multiline,
        fileType: parsed.data.type,
        globPattern: parsed.data.glob,
      };

      // Execute grep search
      const result = await grepFilesWithValidation(
        parsed.data.pattern,
        validPath,
        getAllowedDirectories(),
        grepOptions
      );

      // Format output based on mode
      let outputText = "";

      if (result.mode === "content") {
        if (!result.matches || result.matches.length === 0) {
          outputText = "No matches found";
        } else {
          const groupedByFile = new Map<string, typeof result.matches>();

          for (const match of result.matches) {
            if (!groupedByFile.has(match.file)) {
              groupedByFile.set(match.file, []);
            }
            groupedByFile.get(match.file)!.push(match);
          }

          const fileOutputs: string[] = [];
          for (const [file, matches] of groupedByFile.entries()) {
            const lines: string[] = [`${file}`];

            for (const match of matches) {
              // Add context before
              if (match.contextBefore && match.contextBefore.length > 0) {
                for (let i = 0; i < match.contextBefore.length; i++) {
                  const lineNum = match.line - match.contextBefore.length + i;
                  lines.push(`${lineNum}-${match.contextBefore[i]}`);
                }
              }

              // Add matching line
              lines.push(`${match.line}:${match.content}`);

              // Add context after
              if (match.contextAfter && match.contextAfter.length > 0) {
                for (let i = 0; i < match.contextAfter.length; i++) {
                  const lineNum = match.line + i + 1;
                  lines.push(`${lineNum}-${match.contextAfter[i]}`);
                }
              }
            }

            fileOutputs.push(lines.join("\n"));
          }

          outputText = fileOutputs.join("\n\n");

          if (
            parsed.data.head_limit &&
            result.matches.length >= parsed.data.head_limit
          ) {
            outputText += `\n\n(Results truncated to ${parsed.data.head_limit} matches. Use head_limit parameter to adjust.)`;
          }
        }
      } else if (result.mode === "files_with_matches") {
        if (!result.files || result.files.length === 0) {
          outputText = "No files with matches found";
        } else {
          outputText = result.files.join("\n");

          if (
            parsed.data.head_limit &&
            result.files.length >= parsed.data.head_limit
          ) {
            outputText += `\n\n(Results truncated to ${parsed.data.head_limit} files. Use head_limit parameter to adjust.)`;
          }
        }
      } else if (result.mode === "count") {
        if (!result.counts || result.counts.size === 0) {
          outputText = "No matches found";
        } else {
          const countLines: string[] = [];
          for (const [file, count] of result.counts.entries()) {
            countLines.push(`${count}:${file}`);
          }
          outputText = countLines.join("\n");
          outputText += `\n\nTotal matches: ${result.totalMatches} across ${result.counts.size} files`;
        }
      }

      outputText += `\n\nSearched ${result.filesSearched} files`;

      return {
        content: [{ type: "text", text: outputText }],
      };
    }

    default:
      throw new Error(`Unknown search tool: ${name}`);
  }
}

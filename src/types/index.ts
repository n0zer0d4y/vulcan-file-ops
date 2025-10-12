import { z } from "zod";
import type { FileEdit } from "../utils/lib.js";

// Schema definitions
export const ReadFileArgsSchema = z
  .object({
    path: z.string().describe("Path to the file to read"),
    mode: z
      .enum(["full", "head", "tail"])
      .optional()
      .default("full")
      .describe(
        "Read mode: 'full' reads entire file, 'head' reads first N lines, 'tail' reads last N lines"
      ),
    lines: z
      .number()
      .positive()
      .int()
      .optional()
      .describe(
        "Number of lines to read (required when mode is 'head' or 'tail', must be positive integer)"
      ),
  })
  .refine(
    (data) => {
      // If mode is head or tail, lines must be provided
      if ((data.mode === "head" || data.mode === "tail") && !data.lines) {
        return false;
      }
      // If mode is full, lines should not be provided
      if (data.mode === "full" && data.lines !== undefined) {
        return false;
      }
      return true;
    },
    {
      message:
        "When mode is 'head' or 'tail', 'lines' parameter is required. When mode is 'full', 'lines' should not be provided.",
    }
  );

export const ReadMediaFileArgsSchema = z.object({
  path: z.string(),
});

export const ReadMultipleFilesArgsSchema = z.object({
  paths: z
    .array(z.string())
    .min(1, "At least one file path must be provided")
    .describe(
      "Array of file paths to read. Each path must be a string pointing to a valid file within allowed directories."
    ),
});

export const WriteFileArgsSchema = z.object({
  path: z.string(),
  content: z.string(),
});

export const WriteMultipleFilesArgsSchema = z.object({
  files: z
    .array(
      z.object({
        path: z.string(),
        content: z.string(),
      })
    )
    .min(1, "At least one file must be provided")
    .max(50, "Maximum 50 files per operation")
    .describe("Array of files to write, each with path and content"),
});

export const EditOperation = z.object({
  oldText: z.string().describe("Text to search for - must match exactly"),
  newText: z.string().describe("Text to replace with"),
}) satisfies z.ZodType<FileEdit>;

export const EditFileArgsSchema = z.object({
  path: z.string(),
  edits: z.array(EditOperation),
  dryRun: z
    .boolean()
    .default(false)
    .describe("Preview changes using git-style diff format"),
});

export const CreateDirectoryArgsSchema = z.object({
  path: z.string(),
});

export const ListDirectoryArgsSchema = z.object({
  path: z.string(),
});

export const ListDirectoryWithSizesArgsSchema = z.object({
  path: z.string(),
  sortBy: z
    .enum(["name", "size"])
    .optional()
    .default("name")
    .describe("Sort entries by name or size"),
});

export const DirectoryTreeArgsSchema = z.object({
  path: z.string(),
  excludePatterns: z.array(z.string()).optional().default([]),
});

export const MoveFileArgsSchema = z.object({
  source: z.string(),
  destination: z.string(),
});

export const SearchFilesArgsSchema = z.object({
  path: z.string().describe("Directory to search"),
  pattern: z.string().describe("Glob pattern: *.js, **/*.test.ts"),
  excludePatterns: z
    .array(z.string())
    .optional()
    .default([])
    .describe("Exclude patterns"),
});

export const GrepArgsSchema = z.object({
  pattern: z.string().describe("Regex pattern to search for"),
  path: z.string().optional().describe("Directory/file to search (optional)"),
  type: z.string().optional().describe("File type filter: js, py, ts, etc"),
  glob: z.string().optional().describe("Glob filter: *.js, **/*.test.ts"),
  "-i": z.boolean().optional().default(false).describe("Case insensitive"),
  "-A": z.number().optional().describe("Lines after match"),
  "-B": z.number().optional().describe("Lines before match"),
  "-C": z.number().optional().describe("Lines before+after match"),
  output_mode: z
    .enum(["content", "files_with_matches", "count"])
    .optional()
    .default("content")
    .describe("content|files_with_matches|count"),
  head_limit: z.number().optional().describe("Limit results to N"),
  multiline: z
    .boolean()
    .optional()
    .default(false)
    .describe("Allow . to match newlines"),
});

export const GetFileInfoArgsSchema = z.object({
  path: z.string(),
});

export const RegisterDirectoryArgsSchema = z.object({
  path: z.string().describe("Directory path to register for access"),
});

export const FileOperationsArgsSchema = z.object({
  operation: z.enum(["move", "copy", "rename"]),
  files: z
    .array(
      z.object({
        source: z.string().describe("Source file or directory path"),
        destination: z.string().describe("Destination file or directory path"),
      })
    )
    .min(1)
    .max(100)
    .describe("Array of source-destination file pairs"),
  onConflict: z
    .enum(["skip", "overwrite", "error"])
    .optional()
    .default("error")
    .describe("How to handle destination conflicts"),
});

export const DeleteFilesArgsSchema = z.object({
  paths: z
    .array(z.string())
    .min(1, "At least one path must be provided")
    .max(100, "Maximum 100 files per operation")
    .describe("Array of file or directory paths to delete"),
  recursive: z
    .boolean()
    .optional()
    .default(false)
    .describe("Enable recursive deletion for directories"),
  force: z
    .boolean()
    .optional()
    .default(false)
    .describe("Force deletion even if files are read-only"),
});

// Type exports
export type ReadFileArgs = z.infer<typeof ReadFileArgsSchema>;
export type ReadMediaFileArgs = z.infer<typeof ReadMediaFileArgsSchema>;
export type ReadMultipleFilesArgs = z.infer<typeof ReadMultipleFilesArgsSchema>;
export type WriteFileArgs = z.infer<typeof WriteFileArgsSchema>;
export type WriteMultipleFilesArgs = z.infer<
  typeof WriteMultipleFilesArgsSchema
>;
export type EditOperationType = z.infer<typeof EditOperation>;
export type EditFileArgs = z.infer<typeof EditFileArgsSchema>;
export type CreateDirectoryArgs = z.infer<typeof CreateDirectoryArgsSchema>;
export type ListDirectoryArgs = z.infer<typeof ListDirectoryArgsSchema>;
export type ListDirectoryWithSizesArgs = z.infer<
  typeof ListDirectoryWithSizesArgsSchema
>;
export type DirectoryTreeArgs = z.infer<typeof DirectoryTreeArgsSchema>;
export type MoveFileArgs = z.infer<typeof MoveFileArgsSchema>;
export type SearchFilesArgs = z.infer<typeof SearchFilesArgsSchema>;
export type GrepArgs = z.infer<typeof GrepArgsSchema>;
export type GetFileInfoArgs = z.infer<typeof GetFileInfoArgsSchema>;
export type RegisterDirectoryArgs = z.infer<typeof RegisterDirectoryArgsSchema>;
export type FileOperationsArgs = z.infer<typeof FileOperationsArgsSchema>;
export type DeleteFilesArgs = z.infer<typeof DeleteFilesArgsSchema>;

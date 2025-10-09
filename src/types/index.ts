import { z } from "zod";
import type { FileEdit } from "../utils/lib.js";

// Schema definitions
export const ReadTextFileArgsSchema = z.object({
  path: z.string(),
  tail: z
    .number()
    .optional()
    .describe("If provided, returns only the last N lines of the file"),
  head: z
    .number()
    .optional()
    .describe("If provided, returns only the first N lines of the file"),
});

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
  path: z.string(),
  pattern: z.string(),
  excludePatterns: z.array(z.string()).optional().default([]),
});

export const GetFileInfoArgsSchema = z.object({
  path: z.string(),
});

export const RegisterDirectoryArgsSchema = z.object({
  path: z.string().describe("Directory path to register for access"),
});

// Type exports
export type ReadTextFileArgs = z.infer<typeof ReadTextFileArgsSchema>;
export type ReadMediaFileArgs = z.infer<typeof ReadMediaFileArgsSchema>;
export type ReadMultipleFilesArgs = z.infer<typeof ReadMultipleFilesArgsSchema>;
export type WriteFileArgs = z.infer<typeof WriteFileArgsSchema>;
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
export type GetFileInfoArgs = z.infer<typeof GetFileInfoArgsSchema>;
export type RegisterDirectoryArgs = z.infer<typeof RegisterDirectoryArgsSchema>;

import { z } from "zod";
import type { FileEdit } from "../utils/lib.js";

// Document parsing result types
export interface DocumentParseResult {
  text: string;
  metadata?: {
    pages?: number;
    author?: string;
    title?: string;
    format: string;
  };
  parser: "pdf-parse" | "mammoth" | "officeparser";
}

// Internal file type detection
export type SupportedDocumentExtension =
  | ".pdf"
  | ".docx"
  | ".pptx"
  | ".xlsx"
  | ".odt"
  | ".odp"
  | ".ods";

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
  content: z
    .string()
    .describe(
      "File content to write. For multi-line content, use actual newlines in the string value, " +
        "not escape sequences like \\n. Example: 'line1\\nline2' should be formatted as an actual " +
        "multi-line string in JSON."
    ),
});

export const WriteMultipleFilesArgsSchema = z.object({
  files: z
    .array(
      z.object({
        path: z.string(),
        content: z
          .string()
          .describe(
            "File content to write. For multi-line content, use actual newlines, not \\n escape sequences."
          ),
      })
    )
    .min(1, "At least one file must be provided")
    .max(50, "Maximum 50 files per operation")
    .describe("Array of files to write, each with path and content"),
});

export const EditOperation = z.object({
  oldText: z
    .string()
    .describe(
      "Text to search for - will try exact match first, then flexible matching. " +
        "For multi-line searches, use actual newline characters, not \\n escape sequences. " +
        "Include 3-5 lines of surrounding context for reliable matching."
    ),
  newText: z
    .string()
    .describe(
      "Text to replace with. For multi-line replacements, use actual newline characters, not \\n escape sequences."
    ),
  instruction: z
    .string()
    .optional()
    .describe(
      "Optional: Semantic description of what this edit does and why. " +
        "Example: 'Add timeout parameter to fetchData function for better error handling'. " +
        "This helps provide better error messages if the edit fails."
    ),
  expectedOccurrences: z
    .number()
    .int()
    .positive()
    .optional()
    .default(1)
    .describe(
      "Expected number of occurrences to replace. Defaults to 1. " +
        "Set to a specific number to validate the replacement count. " +
        "The tool will fail if actual occurrences don't match this number."
    ),
}) satisfies z.ZodType<FileEdit>;

export const EditFileArgsSchema = z.object({
  path: z.string(),
  edits: z
    .array(EditOperation)
    .min(1, "At least one edit must be provided")
    .describe("Array of edits to apply sequentially"),
  dryRun: z
    .boolean()
    .optional()
    .default(false)
    .describe("Preview changes using git-style diff format without writing"),
  matchingStrategy: z
    .enum(["exact", "flexible", "fuzzy", "auto"])
    .optional()
    .default("auto")
    .describe(
      "Matching strategy:\n" +
        "- 'exact': Strict character-for-character match (fastest, safest)\n" +
        "- 'flexible': Whitespace-insensitive line-by-line matching\n" +
        "- 'fuzzy': Token-based regex matching (most permissive)\n" +
        "- 'auto': Try exact → flexible → fuzzy (recommended, default)"
    ),
  failOnAmbiguous: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      "If true, fail when oldText matches multiple locations (unless expectedOccurrences > 1). " +
        "If false, replace first occurrence only and warn about ambiguity."
    ),
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

export const ShellCommandArgsSchema = z.object({
  command: z
    .string()
    .min(1, "Command cannot be empty")
    .describe(
      "Shell command to execute. " +
        "For Windows: executed as 'powershell.exe -Command <command>'. " +
        "For Unix/Mac: executed as 'bash -c <command>'. " +
        "*** WARNING: Command substitution using $(), ``, <(), or >() may be restricted for security."
    ),
  description: z
    .string()
    .optional()
    .describe(
      "Brief description of what the command does and why it's needed. " +
        "Be specific and concise. Ideally a single sentence. " +
        "Can be up to 3 sentences for clarity. No line breaks."
    ),
  workdir: z
    .string()
    .optional()
    .describe(
      "Optional absolute path to the directory where the command should be executed. " +
        "Must be within allowed directories. If not provided, uses current working directory."
    ),
  timeout: z
    .number()
    .int()
    .positive()
    .optional()
    .default(30000)
    .describe(
      "Timeout in milliseconds for command execution. Defaults to 30000 (30 seconds). " +
        "Commands exceeding this duration will be terminated."
    ),
  requiresApproval: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Indicates if this command requires explicit user approval. " +
        "Set to true for potentially dangerous operations (installing packages, deleting files, etc.)."
    ),
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
export type ShellCommandArgs = z.infer<typeof ShellCommandArgsSchema>;

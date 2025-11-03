import fs from "fs/promises";
import path from "path";
import { minimatch } from "minimatch";
import { zodToJsonSchema } from "zod-to-json-schema";
import { ToolSchema } from "@modelcontextprotocol/sdk/types.js";
import { expandHome, normalizePath } from "../utils/path-utils.js";
import { isPathWithinAllowedDirectories } from "../utils/path-validation.js";
import {
  MakeDirectoryArgsSchema,
  ListDirectoryArgsSchema,
  ListDirectoryWithSizesArgsSchema,
  DirectoryTreeArgsSchema,
  MoveFileArgsSchema,
  GetFileInfoArgsSchema,
  RegisterDirectoryArgsSchema,
  FileOperationsArgsSchema,
  DeleteFilesArgsSchema,
  type MakeDirectoryArgs,
  type ListDirectoryArgs,
  type ListDirectoryWithSizesArgs,
  type DirectoryTreeArgs,
  type MoveFileArgs,
  type GetFileInfoArgs,
  type RegisterDirectoryArgs,
  type FileOperationsArgs,
  type DeleteFilesArgs,
} from "../types/index.js";
import {
  validatePath,
  getFileStats,
  formatSize,
  getAllowedDirectories,
  setAllowedDirectories,
  shouldIgnoreFolder,
  getIgnoredFolders,
} from "../utils/lib.js";

const ToolInputSchema = ToolSchema.shape.inputSchema;
type ToolInput = any;

// Internal interfaces for unified list_directory implementation
interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedTime: Date;
  children?: FileEntry[];
}

interface ListingResult {
  entries: FileEntry[];
  excludedByPatterns: number;
  excludedByIgnoreRules: number;
}

export function getFileSystemTools() {
  // Get current allowed directories for dynamic descriptions
  const currentAllowedDirs = getAllowedDirectories();

  // Generate dynamic text for pre-approved directories
  const generateApprovedDirsText = (): string => {
    if (currentAllowedDirs.length === 0) {
      return "\n\nCURRENTLY ACCESSIBLE DIRECTORIES: None. Use this tool to register directories for access.";
    }

    const dirList = currentAllowedDirs.map((dir) => `  - ${dir}`).join("\n");
    return `\n\nPRE-APPROVED DIRECTORIES (already accessible, DO NOT register these):\n${dirList}\n\nIMPORTANT: These directories and their subdirectories are ALREADY accessible to all filesystem tools. Do NOT use register_directory for these paths or any subdirectories within them.`;
  };

  return [
    {
      name: "make_directory",
      description:
        "Create single or multiple directories with recursive parent creation " +
        "(like Unix 'mkdir -p'). Idempotent - won't error if directories exist. " +
        "Only works within allowed directories.",
      inputSchema: zodToJsonSchema(MakeDirectoryArgsSchema) as ToolInput,
    },
    {
      name: "list_directory",
      description:
        "List directory contents with flexible output formats. Replaces the previous " +
        "list_directory, list_directory_with_sizes, and directory_tree tools. " +
        "Supports simple listings, detailed views with sizes/timestamps, hierarchical " +
        "tree display, and structured JSON output. Automatically filters globally " +
        "configured ignored folders. Only works within allowed directories.",
      inputSchema: zodToJsonSchema(ListDirectoryArgsSchema) as ToolInput,
    },
    {
      name: "move_file",
      description:
        "Relocate or rename files and directories in a single atomic operation. " +
        "Supports cross-directory moves with simultaneous renaming when needed. " +
        "Fails safely if the destination path already exists to prevent accidental overwrites. " +
        "Can also perform simple same-directory renames. " +
        "Both source and destination must be within allowed directories.",
      inputSchema: zodToJsonSchema(MoveFileArgsSchema) as ToolInput,
    },
    {
      name: "get_file_info",
      description:
        "Extract comprehensive metadata and statistics for files or directories. " +
        "Provides detailed information including size, timestamps (creation and last modification), permissions, and entry type. " +
        "Perfect for inspecting file properties and attributes without accessing the actual content. " +
        "Only works within allowed directories.",
      inputSchema: zodToJsonSchema(GetFileInfoArgsSchema) as ToolInput,
    },
    {
      name: "register_directory",
      description:
        "Register a directory for access. This allows the AI to dynamically gain access " +
        "to directories specified by the human user during conversation. The directory " +
        "and all its subdirectories will become accessible for all filesystem operations." +
        generateApprovedDirsText(),
      inputSchema: zodToJsonSchema(RegisterDirectoryArgsSchema) as ToolInput,
    },
    {
      name: "list_allowed_directories",
      description:
        "Display all directories currently accessible to the server. " +
        "Note that subdirectories within listed paths are implicitly accessible as well. " +
        "Use this to determine available filesystem scope and plan operations accordingly before attempting file access." +
        generateApprovedDirsText(),
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    {
      name: "file_operations",
      description:
        "Perform bulk file operations (move, copy, rename) on single or multiple files and directories concurrently. " +
        "All operations are validated for security before execution. Supports conflict resolution " +
        "strategies for existing destinations. Maximum 100 files per operation for performance.",
      inputSchema: {
        type: "object",
        properties: {
          operation: {
            type: "string",
            enum: ["move", "copy", "rename"],
            description: "The type of file operation to perform",
          },
          files: {
            type: "array",
            items: {
              type: "object",
              properties: {
                source: {
                  type: "string",
                  description: "Source file or directory path",
                },
                destination: {
                  type: "string",
                  description: "Destination file or directory path",
                },
              },
              required: ["source", "destination"],
              additionalProperties: false,
            },
            minItems: 1,
            maxItems: 100,
            description: "Array of source-destination file pairs",
          },
          onConflict: {
            type: "string",
            enum: ["skip", "overwrite", "error"],
            description: "How to handle destination conflicts",
            default: "error",
          },
        },
        required: ["operation", "files"],
        additionalProperties: false,
      } as ToolInput,
    },
    {
      name: "delete_files",
      description:
        "Delete single or multiple files and directories securely. " +
        "Supports recursive directory deletion with safety controls. " +
        "All paths are validated before deletion begins. " +
        "Operations are processed concurrently for performance. " +
        "Maximum 100 paths per operation. " +
        "Only works within allowed directories.",
      inputSchema: zodToJsonSchema(DeleteFilesArgsSchema) as ToolInput,
    },
  ];
}

// ============================================================================
// UNIFIED LIST_DIRECTORY IMPLEMENTATION
// ============================================================================

/**
 * Helper: Collect file entry metadata
 */
async function collectFileEntry(
  entryPath: string,
  dirent: any
): Promise<FileEntry> {
  try {
    const stats = await fs.stat(entryPath);
    return {
      name: dirent.name,
      path: entryPath,
      isDirectory: dirent.isDirectory(),
      size: stats.size,
      modifiedTime: stats.mtime,
    };
  } catch (error) {
    // Return minimal entry on error
    return {
      name: dirent.name,
      path: entryPath,
      isDirectory: dirent.isDirectory(),
      size: 0,
      modifiedTime: new Date(0),
    };
  }
}

/**
 * Helper: Filter entries and collect metadata
 */
async function filterAndCollectEntries(
  rawEntries: any[],
  basePath: string,
  args: ListDirectoryArgs
): Promise<ListingResult> {
  let excludedByPatterns = 0;
  let excludedByIgnoreRules = 0;
  const entries: FileEntry[] = [];

  for (const dirent of rawEntries) {
    // Check global ignore rules
    if (dirent.isDirectory() && shouldIgnoreFolder(dirent.name)) {
      excludedByIgnoreRules++;
      continue;
    }

    // Check user exclude patterns
    if (args.excludePatterns && args.excludePatterns.length > 0) {
      const shouldExclude = args.excludePatterns.some((pattern) => {
        return minimatch(dirent.name, pattern, { dot: true });
      });
      if (shouldExclude) {
        excludedByPatterns++;
        continue;
      }
    }

    // Collect entry with metadata
    const entryPath = path.join(basePath, dirent.name);
    const entry = await collectFileEntry(entryPath, dirent);
    entries.push(entry);
  }

  return { entries, excludedByPatterns, excludedByIgnoreRules };
}

/**
 * Helper: Recursively expand directory entries for tree/json formats
 */
async function recursivelyExpandEntries(
  entries: FileEntry[],
  args: ListDirectoryArgs
): Promise<void> {
  for (const entry of entries) {
    if (entry.isDirectory) {
      try {
        const subEntries = await fs.readdir(entry.path, {
          withFileTypes: true,
        });
        const { entries: children } = await filterAndCollectEntries(
          subEntries,
          entry.path,
          args
        );
        entry.children = children;

        // Recurse
        await recursivelyExpandEntries(children, args);
      } catch (error) {
        entry.children = [];
      }
    }
  }
}

/**
 * Helper: Sort entries (Gemini-inspired - always dirs first, then by criterion)
 */
function sortEntries(entries: FileEntry[], sortBy: string): FileEntry[] {
  return [...entries].sort((a, b) => {
    // Always group directories first (Gemini best practice)
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;

    // Then apply sort criterion
    if (sortBy === "size") {
      return b.size - a.size; // Descending by size
    }

    // Default: alphabetical by name
    return a.name.localeCompare(b.name);
  });
}

/**
 * Helper: Count files recursively
 */
function countFiles(entries: FileEntry[]): number {
  let count = 0;
  for (const entry of entries) {
    if (!entry.isDirectory) {
      count++;
    }
    if (entry.children) {
      count += countFiles(entry.children);
    }
  }
  return count;
}

/**
 * Helper: Count directories recursively
 */
function countDirectories(entries: FileEntry[]): number {
  let count = 0;
  for (const entry of entries) {
    if (entry.isDirectory) {
      count++;
      if (entry.children) {
        count += countDirectories(entry.children);
      }
    }
  }
  return count;
}

/**
 * Helper: Calculate total size recursively
 */
function calculateTotalSize(entries: FileEntry[]): number {
  let total = 0;
  for (const entry of entries) {
    if (!entry.isDirectory) {
      total += entry.size;
    }
    if (entry.children) {
      total += calculateTotalSize(entry.children);
    }
  }
  return total;
}

/**
 * Format: Simple (default)
 */
function formatSimple(
  entries: FileEntry[],
  excludedByPatterns: number,
  excludedByIgnoreRules: number
): { content: any[] } {
  const lines = entries.map((entry) => {
    const prefix = entry.isDirectory ? "[DIR]" : "[FILE]";
    return `${prefix} ${entry.name}`;
  });

  // Summary
  const totalFiles = entries.filter((e) => !e.isDirectory).length;
  const totalDirs = entries.filter((e) => e.isDirectory).length;
  lines.push("");
  lines.push(`Total: ${totalFiles} files, ${totalDirs} directories`);

  // Show exclusion counts
  const totalExcluded = excludedByPatterns + excludedByIgnoreRules;
  if (totalExcluded > 0) {
    lines.push(`(${totalExcluded} filtered by ignore rules)`);
  }

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

/**
 * Format: Detailed (with sizes and metadata)
 */
function formatDetailed(
  entries: FileEntry[],
  excludedByPatterns: number,
  excludedByIgnoreRules: number
): { content: any[] } {
  const header = "Type      Name                  Size        Modified";
  const separator = "-".repeat(70);

  const lines = entries.map((entry) => {
    const type = entry.isDirectory ? "[DIR]" : "[FILE]";
    const name = entry.name.padEnd(20);
    const size = entry.isDirectory
      ? "-".padStart(11)
      : formatSize(entry.size).padStart(11);
    const mtime = entry.modifiedTime
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");

    return `${type}     ${name} ${size} ${mtime}`;
  });

  // Summary
  const totalFiles = entries.filter((e) => !e.isDirectory).length;
  const totalDirs = entries.filter((e) => e.isDirectory).length;
  const totalSize = entries.reduce(
    (sum, e) => sum + (e.isDirectory ? 0 : e.size),
    0
  );

  const output = [
    header,
    separator,
    ...lines,
    "",
    `Total: ${totalFiles} files, ${totalDirs} directories`,
    `Combined size: ${formatSize(totalSize)}`,
  ];

  const totalExcluded = excludedByPatterns + excludedByIgnoreRules;
  if (totalExcluded > 0) {
    output.push(`(${totalExcluded} filtered by ignore rules)`);
  }

  return { content: [{ type: "text", text: output.join("\n") }] };
}

/**
 * Format: Tree (hierarchical text tree)
 */
function formatTree(
  entries: FileEntry[],
  excludedByPatterns: number,
  prefix: string = "",
  isRoot: boolean = true
): { content: any[] } {
  const lines: string[] = [];

  if (isRoot) {
    lines.push(".");
  }

  entries.forEach((entry, index) => {
    const isLast = index === entries.length - 1;
    const connector = isLast ? "└── " : "├── ";
    const suffix = entry.isDirectory ? "/" : "";

    lines.push(`${prefix}${connector}${entry.name}${suffix}`);

    if (entry.children && entry.children.length > 0) {
      const childPrefix = prefix + (isLast ? "    " : "│   ");
      const childResult = formatTree(entry.children, 0, childPrefix, false);
      lines.push(
        ...childResult.content[0].text.split("\n").filter((l: string) => l)
      );
    }
  });

  if (isRoot) {
    const totalFiles = countFiles(entries);
    const totalDirs = countDirectories(entries);
    lines.push("");
    lines.push(`${totalDirs} directories, ${totalFiles} files`);

    if (excludedByPatterns > 0) {
      lines.push(`(${excludedByPatterns} entries excluded by patterns)`);
    }
  }

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

/**
 * Format: JSON (structured data)
 */
function formatJson(
  entries: FileEntry[],
  basePath: string,
  excludedByPatterns: number,
  excludedByIgnoreRules: number
): { content: any[] } {
  const totalFiles = countFiles(entries);
  const totalDirs = countDirectories(entries);
  const totalSize = calculateTotalSize(entries);

  const output = {
    path: basePath,
    entries: entries.map((e) => ({
      name: e.name,
      type: e.isDirectory ? "directory" : "file",
      path: e.path,
      isDirectory: e.isDirectory,
      size: e.size,
      modifiedTime: e.modifiedTime.toISOString(),
      ...(e.children && { children: e.children }),
    })),
    summary: {
      totalFiles,
      totalDirectories: totalDirs,
      totalSize,
      totalSizeFormatted: formatSize(totalSize),
      excludedByPatterns,
      excludedByIgnoreRules,
    },
  };

  return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }] };
}

/**
 * Format output based on selected format
 */
function formatOutput(
  entries: FileEntry[],
  args: ListDirectoryArgs,
  excludedByPatterns: number,
  excludedByIgnoreRules: number
): { content: any[] } {
  switch (args.format) {
    case "simple":
      return formatSimple(entries, excludedByPatterns, excludedByIgnoreRules);
    case "detailed":
      return formatDetailed(entries, excludedByPatterns, excludedByIgnoreRules);
    case "tree":
      return formatTree(entries, excludedByPatterns);
    case "json":
      return formatJson(
        entries,
        args.path,
        excludedByPatterns,
        excludedByIgnoreRules
      );
    default:
      return formatSimple(entries, excludedByPatterns, excludedByIgnoreRules);
  }
}

/**
 * Main unified list_directory implementation
 */
async function listDirectory(
  args: ListDirectoryArgs
): Promise<{ content: any[] }> {
  // Step 1: Validate path
  const validPath = await validatePath(args.path);

  // Step 2: Read directory
  const rawEntries = await fs.readdir(validPath, { withFileTypes: true });

  // Step 3: Apply filtering and collect metadata
  const { entries, excludedByPatterns, excludedByIgnoreRules } =
    await filterAndCollectEntries(rawEntries, validPath, args);

  // Step 4: Handle recursive formats (tree and json)
  if (args.format === "tree" || args.format === "json") {
    await recursivelyExpandEntries(entries, args);
  }

  // Step 5: Apply sorting (always dirs first, then by sortBy)
  const sorted = sortEntries(entries, args.sortBy || "name");

  // Step 6: Format output
  return formatOutput(sorted, args, excludedByPatterns, excludedByIgnoreRules);
}

// ============================================================================
// END UNIFIED LIST_DIRECTORY IMPLEMENTATION
// ============================================================================

export async function handleFileSystemTool(name: string, args: any) {
  switch (name) {
    case "make_directory": {
      const parsed = MakeDirectoryArgsSchema.safeParse(args);
      if (!parsed.success) {
        throw new Error(
          `Invalid arguments for make_directory: ${parsed.error}`
        );
      }

      // Normalize to array (single path or multiple paths)
      const pathsToCreate = Array.isArray(parsed.data.paths)
        ? parsed.data.paths
        : [parsed.data.paths];

      // Validate all paths first (atomic - fail before any creation)
      const allowedDirs = getAllowedDirectories();
      const validatedPaths = pathsToCreate.map((dirPath) => {
        const expandedPath = expandHome(dirPath);
        // Resolve to absolute path - required by isPathWithinAllowedDirectories
        const absolutePath = path.isAbsolute(expandedPath)
          ? path.resolve(expandedPath)
          : path.resolve(process.cwd(), expandedPath);
        const normalized = normalizePath(absolutePath);

        // Use secure path validation function to prevent prefix collision attacks
        // (CVE-2025-54794 pattern: ensures path separator is required, not just prefix match)
        if (!isPathWithinAllowedDirectories(normalized, allowedDirs)) {
          throw new Error(
            `Access denied: Path ${dirPath} is not within allowed directories`
          );
        }

        return { original: dirPath, normalized };
      });

      // All validated - now create them concurrently
      const results = await Promise.all(
        validatedPaths.map(async ({ original, normalized }) => {
          await fs.mkdir(normalized, { recursive: true });
          return original;
        })
      );

      // Format response based on single vs batch
      const message =
        results.length === 1
          ? `Successfully created directory ${results[0]}`
          : `Successfully created ${results.length} directories:\n${results
              .map((p) => `  - ${p}`)
              .join("\n")}`;

      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
      };
    }

    case "list_directory": {
      const parsed = ListDirectoryArgsSchema.safeParse(args);
      if (!parsed.success) {
        throw new Error(
          `Invalid arguments for list_directory: ${parsed.error}`
        );
      }
      return await listDirectory(parsed.data);
    }

    case "move_file": {
      const parsed = MoveFileArgsSchema.safeParse(args);
      if (!parsed.success) {
        throw new Error(`Invalid arguments for move_file: ${parsed.error}`);
      }
      const validSourcePath = await validatePath(parsed.data.source);
      const validDestPath = await validatePath(parsed.data.destination);
      await fs.rename(validSourcePath, validDestPath);
      return {
        content: [
          {
            type: "text",
            text: `Successfully moved ${parsed.data.source} to ${parsed.data.destination}`,
          },
        ],
      };
    }

    case "get_file_info": {
      const parsed = GetFileInfoArgsSchema.safeParse(args);
      if (!parsed.success) {
        throw new Error(`Invalid arguments for get_file_info: ${parsed.error}`);
      }
      const validPath = await validatePath(parsed.data.path);
      const info = await getFileStats(validPath);
      return {
        content: [
          {
            type: "text",
            text: Object.entries(info)
              .map(([key, value]) => `${key}: ${value}`)
              .join("\n"),
          },
        ],
      };
    }

    case "register_directory": {
      const parsed = RegisterDirectoryArgsSchema.safeParse(args);
      if (!parsed.success) {
        throw new Error(
          `Invalid arguments for register_directory: ${parsed.error}`
        );
      }

      const expandedPath = expandHome(parsed.data.path);
      const absolutePath = path.resolve(expandedPath);
      const normalizedPath = normalizePath(absolutePath);

      // Validate that the path exists and is a directory
      try {
        const stats = await fs.stat(absolutePath);
        if (!stats.isDirectory()) {
          throw new Error(`Path ${absolutePath} is not a directory`);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new Error(`Directory ${absolutePath} does not exist`);
        }
        throw error;
      }

      // Add to allowed directories
      const currentDirs = getAllowedDirectories();
      if (!currentDirs.includes(normalizedPath)) {
        setAllowedDirectories([...currentDirs, normalizedPath]);
        return {
          content: [
            {
              type: "text",
              text: `Successfully registered directory: ${parsed.data.path} (${normalizedPath})`,
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: "text",
              text: `Directory already registered: ${parsed.data.path} (${normalizedPath})`,
            },
          ],
        };
      }
    }

    case "list_allowed_directories": {
      return {
        content: [
          {
            type: "text",
            text: `Allowed directories:\n${getAllowedDirectories().join("\n")}`,
          },
        ],
      };
    }

    case "file_operations": {
      const parsed = FileOperationsArgsSchema.safeParse(args);
      if (!parsed.success) {
        throw new Error(
          `Invalid arguments for file_operations: ${parsed.error}`
        );
      }

      // Phase 1: Path Validation
      const validationPromises = parsed.data.files.map(async (file, index) => {
        try {
          const validSource = await validatePath(file.source);
          const validDest = await validatePath(file.destination);
          return {
            index,
            source: file.source,
            destination: file.destination,
            validSource,
            validDest,
            success: true,
          };
        } catch (error) {
          return {
            index,
            source: file.source,
            destination: file.destination,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      });

      const validatedFiles = await Promise.all(validationPromises);

      // Check for validation errors
      const validationErrors = validatedFiles.filter((f) => !f.success);
      if (validationErrors.length > 0) {
        const errorMessages = validationErrors
          .map(
            (f) =>
              `${f.source} → ${f.destination}: ${f.error || "Unknown error"}`
          )
          .join("\n");
        throw new Error(`Path validation failed:\n${errorMessages}`);
      }

      // Phase 2: Conflict Detection
      const conflictChecks = await Promise.all(
        validatedFiles.map(async (file) => {
          try {
            await fs.access(file.validDest!);
            return {
              ...file,
              hasConflict: true,
            };
          } catch {
            return {
              ...file,
              hasConflict: false,
            };
          }
        })
      );

      // Handle conflicts based on strategy
      const filesToProcess = conflictChecks.filter((file) => {
        if (file.hasConflict) {
          switch (parsed.data.onConflict) {
            case "skip":
              return false;
            case "error":
              throw new Error(
                `Destination already exists: ${file.destination}`
              );
            case "overwrite":
              return true;
          }
        }
        return true;
      });

      // Phase 3: Execute Operations
      const operationPromises = filesToProcess.map(async (file) => {
        try {
          switch (parsed.data.operation) {
            case "move":
            case "rename":
              await fs.rename(file.validSource!, file.validDest!);
              break;
            case "copy":
              const stats = await fs.stat(file.validSource!);
              if (stats.isDirectory()) {
                await copyDirectoryRecursive(
                  file.validSource!,
                  file.validDest!
                );
              } else {
                await fs.copyFile(file.validSource!, file.validDest!);
              }
              break;
          }
          return {
            index: file.index,
            source: file.source,
            destination: file.destination,
            success: true,
            operation: parsed.data.operation,
          };
        } catch (error) {
          return {
            index: file.index,
            source: file.source,
            destination: file.destination,
            success: false,
            error: error instanceof Error ? error.message : String(error),
            operation: parsed.data.operation,
          };
        }
      });

      const results = await Promise.allSettled(operationPromises);
      const processedResults = results.map((result, index) => {
        if (result.status === "fulfilled") {
          return result.value;
        } else {
          return {
            index,
            source: filesToProcess[index].source,
            destination: filesToProcess[index].destination,
            success: false,
            error:
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason),
            operation: parsed.data.operation,
          };
        }
      });

      // Prepare response
      const successful = processedResults.filter((r) => r.success);
      const failed = processedResults.filter((r) => !r.success);

      const successDetails = successful
        .map((r) => `✓ ${r.source} → ${r.destination}`)
        .join("\n");

      const failureDetails =
        failed.length > 0
          ? failed
              .map((r) => `✗ ${r.source} → ${r.destination}: ${r.error}`)
              .join("\n")
          : "";

      return {
        content: [
          {
            type: "text",
            text:
              `Successfully performed ${parsed.data.operation} operations:\n\n` +
              `Total operations: ${processedResults.length}\n` +
              `Successful: ${successful.length}\n` +
              `Failed: ${failed.length}\n\n` +
              (failed.length > 0
                ? `Failed operations:\n${failureDetails}\n\n`
                : "") +
              `Processed files:\n${successDetails}`,
          },
        ],
      };
    }

    case "delete_files": {
      const parsed = DeleteFilesArgsSchema.safeParse(args);
      if (!parsed.success) {
        throw new Error(`Invalid arguments for delete_files: ${parsed.error}`);
      }

      // Phase 1: Path Validation
      const validationPromises = parsed.data.paths.map(
        async (filePath, index) => {
          try {
            const validPath = await validatePath(filePath);
            return {
              index,
              originalPath: filePath,
              validPath,
              success: true,
            };
          } catch (error) {
            return {
              index,
              originalPath: filePath,
              success: false,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        }
      );

      const validatedPaths = await Promise.all(validationPromises);

      // Check for validation errors
      const validationErrors = validatedPaths.filter((p) => !p.success);
      if (validationErrors.length > 0) {
        const errorMessages = validationErrors
          .map((p) => `${p.originalPath}: ${p.error || "Unknown error"}`)
          .join("\n");
        throw new Error(`Path validation failed:\n${errorMessages}`);
      }

      // Phase 2: Pre-deletion Checks
      const preCheckPromises = validatedPaths.map(async (item) => {
        try {
          const stats = await fs.stat(item.validPath!);
          return {
            ...item,
            exists: true,
            isDirectory: stats.isDirectory(),
          };
        } catch (error) {
          return {
            ...item,
            exists: false,
            isDirectory: false,
            error: `File does not exist: ${item.originalPath}`,
          };
        }
      });

      const checkedPaths = await Promise.all(preCheckPromises);

      // Filter out non-existent paths
      const pathsToDelete = checkedPaths.filter((p) => p.exists);

      if (pathsToDelete.length === 0) {
        throw new Error(
          "No valid paths to delete - all paths either don't exist or failed validation"
        );
      }

      // Phase 3: Execute Deletions
      const deletionPromises = pathsToDelete.map(async (item) => {
        try {
          if (item.isDirectory) {
            if (parsed.data.recursive) {
              // Recursive directory deletion
              await fs.rm(item.validPath!, {
                recursive: true,
                force: parsed.data.force,
              });
            } else {
              // Non-recursive - only delete empty directories
              await fs.rmdir(item.validPath!);
            }
          } else {
            // File deletion
            await fs.unlink(item.validPath!);
          }
          return {
            index: item.index,
            path: item.originalPath,
            success: true,
            isDirectory: item.isDirectory,
          };
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          // Provide helpful error messages
          let friendlyError = errorMessage;
          if (
            errorMessage.includes("ENOTEMPTY") ||
            errorMessage.includes("directory not empty")
          ) {
            friendlyError = `Directory not empty. Use recursive: true to delete non-empty directories.`;
          } else if (
            errorMessage.includes("EACCES") ||
            errorMessage.includes("EPERM")
          ) {
            friendlyError = `Permission denied. ${
              parsed.data.force
                ? "Insufficient permissions even with force enabled."
                : "Try using force: true if appropriate."
            }`;
          }

          return {
            index: item.index,
            path: item.originalPath,
            success: false,
            error: friendlyError,
            isDirectory: item.isDirectory || false,
          };
        }
      });

      const results = await Promise.allSettled(deletionPromises);

      // Process results
      const processedResults = results.map((result, index) => {
        if (result.status === "fulfilled") {
          return result.value;
        } else {
          return {
            index,
            path: pathsToDelete[index].originalPath,
            success: false,
            isDirectory: pathsToDelete[index].isDirectory || false,
            error:
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason),
          };
        }
      });

      // Prepare response
      const successful = processedResults.filter((r) => r.success);
      const failed = processedResults.filter((r) => !r.success);

      const successDetails = successful
        .map((r) => `✓ ${r.path}${r.isDirectory ? " (directory)" : ""}`)
        .join("\n");

      const failureDetails =
        failed.length > 0
          ? failed.map((r) => `✗ ${r.path}: ${r.error}`).join("\n")
          : "";

      // Build response message
      const responseLines = [
        `Successfully deleted ${successful.length} of ${processedResults.length} paths:`,
        "",
        `Total paths: ${processedResults.length}`,
        `Successful: ${successful.length}`,
        `Failed: ${failed.length}`,
        "",
      ];

      if (failed.length > 0) {
        responseLines.push(`Failed deletions:`, failureDetails, "");
      }

      if (successful.length > 0) {
        responseLines.push(`Deleted paths:`, successDetails);
      }

      return {
        content: [
          {
            type: "text",
            text: responseLines.join("\n"),
          },
        ],
      };
    }

    default:
      throw new Error(`Unknown filesystem tool: ${name}`);
  }
}

// Helper function for recursive directory copying
async function copyDirectoryRecursive(
  source: string,
  destination: string
): Promise<void> {
  // Create destination directory
  await fs.mkdir(destination, { recursive: true });

  // Read source directory
  const entries = await fs.readdir(source, { withFileTypes: true });

  // Copy all entries
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const destPath = path.join(destination, entry.name);

    if (entry.isDirectory()) {
      await copyDirectoryRecursive(sourcePath, destPath);
    } else {
      await fs.copyFile(sourcePath, destPath);
    }
  }
}

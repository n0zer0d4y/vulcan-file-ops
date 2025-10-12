import fs from "fs/promises";
import path from "path";
import { minimatch } from "minimatch";
import { zodToJsonSchema } from "zod-to-json-schema";
import { ToolSchema } from "@modelcontextprotocol/sdk/types.js";
import { expandHome, normalizePath } from "../utils/path-utils.js";
import {
  CreateDirectoryArgsSchema,
  ListDirectoryArgsSchema,
  ListDirectoryWithSizesArgsSchema,
  DirectoryTreeArgsSchema,
  MoveFileArgsSchema,
  GetFileInfoArgsSchema,
  RegisterDirectoryArgsSchema,
  FileOperationsArgsSchema,
  DeleteFilesArgsSchema,
  type CreateDirectoryArgs,
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
      name: "create_directory",
      description:
        "Create new directories or verify directory existence. " +
        "Supports creating deeply nested directory structures in a single call with recursive parent creation. " +
        "Operates idempotently - existing directories are simply confirmed without errors. " +
        "Ideal for initializing project scaffolding or guaranteeing path availability. " +
        "Only works within allowed directories.",
      inputSchema: zodToJsonSchema(CreateDirectoryArgsSchema) as ToolInput,
    },
    {
      name: "list_directory",
      description:
        "Display comprehensive listings of directory contents including all files and subdirectories. " +
        "Output uses clear [FILE] and [DIR] prefixes to differentiate between entry types at a glance. " +
        "Essential for exploring directory organization and locating specific items within folders. " +
        "Only works within allowed directories.",
      inputSchema: zodToJsonSchema(ListDirectoryArgsSchema) as ToolInput,
    },
    {
      name: "list_directory_with_sizes",
      description:
        "Display enhanced directory listings with file size information. " +
        "Shows all entries with [FILE] and [DIR] prefixes for quick identification, plus file sizes for capacity planning. " +
        "Supports sorting by name or size for flexible organization views. " +
        "Useful for analyzing directory composition and identifying large files. " +
        "Only works within allowed directories.",
      inputSchema: zodToJsonSchema(
        ListDirectoryWithSizesArgsSchema
      ) as ToolInput,
    },
    {
      name: "directory_tree",
      description:
        "Generate hierarchical tree representations of directory structures as JSON. " +
        "Each node contains 'name' and 'type' (file/directory) properties, with directories including a 'children' array for nested contents. " +
        "Files omit the children property, while directories always include it (even if empty). " +
        "Output uses 2-space indentation for clean formatting and easy parsing. " +
        "Only works within allowed directories.",
      inputSchema: zodToJsonSchema(DirectoryTreeArgsSchema) as ToolInput,
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

export async function handleFileSystemTool(name: string, args: any) {
  switch (name) {
    case "create_directory": {
      const parsed = CreateDirectoryArgsSchema.safeParse(args);
      if (!parsed.success) {
        throw new Error(
          `Invalid arguments for create_directory: ${parsed.error}`
        );
      }
      const validPath = await validatePath(parsed.data.path);
      await fs.mkdir(validPath, { recursive: true });
      return {
        content: [
          {
            type: "text",
            text: `Successfully created directory ${parsed.data.path}`,
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
      const validPath = await validatePath(parsed.data.path);
      const entries = await fs.readdir(validPath, { withFileTypes: true });

      // Filter out ignored folders
      const filteredEntries = entries.filter((entry) => {
        // Always include files
        if (!entry.isDirectory()) {
          return true;
        }
        // Filter out directories that should be ignored
        return !shouldIgnoreFolder(entry.name);
      });

      const formatted = filteredEntries
        .map(
          (entry) => `${entry.isDirectory() ? "[DIR]" : "[FILE]"} ${entry.name}`
        )
        .join("\n");
      return {
        content: [{ type: "text", text: formatted }],
      };
    }

    case "list_directory_with_sizes": {
      const parsed = ListDirectoryWithSizesArgsSchema.safeParse(args);
      if (!parsed.success) {
        throw new Error(
          `Invalid arguments for list_directory_with_sizes: ${parsed.error}`
        );
      }
      const validPath = await validatePath(parsed.data.path);
      const entries = await fs.readdir(validPath, { withFileTypes: true });

      // Filter out ignored folders before processing
      const filteredEntries = entries.filter((entry) => {
        // Always include files
        if (!entry.isDirectory()) {
          return true;
        }
        // Filter out directories that should be ignored
        return !shouldIgnoreFolder(entry.name);
      });

      // Get detailed information for each entry
      const detailedEntries = await Promise.all(
        filteredEntries.map(async (entry) => {
          const entryPath = path.join(validPath, entry.name);
          try {
            const stats = await fs.stat(entryPath);
            return {
              name: entry.name,
              isDirectory: entry.isDirectory(),
              size: stats.size,
              mtime: stats.mtime,
            };
          } catch (error) {
            return {
              name: entry.name,
              isDirectory: entry.isDirectory(),
              size: 0,
              mtime: new Date(0),
            };
          }
        })
      );

      // Sort entries based on sortBy parameter
      const sortedEntries = [...detailedEntries].sort((a, b) => {
        if (parsed.data.sortBy === "size") {
          return b.size - a.size; // Descending by size
        }
        // Default sort by name
        return a.name.localeCompare(b.name);
      });

      // Format the output
      const formattedEntries = sortedEntries.map(
        (entry) =>
          `${entry.isDirectory ? "[DIR]" : "[FILE]"} ${entry.name.padEnd(30)} ${
            entry.isDirectory ? "" : formatSize(entry.size).padStart(10)
          }`
      );

      // Add summary
      const totalFiles = detailedEntries.filter((e) => !e.isDirectory).length;
      const totalDirs = detailedEntries.filter((e) => e.isDirectory).length;
      const totalSize = detailedEntries.reduce(
        (sum, entry) => sum + (entry.isDirectory ? 0 : entry.size),
        0
      );

      const summary = [
        "",
        `Total: ${totalFiles} files, ${totalDirs} directories`,
        `Combined size: ${formatSize(totalSize)}`,
      ];

      return {
        content: [
          {
            type: "text",
            text: [...formattedEntries, ...summary].join("\n"),
          },
        ],
      };
    }

    case "directory_tree": {
      const parsed = DirectoryTreeArgsSchema.safeParse(args);
      if (!parsed.success) {
        throw new Error(
          `Invalid arguments for directory_tree: ${parsed.error}`
        );
      }

      interface TreeEntry {
        name: string;
        type: "file" | "directory";
        children?: TreeEntry[];
      }

      const rootPath = parsed.data.path;

      // Combine user-specified patterns with global ignored folders
      const allExcludePatterns = [
        ...parsed.data.excludePatterns,
        ...getIgnoredFolders(),
      ];

      async function buildTree(
        currentPath: string,
        userExcludePatterns: string[] = []
      ): Promise<TreeEntry[]> {
        const validPath = await validatePath(currentPath);
        const entries = await fs.readdir(validPath, { withFileTypes: true });
        const result: TreeEntry[] = [];

        for (const entry of entries) {
          const relativePath = path.relative(
            rootPath,
            path.join(currentPath, entry.name)
          );

          // Check user-specified patterns
          const shouldExcludeByPattern = userExcludePatterns.some((pattern) => {
            if (pattern.includes("*")) {
              return minimatch(relativePath, pattern, { dot: true });
            }
            // For files: match exact name or as part of path
            // For directories: match as directory path
            return (
              minimatch(relativePath, pattern, { dot: true }) ||
              minimatch(relativePath, `**/${pattern}`, { dot: true }) ||
              minimatch(relativePath, `**/${pattern}/**`, { dot: true })
            );
          });

          // Also check global ignored folders for top-level entries
          const shouldExcludeByGlobal =
            entry.isDirectory() && shouldIgnoreFolder(entry.name);

          if (shouldExcludeByPattern || shouldExcludeByGlobal) continue;

          const entryData: TreeEntry = {
            name: entry.name,
            type: entry.isDirectory() ? "directory" : "file",
          };

          if (entry.isDirectory()) {
            const subPath = path.join(currentPath, entry.name);
            entryData.children = await buildTree(subPath, userExcludePatterns);
          }

          result.push(entryData);
        }

        return result;
      }

      const treeData = await buildTree(rootPath, allExcludePatterns);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(treeData, null, 2),
          },
        ],
      };
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

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
  type CreateDirectoryArgs,
  type ListDirectoryArgs,
  type ListDirectoryWithSizesArgs,
  type DirectoryTreeArgs,
  type MoveFileArgs,
  type GetFileInfoArgs,
  type RegisterDirectoryArgs,
  type FileOperationsArgs,
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
        "Create a new directory or ensure a directory exists. Can create multiple " +
        "nested directories in one operation. If the directory already exists, " +
        "this operation will succeed silently. Perfect for setting up directory " +
        "structures for projects or ensuring required paths exist. Only works within allowed directories.",
      inputSchema: zodToJsonSchema(CreateDirectoryArgsSchema) as ToolInput,
    },
    {
      name: "list_directory",
      description:
        "Get a detailed listing of all files and directories in a specified path. " +
        "Results clearly distinguish between files and directories with [FILE] and [DIR] " +
        "prefixes. This tool is essential for understanding directory structure and " +
        "finding specific files within a directory. Only works within allowed directories.",
      inputSchema: zodToJsonSchema(ListDirectoryArgsSchema) as ToolInput,
    },
    {
      name: "list_directory_with_sizes",
      description:
        "Get a detailed listing of all files and directories in a specified path, including sizes. " +
        "Results clearly distinguish between files and directories with [FILE] and [DIR] " +
        "prefixes. This tool is useful for understanding directory structure and " +
        "finding specific files within a directory. Only works within allowed directories.",
      inputSchema: zodToJsonSchema(
        ListDirectoryWithSizesArgsSchema
      ) as ToolInput,
    },
    {
      name: "directory_tree",
      description:
        "Get a recursive tree view of files and directories as a JSON structure. " +
        "Each entry includes 'name', 'type' (file/directory), and 'children' for directories. " +
        "Files have no children array, while directories always have a children array (which may be empty). " +
        "The output is formatted with 2-space indentation for readability. Only works within allowed directories.",
      inputSchema: zodToJsonSchema(DirectoryTreeArgsSchema) as ToolInput,
    },
    {
      name: "move_file",
      description:
        "Move or rename files and directories. Can move files between directories " +
        "and rename them in a single operation. If the destination exists, the " +
        "operation will fail. Works across different directories and can be used " +
        "for simple renaming within the same directory. Both source and destination must be within allowed directories.",
      inputSchema: zodToJsonSchema(MoveFileArgsSchema) as ToolInput,
    },
    {
      name: "get_file_info",
      description:
        "Retrieve detailed metadata about a file or directory. Returns comprehensive " +
        "information including size, creation time, last modified time, permissions, " +
        "and type. This tool is perfect for understanding file characteristics " +
        "without reading the actual content. Only works within allowed directories.",
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
        "Returns the list of directories that this server is allowed to access. " +
        "Subdirectories within these allowed directories are also accessible. " +
        "Use this to understand which directories and their nested paths are available " +
        "before trying to access files." +
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

import fs from "fs/promises";

import os from "os";

import path from "path";

import { minimatch } from "minimatch";

import { zodToJsonSchema } from "zod-to-json-schema";

import { ToolSchema } from "@modelcontextprotocol/sdk/types.js";

import { expandHome, normalizePath } from "../utils/path-utils.js";

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
  isPathCanonicallyAllowed,
  ensureDirectoryWithinAllowed,
} from "../utils/lib.js";
import {
  createEmptyObjectSchema,
  createPathArraySchema,
  sanitizeToolInputSchema,
} from "../utils/tool-schema.js";

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

// ============================================================================
// RUNTIME DIRECTORY REGISTRATION POLICY (register_directory)
// ============================================================================
//
// Security (VFO-07): register_directory widens the sandbox, so by default it
// requires a human to confirm each registration through the MCP client
// (elicitation). The server entry point installs the consent handler; when
// none is installed (or the client cannot prompt), registration is refused.

export const RUNTIME_REGISTRATION_POLICIES = [
  "confirm",
  "allow",
  "deny",
] as const;

export type RuntimeRegistrationPolicy =
  (typeof RUNTIME_REGISTRATION_POLICIES)[number];

export type DirectoryRegistrationConsent =
  | "accepted"
  | "declined"
  | "unsupported";

export type DirectoryRegistrationConsentHandler = (
  realPath: string,
) => Promise<DirectoryRegistrationConsent>;

let runtimeRegistrationPolicy: RuntimeRegistrationPolicy = "confirm";
let directoryRegistrationConsentHandler: DirectoryRegistrationConsentHandler | null =
  null;

export function isRuntimeRegistrationPolicy(
  value: string,
): value is RuntimeRegistrationPolicy {
  return (RUNTIME_REGISTRATION_POLICIES as readonly string[]).includes(value);
}

export function setRuntimeRegistrationPolicy(
  policy: RuntimeRegistrationPolicy,
): void {
  if (!isRuntimeRegistrationPolicy(policy)) {
    throw new Error(
      `Invalid runtime registration policy: ${policy}. Expected one of: ${RUNTIME_REGISTRATION_POLICIES.join(", ")}`,
    );
  }
  runtimeRegistrationPolicy = policy;
}

export function getRuntimeRegistrationPolicy(): RuntimeRegistrationPolicy {
  return runtimeRegistrationPolicy;
}

export function setDirectoryRegistrationConsentHandler(
  handler: DirectoryRegistrationConsentHandler | null,
): void {
  directoryRegistrationConsentHandler = handler;
}

function samePath(a: string, b: string): boolean {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

async function describeSensitiveDirectory(
  realPath: string,
): Promise<string | null> {
  if (path.parse(realPath).root === realPath) {
    return "a filesystem root";
  }
  let home = os.homedir();
  try {
    home = await fs.realpath(home);
  } catch {
    // Fall back to the lexical home directory
  }
  if (home && samePath(realPath, home)) {
    return "the user's home directory";
  }
  return null;
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
      inputSchema: {
        type: "object",
        properties: {
          paths: createPathArraySchema(
            "Directory paths to create. For maximum MCP client compatibility, provide an array even when creating a single directory."
          ),
        },
        required: ["paths"],
        additionalProperties: false,
      } as ToolInput,
    },
    {
      name: "list_directory",
      description:
        "List directory contents with flexible output formats. Replaces the previous " +
        "list_directory, list_directory_with_sizes, and directory_tree tools. " +
        "Supports simple listings, detailed views with sizes/timestamps, hierarchical " +
        "tree display, and structured JSON output. Automatically filters globally " +
        "configured ignored folders. Only works within allowed directories.",
      inputSchema: sanitizeToolInputSchema(
        zodToJsonSchema(ListDirectoryArgsSchema) as ToolInput
      ),
    },
    {
      name: "move_file",
      description:
        "Relocate or rename files and directories in a single atomic operation. " +
        "Supports cross-directory moves with simultaneous renaming when needed. " +
        "Fails safely if the destination path already exists to prevent accidental overwrites. " +
        "Can also perform simple same-directory renames. " +
        "Both source and destination must be within allowed directories.",
      inputSchema: sanitizeToolInputSchema(
        zodToJsonSchema(MoveFileArgsSchema) as ToolInput
      ),
    },
    {
      name: "get_file_info",
      description:
        "Extract comprehensive metadata and statistics for files or directories. " +
        "Provides detailed information including size, timestamps (creation and last modification), permissions, and entry type. " +
        "Perfect for inspecting file properties and attributes without accessing the actual content. " +
        "Only works within allowed directories.",
      inputSchema: sanitizeToolInputSchema(
        zodToJsonSchema(GetFileInfoArgsSchema) as ToolInput
      ),
    },
    {
      name: "register_directory",
      description:
        "Register a directory for access. This allows the AI to dynamically gain access " +
        "to directories specified by the human user during conversation. The directory " +
        "and all its subdirectories will become accessible for all filesystem operations. " +
        "By default the user must confirm each registration in their MCP client " +
        "(registration is refused if the client cannot show a confirmation prompt); " +
        "filesystem roots and the home directory cannot be registered at runtime." +
        generateApprovedDirsText(),
      inputSchema: sanitizeToolInputSchema(
        zodToJsonSchema(RegisterDirectoryArgsSchema) as ToolInput
      ),
    },
    {
      name: "list_allowed_directories",
      description:
        "Display all directories currently accessible to the server. " +
        "Note that subdirectories within listed paths are implicitly accessible as well. " +
        "Use this to determine available filesystem scope and plan operations accordingly before attempting file access." +
        generateApprovedDirsText(),
      inputSchema: createEmptyObjectSchema() as ToolInput,
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
      inputSchema: sanitizeToolInputSchema(
        zodToJsonSchema(DeleteFilesArgsSchema) as ToolInput
      ),
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
  dirent: any,
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

async function filterAndCollectEntries(
  rawEntries: any[],

  basePath: string,

  args: ListDirectoryArgs,
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

    if (args.excludePatterns && args.excludePatterns.length > 0) {
      const shouldExclude = args.excludePatterns.some((pattern: string) => {
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
  args: ListDirectoryArgs,
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
          args,
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
  excludedByIgnoreRules: number,
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
  excludedByIgnoreRules: number,
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
    0,
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
  isRoot: boolean = true,
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
        ...childResult.content[0].text.split("\n").filter((l: string) => l),
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
  excludedByIgnoreRules: number,
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
  excludedByIgnoreRules: number,
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
        excludedByIgnoreRules,
      );
    default:
      return formatSimple(entries, excludedByPatterns, excludedByIgnoreRules);
  }
}

/**
 * Main unified list_directory implementation
 */
async function listDirectory(
  args: ListDirectoryArgs,
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
          `Invalid arguments for make_directory: ${parsed.error}`,
        );
      }

      // Defensive handling for MCP clients that may stringify arrays
      // Some MCP clients (e.g., Claude Desktop) incorrectly serialize array parameters
      // as stringified JSON instead of proper arrays. This workaround detects and fixes that.
      let pathsInput = parsed.data.paths;

      // If paths is a string that looks like a JSON array, try to parse it
      if (typeof pathsInput === "string" && pathsInput.trim().startsWith("[")) {
        try {
          const parsedArray = JSON.parse(pathsInput);
          if (Array.isArray(parsedArray)) {
            pathsInput = parsedArray;
            // Log for diagnostics - helps identify which clients have serialization issues
            console.error(
              "[INFO] make_directory: Detected and corrected stringified array parameter",
            );
          }
        } catch {
          // If parsing fails, treat as single path (existing behavior)
          // This handles edge cases like paths literally named "[something]"
        }
      }

      // Normalize to array (single path or multiple paths)
      const pathsToCreate = Array.isArray(pathsInput)
        ? pathsInput
        : [pathsInput];

      // Validate all paths first (atomic - fail before any creation).
      // Security: the check is canonical (lexical + realpath + physical), so a
      // symlink or junction inside an allowed directory that points outside it
      // is rejected here instead of being followed by mkdir (VFO-05).
      const validatedPaths: { original: string; absolutePath: string }[] = [];
      for (const dirPath of pathsToCreate) {
        const expandedPath = expandHome(dirPath);
        const absolutePath = path.isAbsolute(expandedPath)
          ? path.resolve(expandedPath)
          : path.resolve(process.cwd(), expandedPath);

        if (!(await isPathCanonicallyAllowed(absolutePath, process.cwd()))) {
          throw new Error(
            `Access denied: Path ${dirPath} is not within allowed directories`,
          );
        }

        validatedPaths.push({ original: dirPath, absolutePath });
      }

      // All validated - now create them. ensureDirectoryWithinAllowed creates
      // missing segments one at a time and re-checks the realpath of each, so
      // a link swapped in after validation cannot redirect creation.
      const results = await Promise.all(
        validatedPaths.map(async ({ original, absolutePath }) => {
          await ensureDirectoryWithinAllowed(absolutePath);
          return original;
        }),
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
          `Invalid arguments for list_directory: ${parsed.error}`,
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
      // fs.rename silently replaces an existing destination; move_file is
      // documented to never overwrite.
      try {
        const destStats = await fs.lstat(validDestPath, { bigint: true });
        const sourceStats = await fs.lstat(validSourcePath, { bigint: true });
        const sameFile =
          destStats.ino === sourceStats.ino && destStats.dev === sourceStats.dev;
        // A case-only rename on a case-insensitive file system "finds" the
        // source itself at the destination; that is not an overwrite.
        // validatePath returns the existing (old-case) real path, so rename to
        // the requested name inside the same, already-validated directory.
        if (sameFile) {
          await fs.rename(
            validSourcePath,
            path.join(
              path.dirname(validDestPath),
              path.basename(parsed.data.destination)
            )
          );
          return {
            content: [
              {
                type: "text",
                text: `Successfully moved ${parsed.data.source} to ${parsed.data.destination}`,
              },
            ],
          };
        }
        throw new Error(
          `Destination already exists: ${parsed.data.destination}. ` +
            `move_file never overwrites; use file_operations with onConflict: "overwrite" to replace it.`
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
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
          `Invalid arguments for register_directory: ${parsed.error}`,
        );
      }

      const expandedPath = expandHome(parsed.data.path);
      const absolutePath = path.resolve(expandedPath);

      // Resolve links so the directory that is shown to the user and stored
      // in the allowed list is the one that will actually be accessed.
      let realPath: string;
      try {
        realPath = await fs.realpath(absolutePath);
        const stats = await fs.stat(realPath);
        if (!stats.isDirectory()) {
          throw new Error(`Path ${absolutePath} is not a directory`);
        }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "ENOTDIR") {
          throw new Error(`Directory ${absolutePath} does not exist`);
        }
        throw error;
      }
      const normalizedPath = normalizePath(realPath) || realPath;

      // Already accessible: nothing to widen, so no prompt is needed
      if (getAllowedDirectories().includes(normalizedPath)) {
        return {
          content: [
            {
              type: "text",
              text: `Directory already registered: ${parsed.data.path} (${normalizedPath})`,
            },
          ],
        };
      }
      if (await isPathCanonicallyAllowed(realPath, process.cwd())) {
        return {
          content: [
            {
              type: "text",
              text: `Directory already accessible: ${parsed.data.path} (${normalizedPath}) is inside an allowed directory`,
            },
          ],
        };
      }

      const policy = getRuntimeRegistrationPolicy();

      if (policy === "deny") {
        throw new Error(
          `Runtime directory registration is disabled on this server (--runtime-registration deny). ` +
            `To grant access to ${normalizedPath}, add it to --approved-folders in the MCP server configuration.`,
        );
      }

      if (policy !== "allow") {
        const sensitive = await describeSensitiveDirectory(realPath);
        if (sensitive) {
          throw new Error(
            `Refusing to register ${normalizedPath}: it is ${sensitive}. ` +
              `Register a more specific folder, add it to --approved-folders, ` +
              `or start the server with --runtime-registration allow.`,
          );
        }

        const consent = directoryRegistrationConsentHandler
          ? await directoryRegistrationConsentHandler(normalizedPath)
          : "unsupported";

        if (consent === "unsupported") {
          throw new Error(
            `Cannot register ${normalizedPath}: registering directories at runtime requires user confirmation, ` +
              `but this MCP client does not support confirmation prompts (MCP elicitation). ` +
              `Add the folder via --approved-folders, or start the server with --runtime-registration allow.`,
          );
        }
        if (consent !== "accepted") {
          throw new Error(`User declined access to ${normalizedPath}`);
        }
      }

      // Re-read: the list may have changed while waiting for the user
      const currentDirs = getAllowedDirectories();
      if (!currentDirs.includes(normalizedPath)) {
        setAllowedDirectories([...currentDirs, normalizedPath]);
      }
      return {
        content: [
          {
            type: "text",
            text: `Successfully registered directory: ${parsed.data.path} (${normalizedPath})`,
          },
        ],
      };
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
          `Invalid arguments for file_operations: ${parsed.error}`,
        );
      }

      // Phase 1: Path Validation
      const validationPromises = parsed.data.files.map(
        async (file: FileOperationsArgs["files"][number], index: number) => {
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
        },
      );

      const validatedFiles = await Promise.all(validationPromises);

      // Check for validation errors

      const validationErrors = validatedFiles.filter((f) => !f.success);

      if (validationErrors.length > 0) {
        const errorMessages = validationErrors

          .map(
            (f) =>
              `${f.source} → ${f.destination}: ${f.error || "Unknown error"}`,
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
        }),
      );

      // Handle conflicts based on strategy

      const filesToProcess = conflictChecks.filter((file) => {
        if (file.hasConflict) {
          switch (parsed.data.onConflict) {
            case "skip":
              return false;

            case "error":
              throw new Error(
                `Destination already exists: ${file.destination}`,
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
              // validSource is the realpath returned by validatePath, so a
              // top-level source that is itself a symlink/junction has already
              // been resolved and its real target checked against the allowed
              // directories. Links *inside* a copied directory are refused by
              // copyDirectoryRecursive.
              const stats = await fs.stat(file.validSource!);

              if (stats.isDirectory()) {
                await copyDirectoryRecursive(
                  file.validSource!,

                  file.validDest!,
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
        },
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
          "No valid paths to delete - all paths either don't exist or failed validation",
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

// Helpers for recursive directory copying
//
// Security (VFO-09): fs.copyFile follows symbolic links, so copying a link
// found inside a directory would copy the link TARGET's contents (possibly
// from outside the allowed directories) into the sandbox. The whole source
// tree is therefore checked for links before anything is copied, and links
// (file or directory symlinks, Windows junctions) are refused, never followed.

interface DirectoryCopyEntry {
  relativePath: string;
  type: "directory" | "file";
}

function symlinkCopyError(entryPath: string): Error {
  return new Error(
    `Refusing to copy symbolic link inside directory: ${entryPath} ` +
      `(symbolic links are not copied for security reasons)`,
  );
}

async function collectDirectoryCopyPlan(
  root: string,
  relativeDir = "",
  plan: DirectoryCopyEntry[] = [],
): Promise<DirectoryCopyEntry[]> {
  const entries = await fs.readdir(path.join(root, relativeDir), {
    withFileTypes: true,
  });

  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);
    const entryPath = path.join(root, relativePath);
    // lstat never follows links; Node reports junctions as symbolic links too
    const stats = await fs.lstat(entryPath);

    if (entry.isSymbolicLink() || stats.isSymbolicLink()) {
      throw symlinkCopyError(entryPath);
    }
    if (stats.isDirectory()) {
      plan.push({ relativePath, type: "directory" });
      await collectDirectoryCopyPlan(root, relativePath, plan);
    } else if (stats.isFile()) {
      plan.push({ relativePath, type: "file" });
    } else {
      throw new Error(
        `Refusing to copy special file inside directory: ${entryPath} ` +
          `(only regular files and directories are copied)`,
      );
    }
  }

  return plan;
}

async function copyDirectoryRecursive(
  source: string,
  destination: string,
): Promise<void> {
  const relativeDest = path.relative(source, destination);
  if (
    relativeDest === "" ||
    (!relativeDest.startsWith("..") && !path.isAbsolute(relativeDest))
  ) {
    throw new Error(
      `Cannot copy a directory into itself: ${source} to ${destination}`,
    );
  }

  // Validate the entire source tree before creating or copying anything
  const plan = await collectDirectoryCopyPlan(source);

  // Destination directories are created segment by segment with their
  // realpath re-checked, so an existing link at the destination cannot
  // redirect the copy outside the allowed directories.
  await ensureDirectoryWithinAllowed(destination);

  for (const entry of plan) {
    const sourcePath = path.join(source, entry.relativePath);
    const destPath = path.join(destination, entry.relativePath);

    if (entry.type === "directory") {
      await ensureDirectoryWithinAllowed(destPath);
      continue;
    }

    // Re-check the source right before copying in case it was swapped for a
    // link after the tree was validated.
    const sourceStats = await fs.lstat(sourcePath);
    if (sourceStats.isSymbolicLink() || !sourceStats.isFile()) {
      throw symlinkCopyError(sourcePath);
    }

    // Never write through an existing link at the destination
    let destIsLink = false;
    try {
      destIsLink = (await fs.lstat(destPath)).isSymbolicLink();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    if (destIsLink) {
      throw new Error(
        `Refusing to overwrite symbolic link at destination: ${destPath}`,
      );
    }

    await fs.copyFile(sourcePath, destPath);
  }
}

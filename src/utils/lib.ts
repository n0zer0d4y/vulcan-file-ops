import fs from "fs/promises";
import path from "path";
import os from "os";
import { randomBytes } from "crypto";
import { diffLines, createTwoFilesPatch } from "diff";
import { minimatch } from "minimatch";
import { normalizePath, expandHome } from "./path-utils.js";
import { isPathWithinAllowedDirectories } from "./path-validation.js";

// Global configuration - set by the main module
let allowedDirectories: string[] = [];
let ignoredFolders: string[] = [];
let enabledTools: string[] = [];

// Function to set allowed directories from the main module
export function setAllowedDirectories(directories: string[]): void {
  allowedDirectories = [...directories];
}

// Function to get current allowed directories
export function getAllowedDirectories(): string[] {
  return [...allowedDirectories];
}

// Function to set ignored folders from the main module
export function setIgnoredFolders(folders: string[]): void {
  ignoredFolders = [...folders];
}

// Function to get current ignored folders
export function getIgnoredFolders(): string[] {
  return [...ignoredFolders];
}

// Function to set enabled tools from the main module
export function setEnabledTools(tools: string[]): void {
  enabledTools = [...tools];
}

// Function to get current enabled tools
export function getEnabledTools(): string[] {
  return [...enabledTools];
}

// Function to check if a folder should be ignored
export function shouldIgnoreFolder(folderName: string): boolean {
  if (ignoredFolders.length === 0) {
    return false;
  }

  // Check exact matches first
  if (ignoredFolders.includes(folderName)) {
    return true;
  }

  // Check glob patterns
  return ignoredFolders.some((pattern) => {
    try {
      return minimatch(folderName, pattern);
    } catch (error) {
      // If pattern is invalid, log warning but don't ignore
      console.warn(`Invalid ignore pattern: ${pattern}`);
      return false;
    }
  });
}

// Type definitions
interface FileInfo {
  size: number;
  created: Date;
  modified: Date;
  accessed: Date;
  isDirectory: boolean;
  isFile: boolean;
  permissions: string;
}

export interface SearchOptions {
  excludePatterns?: string[];
}

export interface SearchResult {
  path: string;
  isDirectory: boolean;
}

// Grep interfaces and types
export interface GrepOptions {
  caseInsensitive?: boolean;
  contextBefore?: number;
  contextAfter?: number;
  outputMode?: "content" | "files_with_matches" | "count";
  headLimit?: number;
  multiline?: boolean;
  fileType?: string;
  globPattern?: string;
}

export interface GrepMatch {
  file: string;
  line: number;
  content: string;
  contextBefore?: string[];
  contextAfter?: string[];
}

export interface GrepResult {
  mode: "content" | "files_with_matches" | "count";
  matches?: GrepMatch[];
  files?: string[];
  counts?: Map<string, number>;
  totalMatches: number;
  filesSearched: number;
}

// File type extensions mapping (ripgrep-compatible)
const FILE_TYPE_EXTENSIONS: Record<string, string[]> = {
  js: [".js", ".jsx", ".mjs", ".cjs"],
  ts: [".ts", ".tsx", ".mts", ".cts"],
  py: [".py", ".pyi", ".pyw"],
  rust: [".rs"],
  go: [".go"],
  java: [".java"],
  cpp: [".cpp", ".cc", ".cxx", ".hpp", ".h", ".hxx"],
  c: [".c", ".h"],
  rb: [".rb"],
  php: [".php"],
  css: [".css", ".scss", ".sass", ".less"],
  html: [".html", ".htm"],
  json: [".json"],
  yaml: [".yaml", ".yml"],
  xml: [".xml"],
  md: [".md", ".markdown"],
  sql: [".sql"],
  sh: [".sh", ".bash"],
};

function getExtensionsForType(type: string): string[] {
  return FILE_TYPE_EXTENSIONS[type.toLowerCase()] || [];
}

// Pure Utility Functions
export function formatSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  if (bytes === 0) return "0 B";

  const i = Math.floor(Math.log(bytes) / Math.log(1024));

  if (i < 0 || i === 0) return `${bytes} ${units[0]}`;

  const unitIndex = Math.min(i, units.length - 1);
  return `${(bytes / Math.pow(1024, unitIndex)).toFixed(2)} ${
    units[unitIndex]
  }`;
}

export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

export function createUnifiedDiff(
  originalContent: string,
  newContent: string,
  filepath: string = "file"
): string {
  // Ensure consistent line endings for diff
  const normalizedOriginal = normalizeLineEndings(originalContent);
  const normalizedNew = normalizeLineEndings(newContent);

  return createTwoFilesPatch(
    filepath,
    filepath,
    normalizedOriginal,
    normalizedNew,
    "original",
    "modified"
  );
}

// Security & Validation Functions
export async function validatePath(requestedPath: string): Promise<string> {
  const expandedPath = expandHome(requestedPath);
  const absolute = path.isAbsolute(expandedPath)
    ? path.resolve(expandedPath)
    : path.resolve(process.cwd(), expandedPath);

  const normalizedRequested = normalizePath(absolute);

  // Security: Check if path is within allowed directories before any file operations
  const isAllowed = isPathWithinAllowedDirectories(
    normalizedRequested,
    allowedDirectories
  );
  if (!isAllowed) {
    throw new Error(
      `Access denied - path outside allowed directories: ${absolute} not in ${allowedDirectories.join(
        ", "
      )}`
    );
  }

  // Security: Handle symlinks by checking their real path to prevent symlink attacks
  // This prevents attackers from creating symlinks that point outside allowed directories
  try {
    const realPath = await fs.realpath(absolute);
    const normalizedReal = normalizePath(realPath);
    if (!isPathWithinAllowedDirectories(normalizedReal, allowedDirectories)) {
      throw new Error(
        `Access denied - symlink target outside allowed directories: ${realPath} not in ${allowedDirectories.join(
          ", "
        )}`
      );
    }
    return realPath;
  } catch (error) {
    // Security: For new files that don't exist yet, verify parent directory
    // This ensures we can't create files in unauthorized locations
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const parentDir = path.dirname(absolute);
      try {
        const realParentPath = await fs.realpath(parentDir);
        const normalizedParent = normalizePath(realParentPath);
        if (
          !isPathWithinAllowedDirectories(normalizedParent, allowedDirectories)
        ) {
          throw new Error(
            `Access denied - parent directory outside allowed directories: ${realParentPath} not in ${allowedDirectories.join(
              ", "
            )}`
          );
        }
        return absolute;
      } catch {
        throw new Error(`Parent directory does not exist: ${parentDir}`);
      }
    }
    throw error;
  }
}

// File Operations
export async function getFileStats(filePath: string): Promise<FileInfo> {
  const stats = await fs.stat(filePath);
  return {
    size: stats.size,
    created: stats.birthtime,
    modified: stats.mtime,
    accessed: stats.atime,
    isDirectory: stats.isDirectory(),
    isFile: stats.isFile(),
    permissions: stats.mode.toString(8).slice(-3),
  };
}

export async function readFileContent(
  filePath: string,
  encoding: string = "utf-8"
): Promise<string> {
  return await fs.readFile(filePath, encoding as BufferEncoding);
}

export async function writeFileContent(
  filePath: string,
  content: string
): Promise<void> {
  try {
    // Security: 'wx' flag ensures exclusive creation - fails if file/symlink exists,
    // preventing writes through pre-existing symlinks
    await fs.writeFile(filePath, content, { encoding: "utf-8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      // Security: Use atomic rename to prevent race conditions where symlinks
      // could be created between validation and write. Rename operations
      // replace the target file atomically and don't follow symlinks.
      const tempPath = `${filePath}.${randomBytes(16).toString("hex")}.tmp`;
      try {
        await fs.writeFile(tempPath, content, "utf-8");
        await fs.rename(tempPath, filePath);
      } catch (renameError) {
        try {
          await fs.unlink(tempPath);
        } catch {}
        throw renameError;
      }
    } else {
      throw error;
    }
  }
}

// File Editing Functions
export interface FileEdit {
  oldText: string;
  newText: string;
}

export async function applyFileEdits(
  filePath: string,
  edits: FileEdit[],
  dryRun: boolean = false
): Promise<string> {
  // Read file content and normalize line endings
  const content = normalizeLineEndings(await fs.readFile(filePath, "utf-8"));

  // Apply edits sequentially
  let modifiedContent = content;
  for (const edit of edits) {
    const normalizedOld = normalizeLineEndings(edit.oldText);
    const normalizedNew = normalizeLineEndings(edit.newText);

    // If exact match exists, use it
    if (modifiedContent.includes(normalizedOld)) {
      modifiedContent = modifiedContent.replace(normalizedOld, normalizedNew);
      continue;
    }

    // Otherwise, try line-by-line matching with flexibility for whitespace
    const oldLines = normalizedOld.split("\n");
    const contentLines = modifiedContent.split("\n");
    let matchFound = false;

    for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
      const potentialMatch = contentLines.slice(i, i + oldLines.length);

      // Compare lines with normalized whitespace
      const isMatch = oldLines.every((oldLine, j) => {
        const contentLine = potentialMatch[j];
        return oldLine.trim() === contentLine.trim();
      });

      if (isMatch) {
        // Preserve original indentation of first line
        const originalIndent = contentLines[i].match(/^\s*/)?.[0] || "";
        const newLines = normalizedNew.split("\n").map((line, j) => {
          if (j === 0) return originalIndent + line.trimStart();
          // For subsequent lines, try to preserve relative indentation
          const oldIndent = oldLines[j]?.match(/^\s*/)?.[0] || "";
          const newIndent = line.match(/^\s*/)?.[0] || "";
          if (oldIndent && newIndent) {
            const relativeIndent = newIndent.length - oldIndent.length;
            return (
              originalIndent +
              " ".repeat(Math.max(0, relativeIndent)) +
              line.trimStart()
            );
          }
          return line;
        });

        contentLines.splice(i, oldLines.length, ...newLines);
        modifiedContent = contentLines.join("\n");
        matchFound = true;
        break;
      }
    }

    if (!matchFound) {
      throw new Error(`Could not find exact match for edit:\n${edit.oldText}`);
    }
  }

  // Create unified diff
  const diff = createUnifiedDiff(content, modifiedContent, filePath);

  // Format diff with appropriate number of backticks
  let numBackticks = 3;
  while (diff.includes("`".repeat(numBackticks))) {
    numBackticks++;
  }
  const formattedDiff = `${"`".repeat(numBackticks)}diff\n${diff}${"`".repeat(
    numBackticks
  )}\n\n`;

  if (!dryRun) {
    // Security: Use atomic rename to prevent race conditions where symlinks
    // could be created between validation and write. Rename operations
    // replace the target file atomically and don't follow symlinks.
    const tempPath = `${filePath}.${randomBytes(16).toString("hex")}.tmp`;
    try {
      await fs.writeFile(tempPath, modifiedContent, "utf-8");
      await fs.rename(tempPath, filePath);
    } catch (error) {
      try {
        await fs.unlink(tempPath);
      } catch {}
      throw error;
    }
  }

  return formattedDiff;
}

// Memory-efficient implementation to get the last N lines of a file
export async function tailFile(
  filePath: string,
  numLines: number
): Promise<string> {
  const CHUNK_SIZE = 1024; // Read 1KB at a time
  const stats = await fs.stat(filePath);
  const fileSize = stats.size;

  if (fileSize === 0) return "";

  // Open file for reading
  const fileHandle = await fs.open(filePath, "r");
  try {
    const lines: string[] = [];
    let position = fileSize;
    let chunk = Buffer.alloc(CHUNK_SIZE);
    let linesFound = 0;
    let remainingText = "";

    // Read chunks from the end of the file until we have enough lines
    while (position > 0 && linesFound < numLines) {
      const size = Math.min(CHUNK_SIZE, position);
      position -= size;

      const { bytesRead } = await fileHandle.read(chunk, 0, size, position);
      if (!bytesRead) break;

      // Get the chunk as a string and prepend any remaining text from previous iteration
      const readData = chunk.slice(0, bytesRead).toString("utf-8");
      const chunkText = readData + remainingText;

      // Split by newlines and count
      const chunkLines = normalizeLineEndings(chunkText).split("\n");

      // If this isn't the end of the file, the first line is likely incomplete
      // Save it to prepend to the next chunk
      if (position > 0) {
        remainingText = chunkLines[0];
        chunkLines.shift(); // Remove the first (incomplete) line
      }

      // Add lines to our result (up to the number we need)
      for (
        let i = chunkLines.length - 1;
        i >= 0 && linesFound < numLines;
        i--
      ) {
        lines.unshift(chunkLines[i]);
        linesFound++;
      }
    }

    return lines.join("\n");
  } finally {
    await fileHandle.close();
  }
}

// New function to get the first N lines of a file
export async function headFile(
  filePath: string,
  numLines: number
): Promise<string> {
  const fileHandle = await fs.open(filePath, "r");
  try {
    const lines: string[] = [];
    let buffer = "";
    let bytesRead = 0;
    const chunk = Buffer.alloc(1024); // 1KB buffer

    // Read chunks and count lines until we have enough or reach EOF
    while (lines.length < numLines) {
      const result = await fileHandle.read(chunk, 0, chunk.length, bytesRead);
      if (result.bytesRead === 0) break; // End of file
      bytesRead += result.bytesRead;
      buffer += chunk.slice(0, result.bytesRead).toString("utf-8");

      const newLineIndex = buffer.lastIndexOf("\n");
      if (newLineIndex !== -1) {
        const completeLines = buffer.slice(0, newLineIndex).split("\n");
        buffer = buffer.slice(newLineIndex + 1);
        for (const line of completeLines) {
          lines.push(line);
          if (lines.length >= numLines) break;
        }
      }
    }

    // If there is leftover content and we still need lines, add it
    if (buffer.length > 0 && lines.length < numLines) {
      lines.push(buffer);
    }

    return lines.join("\n");
  } finally {
    await fileHandle.close();
  }
}

export async function searchFilesWithValidation(
  rootPath: string,
  pattern: string,
  allowedDirectories: string[],
  options: SearchOptions = {}
): Promise<string[]> {
  const { excludePatterns = [] } = options;
  const results: string[] = [];

  // Check if pattern requires recursive search (contains ** or has path separators)
  const needsRecursion =
    pattern.includes("**") || pattern.includes("/") || pattern.includes("\\");

  async function search(currentPath: string, currentDepth: number = 0) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      try {
        await validatePath(fullPath);

        const relativePath = path.relative(rootPath, fullPath);
        const shouldExclude = excludePatterns.some((excludePattern) =>
          minimatch(relativePath, excludePattern, { dot: true })
        );

        if (shouldExclude) continue;

        // Use glob matching for the search pattern
        if (minimatch(relativePath, pattern, { dot: true })) {
          results.push(fullPath);
        }

        // Only recurse if pattern requires it and we're not too deep
        // Limit recursion depth to prevent infinite loops or excessive searching
        if (entry.isDirectory() && needsRecursion && currentDepth < 10) {
          await search(fullPath, currentDepth + 1);
        }
      } catch {
        continue;
      }
    }
  }

  await search(rootPath);
  return results;
}

export async function grepFilesWithValidation(
  pattern: string,
  searchPath: string,
  allowedDirectories: string[],
  options: GrepOptions = {}
): Promise<GrepResult> {
  const {
    caseInsensitive = false,
    contextBefore = 0,
    contextAfter = 0,
    outputMode = "content",
    headLimit,
    multiline = false,
    fileType,
    globPattern,
  } = options;

  // Create regex with appropriate flags (no 'g' flag to avoid stateful matching)
  const flags = caseInsensitive ? "i" : "";
  const dotAllFlag = multiline ? "s" : "";
  let regex: RegExp;

  try {
    regex = new RegExp(pattern, flags + dotAllFlag);
  } catch (error) {
    throw new Error(
      `Invalid regex pattern: ${pattern} - ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  const result: GrepResult = {
    mode: outputMode,
    matches: outputMode === "content" ? [] : undefined,
    files: outputMode === "files_with_matches" ? [] : undefined,
    counts: outputMode === "count" ? new Map() : undefined,
    totalMatches: 0,
    filesSearched: 0,
  };

  // Determine if we need to search recursively
  const stats = await fs.stat(searchPath);
  const isDirectory = stats.isDirectory();

  async function searchFile(filePath: string): Promise<void> {
    // Validate path against allowed directories
    try {
      await validatePath(filePath);
    } catch {
      return; // Skip files outside allowed directories
    }

    // Apply file type filter
    if (fileType) {
      const extensions = getExtensionsForType(fileType);
      if (extensions.length > 0) {
        const ext = path.extname(filePath).toLowerCase();
        if (!extensions.includes(ext)) {
          return; // Skip files that don't match type
        }
      }
    }

    // Apply glob filter
    if (globPattern) {
      const relativePath = path.relative(searchPath, filePath);
      if (!minimatch(relativePath, globPattern, { dot: true })) {
        return; // Skip files that don't match glob
      }
    }

    // Check file size (limit to 100MB to prevent memory issues)
    const MAX_FILE_SIZE = 100 * 1024 * 1024;
    try {
      const fileStats = await fs.stat(filePath);
      if (fileStats.size > MAX_FILE_SIZE) {
        console.warn(
          `Skipping large file: ${filePath} (${formatSize(fileStats.size)})`
        );
        return;
      }
    } catch {
      return; // Skip if can't stat
    }

    result.filesSearched++;

    try {
      const content = await fs.readFile(filePath, "utf-8");
      let fileMatchCount = 0;
      let fileHasMatch = false;

      if (multiline) {
        // For multiline mode, search the entire content
        const matches = content.match(new RegExp(pattern, flags + "g"));
        if (matches) {
          fileHasMatch = true;
          fileMatchCount = matches.length;
          result.totalMatches += matches.length;

          if (outputMode === "content") {
            // For multiline, we'll split by lines and find which lines have matches
            const lines = normalizeLineEndings(content).split("\n");
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              if (regex.test(line)) {
                if (headLimit && result.matches!.length >= headLimit) {
                  break;
                }

                const match: GrepMatch = {
                  file: filePath,
                  line: i + 1,
                  content: line,
                };

                // Add context lines if requested
                if (contextBefore > 0) {
                  match.contextBefore = [];
                  for (let j = Math.max(0, i - contextBefore); j < i; j++) {
                    match.contextBefore.push(lines[j]);
                  }
                }

                if (contextAfter > 0) {
                  match.contextAfter = [];
                  for (
                    let j = i + 1;
                    j < Math.min(lines.length, i + 1 + contextAfter);
                    j++
                  ) {
                    match.contextAfter.push(lines[j]);
                  }
                }

                result.matches!.push(match);
              }
            }
          }
        }
      } else {
        // For single-line mode, search line by line
        const lines = normalizeLineEndings(content).split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];

          if (regex.test(line)) {
            fileHasMatch = true;
            fileMatchCount++;
            result.totalMatches++;

            // Handle different output modes
            if (outputMode === "content") {
              // Check head limit for content mode
              if (headLimit && result.matches!.length >= headLimit) {
                break; // Stop processing this file
              }

              const match: GrepMatch = {
                file: filePath,
                line: i + 1,
                content: line,
              };

              // Add context lines if requested
              if (contextBefore > 0) {
                match.contextBefore = [];
                for (let j = Math.max(0, i - contextBefore); j < i; j++) {
                  match.contextBefore.push(lines[j]);
                }
              }

              if (contextAfter > 0) {
                match.contextAfter = [];
                for (
                  let j = i + 1;
                  j < Math.min(lines.length, i + 1 + contextAfter);
                  j++
                ) {
                  match.contextAfter.push(lines[j]);
                }
              }

              result.matches!.push(match);
            }
          }
        }
      }

      // Handle files_with_matches mode
      if (outputMode === "files_with_matches" && fileHasMatch) {
        if (!headLimit || result.files!.length < headLimit) {
          result.files!.push(filePath);
        }
      }

      // Handle count mode
      if (outputMode === "count" && fileMatchCount > 0) {
        result.counts!.set(filePath, fileMatchCount);
      }
    } catch (error) {
      // Skip binary files or files we can't read
      return;
    }
  }

  async function searchDirectory(
    dirPath: string,
    depth: number = 0
  ): Promise<void> {
    // Limit recursion depth
    if (depth > 10) return;

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        // Skip ignored folders
        if (entry.isDirectory() && shouldIgnoreFolder(entry.name)) {
          continue;
        }

        if (entry.isDirectory()) {
          await searchDirectory(fullPath, depth + 1);
        } else if (entry.isFile()) {
          await searchFile(fullPath);

          // Check global head limit
          if (headLimit) {
            if (
              outputMode === "content" &&
              result.matches!.length >= headLimit
            ) {
              return; // Stop searching
            }
            if (
              outputMode === "files_with_matches" &&
              result.files!.length >= headLimit
            ) {
              return;
            }
          }
        }
      }
    } catch {
      // Skip directories we can't read
      return;
    }
  }

  // Execute search
  if (isDirectory) {
    await searchDirectory(searchPath);
  } else {
    await searchFile(searchPath);
  }

  return result;
}

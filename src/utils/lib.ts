import fs from "fs/promises";
import path from "path";
import os from "os";
import { randomBytes } from "crypto";
import { diffLines, createTwoFilesPatch } from "diff";
import { minimatch } from "minimatch";
import { normalizePath, expandHome } from "./path-utils.js";
import { isPathWithinAllowedDirectories } from "./path-validation.js";
import {
  RegexEvaluationSession,
  RegexEvaluationError,
  DEFAULT_GREP_REGEX_FILE_TIMEOUT_MS,
  DEFAULT_GREP_REGEX_TOTAL_TIMEOUT_MS,
} from "./regex-worker.js";
import { MAX_TEXT_READ_BYTES } from "./limits.js";

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
  /**
   * Per-file regex evaluation budget in ms (default
   * DEFAULT_GREP_REGEX_FILE_TIMEOUT_MS). Not exposed through the tool schema.
   */
  regexFileTimeoutMs?: number;
  /**
   * Cumulative regex evaluation budget for the whole call in ms (default
   * DEFAULT_GREP_REGEX_TOTAL_TIMEOUT_MS). Not exposed through the tool schema.
   */
  regexTotalTimeoutMs?: number;
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

export function detectLineEnding(content: string): "\r\n" | "\n" {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

// Calculate diff statistics
function calculateDiffStats(
  original: string,
  modified: string,
): {
  added: number;
  removed: number;
  modified: number;
} {
  const originalLines = original.split("\n");
  const modifiedLines = modified.split("\n");

  let added = 0;
  let removed = 0;

  if (modifiedLines.length > originalLines.length) {
    added = modifiedLines.length - originalLines.length;
  } else if (originalLines.length > modifiedLines.length) {
    removed = originalLines.length - modifiedLines.length;
  }

  // Count modified lines (lines that exist in both but are different)
  const minLength = Math.min(originalLines.length, modifiedLines.length);
  let modifiedCount = 0;
  for (let i = 0; i < minLength; i++) {
    if (originalLines[i] !== modifiedLines[i]) {
      modifiedCount++;
    }
  }

  return { added, removed, modified: modifiedCount };
}

// Format detailed diff output with edit summaries
function formatDetailedDiff(
  original: string,
  modified: string,
  filePath: string,
  results: MatchResult[],
): string {
  let output = "";

  // Edit Summary
  if (results.length > 0) {
    output += "Edit Summary:\n";
    results.forEach((result, idx) => {
      const editNum = results.length > 1 ? ` ${idx + 1}` : "";
      output += `  Edit${editNum}:\n`;
      output += `    Strategy: ${result.strategy}`;

      // Add strategy description for non-exact matches
      if (result.strategy === "flexible") {
        output += " (whitespace-insensitive)";
      } else if (result.strategy === "fuzzy") {
        output += " (token-based pattern matching)";
      }
      output += "\n";

      output += `    ${result.message}\n`;

      if (result.lineRange) {
        const lineDesc =
          result.lineRange.start === result.lineRange.end
            ? `line ${result.lineRange.start}`
            : `lines ${result.lineRange.start}-${result.lineRange.end}`;
        output += `    Location: ${lineDesc}\n`;
      }

      if (result.warning) {
        output += `    ⚠️  Warning: ${result.warning}\n`;
      }

      if (result.ambiguity) {
        output += `    ⚠️  Multiple matches found at ${result.ambiguity.locations}\n`;
        output += `        Replaced first occurrence only\n`;
        output += `        ${result.ambiguity.suggestion}\n`;
      }
    });
    output += "\n";
  }

  // Diff Statistics
  const stats = calculateDiffStats(original, modified);
  const totalChanges = stats.added + stats.removed + stats.modified;

  if (totalChanges > 0) {
    output += "Diff Statistics:\n";
    if (stats.added > 0) {
      output += `  +${stats.added} line${stats.added !== 1 ? "s" : ""} added\n`;
    }
    if (stats.removed > 0) {
      output += `  -${stats.removed} line${
        stats.removed !== 1 ? "s" : ""
      } removed\n`;
    }
    if (stats.modified > 0) {
      output += `  ~${stats.modified} line${
        stats.modified !== 1 ? "s" : ""
      } modified\n`;
    }
    output += `  Total: ${totalChanges} line${
      totalChanges !== 1 ? "s" : ""
    } changed\n\n`;
  }

  // Unified Diff
  const diff = createUnifiedDiff(original, modified, filePath);
  output += diff;

  // Notes
  const usedNonExact = results.some((r) => r.strategy !== "exact");
  const hasWarnings = results.some((r) => r.warning);

  if (usedNonExact || hasWarnings) {
    output += "\n\n";
    if (usedNonExact) {
      output +=
        "📝 Note: Non-exact matching strategies were used. Changes were applied successfully.\n";
    }
    if (hasWarnings) {
      output +=
        "⚠️  Please review the changes carefully to ensure they match your intentions.\n";
    }
  }

  return output;
}

export function createUnifiedDiff(
  originalContent: string,
  newContent: string,
  filepath: string = "file",
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
    "modified",
  );
}

// Security & Validation Functions
export interface ValidatePathOptions {
  /**
   * When true, validatePath will attempt to create any missing parent
   * directories for the requested path, as long as they are within
   * the configured allowedDirectories.
   *
   * This is intended for write operations only. Read/search tools
   * should use the default behavior (no directory creation).
   */
  createParentIfMissing?: boolean;
}

async function ensureParentDirectoryExists(
  absolutePath: string,
): Promise<void> {
  const parentDir = path.dirname(absolutePath);

  // Fast path: if parentDir already exists, let the existing logic handle it
  try {
    const realParentPath = await fs.realpath(parentDir);
    const normalizedParent = normalizePath(realParentPath);
    if (!isPathWithinAllowedDirectories(normalizedParent, allowedDirectories)) {
      throw new Error(
        `Access denied - parent directory outside allowed directories: ${realParentPath} not in ${allowedDirectories.join(
          ", ",
        )}`,
      );
    }
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      // If it's not a "does not exist" error, rethrow and let validatePath handle it
      throw error;
    }
  }

  // Parent (or some ancestor) does not exist - we may need to create it.
  // Security: We only create directories if the final requested path is
  // within allowedDirectories (checked in validatePath before calling this),
  // and we validate each created directory as we go.
  const segments: string[] = [];
  let current = parentDir;

  // Walk up until we find an existing ancestor or hit filesystem root
  // Note: We don't trust dirname("/") to progress forever; stop when stable.
  while (true) {
    segments.push(current);
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    try {
      await fs.lstat(current);
      break; // Found an existing path
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        current = parent;
        continue;
      }
      throw error;
    }
  }

  // We collected segments from leaf up to the first existing ancestor/root.
  // Create them from top-most missing down to the immediate parentDir.
  for (let i = segments.length - 1; i >= 0; i--) {
    const dir = segments[i];

    // Normalize and check allowedDirectories before creating
    const normalizedDir = normalizePath(dir);
    if (!isPathWithinAllowedDirectories(normalizedDir, allowedDirectories)) {
      throw new Error(
        `Access denied - cannot create directory outside allowed directories: ${dir} not in ${allowedDirectories.join(
          ", ",
        )}`,
      );
    }

    try {
      await fs.mkdir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        // Something already exists at this path; verify it's a directory
        const stats = await fs.lstat(dir);
        if (!stats.isDirectory()) {
          throw new Error(
            `Cannot create directory; path exists and is not a directory: ${dir}`,
          );
        }
        continue;
      }
      throw error;
    }

    // After creation, resolve real path and ensure it is still within allowed directories
    const realCreatedPath = await fs.realpath(dir);
    const normalizedCreated = normalizePath(realCreatedPath);
    if (
      !isPathWithinAllowedDirectories(normalizedCreated, allowedDirectories)
    ) {
      throw new Error(
        `Access denied - created directory symlink target outside allowed directories: ${realCreatedPath} not in ${allowedDirectories.join(
          ", ",
        )}`,
      );
    }
  }
}

export async function validatePath(
  requestedPath: string,
  options?: ValidatePathOptions,
): Promise<string> {
  const expandedPath = expandHome(requestedPath);
  const absolute = path.isAbsolute(expandedPath)
    ? path.resolve(expandedPath)
    : path.resolve(process.cwd(), expandedPath);

  const normalizedRequested = normalizePath(absolute);

  // Security: Check if path is within allowed directories before any file operations
  const isAllowed = isPathWithinAllowedDirectories(
    normalizedRequested,
    allowedDirectories,
  );
  if (!isAllowed) {
    throw new Error(
      `Access denied - path outside allowed directories: ${absolute} not in ${allowedDirectories.join(
        ", ",
      )}`,
    );
  }

  const createParentIfMissing = options?.createParentIfMissing === true;

  // Security: Handle symlinks by checking their real path to prevent symlink attacks
  // This prevents attackers from creating symlinks that point outside allowed directories
  try {
    const realPath = await fs.realpath(absolute);
    const normalizedReal = normalizePath(realPath);
    if (!isPathWithinAllowedDirectories(normalizedReal, allowedDirectories)) {
      throw new Error(
        `Access denied - symlink target outside allowed directories: ${realPath} not in ${allowedDirectories.join(
          ", ",
        )}`,
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
              ", ",
            )}`,
          );
        }
        return absolute;
      } catch (parentError) {
        // Only a missing parent is "does not exist"; an access-denied result
        // (e.g. the parent resolves outside the allowed directories) must keep
        // its own message instead of being reported as missing.
        if (!isNotFoundError(parentError)) {
          throw parentError;
        }
        if (!createParentIfMissing) {
          throw new Error(`Parent directory does not exist: ${parentDir}`);
        }

        // Attempt to securely create the missing parent directory chain
        await ensureParentDirectoryExists(absolute);
        // After creation, return the absolute path for the new file. We intentionally
        // do not call fs.realpath on the file itself here, because it still may not
        // exist yet (for new files).
        return absolute;
      }
    }
    throw error;
  }
}

// Canonical containment helpers
//
// isPathWithinAllowedDirectories() is a purely lexical check. Paths that are
// handed to something other than Node's fs (e.g. a shell command line) or that
// are created with mkdir must also be checked after symlink resolution.

function isNotFoundError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/**
 * Lexical normalization first, then realpath of the nearest existing ancestor
 * with the non-existent remainder re-appended. Matches Win32 and Node fs
 * semantics, where ".." is collapsed before symlinks are followed.
 */
export async function resolveLexicalCanonicalPath(
  absolutePath: string,
): Promise<string> {
  const resolved = path.resolve(absolutePath);
  const tail: string[] = [];
  let current = resolved;

  while (true) {
    try {
      const real = await fs.realpath(current);
      return tail.length > 0 ? path.join(real, ...tail.reverse()) : real;
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        return resolved;
      }
      tail.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Component-by-component resolution that follows symlinks before applying
 * "..", matching how a POSIX kernel resolves the path a shell passes to it.
 * On Windows this is stricter than the OS (which collapses ".." first), which
 * only ever produces extra denials, never extra access.
 */
export async function resolvePhysicalCanonicalPath(
  inputPath: string,
  baseDir: string,
): Promise<string> {
  const absolute = path.isAbsolute(inputPath)
    ? inputPath
    : `${baseDir}${path.sep}${inputPath}`;
  const rawRoot = path.parse(absolute).root;
  const root = path.parse(path.resolve(absolute)).root;
  const separator = path.sep === "\\" ? /[\\/]+/ : /\/+/;
  const components = absolute.slice(rawRoot.length).split(separator);

  let current = root;
  for (const component of components) {
    if (!component || component === ".") {
      continue;
    }
    if (component === "..") {
      current = path.dirname(current);
      continue;
    }
    const next = path.join(current, component);
    try {
      current = await fs.realpath(next);
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
      current = next;
    }
  }
  return current;
}

/**
 * True only if the path is inside the allowed directories lexically, after
 * lexical-then-realpath resolution, and after physical resolution. Relative
 * paths are resolved against baseDir. Any resolution error denies access.
 */
export async function isPathCanonicallyAllowed(
  inputPath: string,
  baseDir: string,
): Promise<boolean> {
  const allowed = getAllowedDirectories();
  if (allowed.length === 0 || !inputPath || inputPath.includes("\x00")) {
    return false;
  }

  try {
    const absolute = path.isAbsolute(inputPath)
      ? path.resolve(inputPath)
      : path.resolve(baseDir, inputPath);
    if (!isPathWithinAllowedDirectories(normalizePath(absolute), allowed)) {
      return false;
    }

    const lexical = await resolveLexicalCanonicalPath(absolute);
    if (!isPathWithinAllowedDirectories(normalizePath(lexical), allowed)) {
      return false;
    }

    const physical = await resolvePhysicalCanonicalPath(inputPath, baseDir);
    return isPathWithinAllowedDirectories(normalizePath(physical), allowed);
  } catch {
    return false;
  }
}

/**
 * Create a directory (and any missing ancestors) only inside the allowed
 * directories. Every directory created is re-checked with realpath so a
 * symlink or junction swapped into the chain cannot redirect creation.
 * Returns the real path of the directory.
 */
export async function ensureDirectoryWithinAllowed(
  dirPath: string,
): Promise<string> {
  const absolute = path.resolve(expandHome(dirPath));
  const allowed = getAllowedDirectories();

  if (!(await isPathCanonicallyAllowed(absolute, process.cwd()))) {
    throw new Error(
      `Access denied - path outside allowed directories: ${absolute} not in ${allowed.join(", ")}`,
    );
  }

  const missing: string[] = [];
  let current = absolute;
  while (true) {
    try {
      await fs.lstat(current);
      break;
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
      missing.push(current);
      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
  }

  for (const dir of missing.reverse()) {
    try {
      await fs.mkdir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }
    const realCreated = await fs.realpath(dir);
    if (
      !isPathWithinAllowedDirectories(
        normalizePath(realCreated),
        getAllowedDirectories(),
      )
    ) {
      throw new Error(
        `Access denied - directory resolves outside allowed directories: ${realCreated}`,
      );
    }
  }

  const realFinal = await fs.realpath(absolute);
  if (
    !isPathWithinAllowedDirectories(
      normalizePath(realFinal),
      getAllowedDirectories(),
    )
  ) {
    throw new Error(
      `Access denied - directory resolves outside allowed directories: ${realFinal}`,
    );
  }
  const stats = await fs.stat(realFinal);
  if (!stats.isDirectory()) {
    throw new Error(`Path exists and is not a directory: ${absolute}`);
  }
  return realFinal;
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
  encoding: string = "utf-8",
): Promise<string> {
  return await fs.readFile(filePath, encoding as BufferEncoding);
}

export async function writeFileContent(
  filePath: string,
  content: string,
): Promise<void> {
  await writeFileAtomic(filePath, content);
}

/**
 * Binary counterpart of writeFileContent (PDF/DOCX output) with the same
 * symlink-safe, atomic write semantics.
 */
export async function writeBinaryFileAtomic(
  filePath: string,
  data: Uint8Array,
): Promise<void> {
  await writeFileAtomic(filePath, data);
}

async function writeFileAtomic(
  filePath: string,
  data: string | Uint8Array,
): Promise<void> {
  const encoding = typeof data === "string" ? ("utf-8" as const) : undefined;
  try {
    // Security: 'wx' flag ensures exclusive creation - fails if file/symlink exists,
    // preventing writes through pre-existing symlinks
    await fs.writeFile(filePath, data, { encoding, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      // Security: Use atomic rename to prevent race conditions where symlinks
      // could be created between validation and write. Rename operations
      // replace the target file atomically and don't follow symlinks.
      const tempPath = `${filePath}.${randomBytes(16).toString("hex")}.tmp`;
      try {
        await fs.writeFile(tempPath, data, { encoding, flag: "wx" });
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
  instruction?: string;
  expectedOccurrences?: number;
}

interface MatchResult {
  strategy: "exact" | "flexible" | "fuzzy";
  occurrences: number;
  modifiedContent: string;
  message: string;
  warning?: string;
  ambiguity?: {
    locations: string;
    suggestion: string;
  };
  lineRange?: {
    start: number;
    end: number;
  };
}

// Helper function to escape regex special characters
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Tier 1: Exact Match
function tryExactMatch(
  content: string,
  oldText: string,
  newText: string,
): MatchResult | null {
  const searchText = normalizeLineEndings(oldText);
  const replaceText = normalizeLineEndings(newText);

  // Count occurrences
  const escapedSearch = escapeRegex(searchText);
  const occurrences = (content.match(new RegExp(escapedSearch, "g")) || [])
    .length;

  if (occurrences === 0) {
    return null;
  }

  // Replace first occurrence only
  const modified = content.replace(searchText, replaceText);

  // Find the line number where the match occurred
  const matchIndex = content.indexOf(searchText);
  const linesBeforeMatch = content.substring(0, matchIndex).split("\n").length;

  return {
    strategy: "exact",
    occurrences,
    modifiedContent: modified,
    message: `Exact match found (${occurrences} occurrence${
      occurrences > 1 ? "s" : ""
    })`,
    lineRange: {
      start: linesBeforeMatch,
      end: linesBeforeMatch + searchText.split("\n").length - 1,
    },
    ambiguity:
      occurrences > 1
        ? {
            locations: `${occurrences} locations in file`,
            suggestion:
              "Consider adding more context to oldText to uniquely identify the target",
          }
        : undefined,
  };
}

// Tier 2: Flexible Match (whitespace-insensitive)
function tryFlexibleMatch(
  content: string,
  oldText: string,
  newText: string,
): MatchResult | null {
  const contentLines = content.split("\n");
  const searchLines = oldText.split("\n");
  const replaceLines = newText.split("\n");

  const matches: Array<{
    startLine: number;
    endLine: number;
    indentation: string;
  }> = [];

  // Find all matching windows
  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    const window = contentLines.slice(i, i + searchLines.length);

    // Compare with trimmed content (whitespace-insensitive)
    const isMatch = searchLines.every(
      (searchLine, j) => searchLine.trim() === window[j].trim(),
    );

    if (isMatch) {
      const indentation = window[0].match(/^(\s*)/)?.[0] || "";
      matches.push({
        startLine: i + 1,
        endLine: i + searchLines.length,
        indentation,
      });
    }
  }

  if (matches.length === 0) {
    return null;
  }

  // Apply replacement to first match, preserving indentation
  const firstMatch = matches[0];
  const indentedReplaceLines = replaceLines.map((line) => {
    if (line.trim() === "") return ""; // Preserve empty lines
    return firstMatch.indentation + line.trim();
  });

  contentLines.splice(
    firstMatch.startLine - 1,
    firstMatch.endLine - firstMatch.startLine + 1,
    ...indentedReplaceLines,
  );

  return {
    strategy: "flexible",
    occurrences: matches.length,
    modifiedContent: contentLines.join("\n"),
    message: `Flexible match found at line ${firstMatch.startLine} (${
      matches.length
    } total occurrence${matches.length > 1 ? "s" : ""})`,
    lineRange: {
      start: firstMatch.startLine,
      end: firstMatch.endLine,
    },
    ambiguity:
      matches.length > 1
        ? {
            locations: matches
              .map((m) => `lines ${m.startLine}-${m.endLine}`)
              .join(", "),
            suggestion:
              "Consider adding more context to oldText to uniquely identify the target",
          }
        : undefined,
  };
}

// Tier 3: Fuzzy Match (token-based regex)
function tryFuzzyMatch(
  content: string,
  oldText: string,
  newText: string,
): MatchResult | null {
  // Tokenize around code delimiters
  const delimiters = [
    "(",
    ")",
    ":",
    "[",
    "]",
    "{",
    "}",
    ">",
    "<",
    "=",
    ";",
    ",",
  ];

  let tokenizedSearch = oldText;
  for (const delim of delimiters) {
    tokenizedSearch = tokenizedSearch.split(delim).join(` ${delim} `);
  }

  // Split on whitespace and filter empties
  const tokens = tokenizedSearch.split(/\s+/).filter(Boolean);

  if (tokens.length === 0) {
    return null;
  }

  // Build regex: tokens separated by flexible whitespace
  const escapedTokens = tokens.map((t) => escapeRegex(t));
  const pattern = `^(\\s*)${escapedTokens.join("\\s*")}`;
  const fuzzyRegex = new RegExp(pattern, "m");

  const match = fuzzyRegex.exec(content);

  if (!match) {
    return null;
  }

  const matchedText = match[0];
  const indentation = match[1] || "";

  // Apply indentation to replacement
  const replaceLines = newText.split("\n");
  const indentedReplace = replaceLines
    .map((line) => {
      if (line.trim() === "") return "";
      return indentation + line.trim();
    })
    .join("\n");

  const modified = content.replace(fuzzyRegex, indentedReplace);

  // Calculate approximate position
  const linesBeforeMatch = content.substring(0, match.index).split("\n").length;

  return {
    strategy: "fuzzy",
    occurrences: 1, // Fuzzy match only replaces first occurrence
    modifiedContent: modified,
    message: `Fuzzy match found near line ${linesBeforeMatch}`,
    lineRange: {
      start: linesBeforeMatch,
      end: linesBeforeMatch + matchedText.split("\n").length - 1,
    },
    warning:
      "Fuzzy matching was used. Please review changes carefully to ensure accuracy.",
  };
}

// Apply edit with strategy selection
function applyEditWithStrategy(
  content: string,
  edit: FileEdit,
  strategy: "exact" | "flexible" | "fuzzy" | "auto",
  failOnAmbiguous: boolean,
): MatchResult {
  let result: MatchResult | null = null;
  const attemptedStrategies: string[] = [];

  if (strategy === "auto") {
    // Try each strategy in order
    result = tryExactMatch(content, edit.oldText, edit.newText);
    if (result) {
      if (
        failOnAmbiguous &&
        result.occurrences > 1 &&
        (!edit.expectedOccurrences || edit.expectedOccurrences === 1)
      ) {
        throw new Error(
          `Ambiguous match: found ${result.occurrences} occurrences of the search text.\n` +
            (edit.instruction ? `Edit: ${edit.instruction}\n` : "") +
            `Locations: ${result.ambiguity?.locations || "multiple"}\n` +
            `Suggestion: ${
              result.ambiguity?.suggestion ||
              "Add more context to uniquely identify the target"
            }`,
        );
      }
      return result;
    }
    attemptedStrategies.push("exact");

    result = tryFlexibleMatch(content, edit.oldText, edit.newText);
    if (result) {
      if (
        failOnAmbiguous &&
        result.occurrences > 1 &&
        (!edit.expectedOccurrences || edit.expectedOccurrences === 1)
      ) {
        throw new Error(
          `Ambiguous match: found ${result.occurrences} occurrences of the search text.\n` +
            (edit.instruction ? `Edit: ${edit.instruction}\n` : "") +
            `Locations: ${result.ambiguity?.locations || "multiple"}\n` +
            `Suggestion: ${
              result.ambiguity?.suggestion ||
              "Add more context to uniquely identify the target"
            }`,
        );
      }
      return result;
    }
    attemptedStrategies.push("flexible");

    result = tryFuzzyMatch(content, edit.oldText, edit.newText);
    if (result) return result;
    attemptedStrategies.push("fuzzy");
  } else {
    // Use specified strategy only
    switch (strategy) {
      case "exact":
        result = tryExactMatch(content, edit.oldText, edit.newText);
        attemptedStrategies.push("exact");
        break;
      case "flexible":
        result = tryFlexibleMatch(content, edit.oldText, edit.newText);
        attemptedStrategies.push("flexible");
        break;
      case "fuzzy":
        result = tryFuzzyMatch(content, edit.oldText, edit.newText);
        attemptedStrategies.push("fuzzy");
        break;
    }

    if (
      result &&
      failOnAmbiguous &&
      result.occurrences > 1 &&
      (!edit.expectedOccurrences || edit.expectedOccurrences === 1)
    ) {
      throw new Error(
        `Ambiguous match: found ${result.occurrences} occurrences of the search text.\n` +
          (edit.instruction ? `Edit: ${edit.instruction}\n` : "") +
          `Locations: ${result.ambiguity?.locations || "multiple"}\n` +
          `Suggestion: ${
            result.ambiguity?.suggestion ||
            "Add more context to uniquely identify the target"
          }`,
      );
    }
  }

  // No match found - throw error
  if (!result) {
    let errorMsg = "Failed to apply edit";
    if (edit.instruction) {
      errorMsg += `\nEdit goal: ${edit.instruction}`;
    }
    errorMsg += `\n\nSearched for:\n${edit.oldText}\n`;
    errorMsg += `\nAttempted strategies: ${attemptedStrategies.join(", ")}`;
    errorMsg += `\n\nTroubleshooting tips:`;
    errorMsg += `\n- Ensure oldText matches the file content exactly (check whitespace, indentation)`;
    errorMsg += `\n- Use the read_file tool to verify current file content`;
    errorMsg += `\n- Include 3-5 lines of context before and after the target change`;
    errorMsg += `\n- Try matchingStrategy: "flexible" if whitespace is the issue`;

    throw new Error(errorMsg);
  }

  // Validate occurrence count
  if (
    edit.expectedOccurrences &&
    result.occurrences !== edit.expectedOccurrences
  ) {
    throw new Error(
      `Expected ${edit.expectedOccurrences} occurrence(s) but found ${result.occurrences}\n` +
        (edit.instruction ? `Edit: ${edit.instruction}\n` : "") +
        `Strategy used: ${result.strategy}`,
    );
  }

  return result;
}

export async function applyFileEdits(
  filePath: string,
  edits: FileEdit[],
  dryRun: boolean = false,
  matchingStrategy: "exact" | "flexible" | "fuzzy" | "auto" = "auto",
  failOnAmbiguous: boolean = true,
  returnMetadata?: boolean,
): Promise<string | { diff: string; metadata: MatchResult[] }> {
  // Read file content and detect original line ending
  const rawContent = await fs.readFile(filePath, "utf-8");
  const originalLineEnding = detectLineEnding(rawContent);

  // Normalize line endings for processing
  const content = normalizeLineEndings(rawContent);

  // Apply edits sequentially, tracking results
  let modifiedContent = content;
  const editResults: MatchResult[] = [];

  for (const edit of edits) {
    const result = applyEditWithStrategy(
      modifiedContent,
      edit,
      matchingStrategy,
      failOnAmbiguous,
    );
    editResults.push(result);
    modifiedContent = result.modifiedContent;
  }

  // Create detailed diff output with edit summaries
  const detailedDiff = formatDetailedDiff(
    content,
    modifiedContent,
    filePath,
    editResults,
  );

  // Format diff with appropriate number of backticks
  let numBackticks = 3;
  while (detailedDiff.includes("`".repeat(numBackticks))) {
    numBackticks++;
  }
  const formattedDiff = `${"`".repeat(
    numBackticks,
  )}diff\n${detailedDiff}${"`".repeat(numBackticks)}\n\n`;

  if (!dryRun) {
    // Restore original line endings before writing
    const contentToWrite =
      originalLineEnding === "\r\n"
        ? modifiedContent.replace(/\n/g, "\r\n")
        : modifiedContent;

    // Security: Use atomic rename to prevent race conditions where symlinks
    // could be created between validation and write. Rename operations
    // replace the target file atomically and don't follow symlinks.
    const tempPath = `${filePath}.${randomBytes(16).toString("hex")}.tmp`;
    try {
      await fs.writeFile(tempPath, contentToWrite, "utf-8");
      await fs.rename(tempPath, filePath);
    } catch (error) {
      try {
        await fs.unlink(tempPath);
      } catch {}
      throw error;
    }
  }

  if (returnMetadata) {
    return {
      diff: formattedDiff,
      metadata: editResults,
    };
  }

  return formattedDiff;
}

/**
 * VFO-15: head/tail/range reads stream the file, but the text they hold
 * (collected lines plus the current partial line) must stay bounded, e.g.
 * for a file consisting of one huge line.
 */
function assertWithinTextReadLimit(heldChars: number): void {
  if (heldChars > MAX_TEXT_READ_BYTES) {
    throw new Error(
      `Requested lines exceed the ${(MAX_TEXT_READ_BYTES / 1024 / 1024).toFixed(1)} MB ` +
        `read limit (the file may contain very long lines). Request fewer lines.`,
    );
  }
}

// Memory-efficient implementation to get the last N lines of a file
export async function tailFile(
  filePath: string,
  numLines: number,
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
    let linesLength = 0;
    // The newline that ends the last line does not start another (empty)
    // line, so tail of "a\nb\n" with 1 line is "b", as with POSIX tail.
    let atFileEnd = true;

    // Read chunks from the end of the file until we have enough lines
    while (position > 0 && linesFound < numLines) {
      const size = Math.min(CHUNK_SIZE, position);
      position -= size;

      const { bytesRead } = await fileHandle.read(chunk, 0, size, position);
      if (!bytesRead) break;

      // Get the chunk as a string and prepend any remaining text from previous iteration
      const readData = chunk.slice(0, bytesRead).toString("utf-8");

      // VFO-15: bound memory held for one (partial) line plus the output,
      // and avoid re-splitting an ever-growing line on every chunk.
      if (position > 0 && !/[\r\n]/.test(readData)) {
        remainingText = readData + remainingText;
        assertWithinTextReadLimit(remainingText.length + linesLength);
        continue;
      }
      const chunkText = readData + remainingText;

      // Split by newlines and count
      const chunkLines = normalizeLineEndings(chunkText).split("\n");

      if (atFileEnd) {
        if (chunkLines.length > 1 && chunkLines[chunkLines.length - 1] === "") {
          chunkLines.pop();
        }
        atFileEnd = false;
      }

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
        linesLength += chunkLines[i].length + 1;
      }
      assertWithinTextReadLimit(linesLength + remainingText.length);
    }

    return lines.join("\n");
  } finally {
    await fileHandle.close();
  }
}

// New function to get the first N lines of a file
export async function headFile(
  filePath: string,
  numLines: number,
): Promise<string> {
  const fileHandle = await fs.open(filePath, "r");
  try {
    const lines: string[] = [];
    let buffer = "";
    let bytesRead = 0;
    let linesLength = 0;
    const chunk = Buffer.alloc(1024); // 1KB buffer

    // Read chunks and count lines until we have enough or reach EOF
    while (lines.length < numLines) {
      const result = await fileHandle.read(chunk, 0, chunk.length, bytesRead);
      if (result.bytesRead === 0) break; // End of file
      bytesRead += result.bytesRead;
      const text = chunk.slice(0, result.bytesRead).toString("utf-8");
      buffer += text;

      // Only rescan the buffer when the new chunk completes a line.
      const newLineIndex = text.includes("\n") ? buffer.lastIndexOf("\n") : -1;
      if (newLineIndex !== -1) {
        const completeLines = buffer.slice(0, newLineIndex).split("\n");
        buffer = buffer.slice(newLineIndex + 1);
        for (const line of completeLines) {
          lines.push(line);
          linesLength += line.length + 1;
          if (lines.length >= numLines) break;
        }
      }
      assertWithinTextReadLimit(linesLength + buffer.length);
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

/**
 * Read a specific range of lines from a file
 * Memory-efficient implementation that reads sequentially and stops after reaching endLine
 * @param filePath - Path to the file to read
 * @param startLine - Starting line number (1-indexed, inclusive)
 * @param endLine - Ending line number (1-indexed, inclusive)
 * @returns Promise resolving to the requested lines as a string
 */
export async function rangeFile(
  filePath: string,
  startLine: number,
  endLine: number,
): Promise<string> {
  const CHUNK_SIZE = 1024; // Read 1KB at a time
  const fileHandle = await fs.open(filePath, "r");

  try {
    const targetLines: string[] = [];
    let currentLineNumber = 0;
    let buffer = "";
    let bytesRead = 0;
    let targetLength = 0;
    const chunk = Buffer.alloc(CHUNK_SIZE);

    // Read file sequentially until we reach the end line
    while (currentLineNumber < endLine) {
      const result = await fileHandle.read(chunk, 0, chunk.length, bytesRead);

      // End of file reached
      if (result.bytesRead === 0) {
        // Process any remaining buffer content
        if (buffer.length > 0 && currentLineNumber + 1 >= startLine) {
          currentLineNumber++;
          if (currentLineNumber >= startLine && currentLineNumber <= endLine) {
            targetLines.push(buffer);
          }
        }
        break;
      }

      bytesRead += result.bytesRead;
      const text = chunk.slice(0, result.bytesRead).toString("utf-8");

      if (!text.includes("\n")) {
        if (currentLineNumber + 1 < startLine) {
          // Middle of a line before the range: its content is never needed.
          buffer = "";
        } else {
          buffer += text;
          assertWithinTextReadLimit(targetLength + buffer.length);
        }
        continue;
      }
      buffer += text;

      // Process complete lines in buffer
      let newLineIndex = buffer.indexOf("\n");
      while (newLineIndex !== -1) {
        const line = buffer.slice(0, newLineIndex);
        buffer = buffer.slice(newLineIndex + 1);
        currentLineNumber++;

        // Check if this line is within our target range
        if (currentLineNumber >= startLine && currentLineNumber <= endLine) {
          targetLines.push(line);
          targetLength += line.length + 1;
          assertWithinTextReadLimit(targetLength);
        }

        // Early exit if we've collected all needed lines
        if (currentLineNumber >= endLine) {
          break;
        }

        newLineIndex = buffer.indexOf("\n");
      }

      // Early exit if we've reached the end line
      if (currentLineNumber >= endLine) {
        break;
      }
    }

    return targetLines.join("\n");
  } finally {
    await fileHandle.close();
  }
}

/**
 * Maximum length of a grep_files regex pattern. Compiling is cheap, but long
 * model-supplied patterns only widen the backtracking attack surface (VFO-14).
 */
export const MAX_GREP_PATTERN_LENGTH = 1_000;

/**
 * Maximum length of a glob pattern handed to minimatch (glob_files pattern,
 * excludePatterns, grep_files glob). minimatch has had ReDoS advisories; a
 * length cap is cheap defense in depth.
 */
export const MAX_GLOB_PATTERN_LENGTH = 1_000;

export { DEFAULT_GREP_REGEX_FILE_TIMEOUT_MS, DEFAULT_GREP_REGEX_TOTAL_TIMEOUT_MS };

function assertGlobPatternLength(value: string, what: string): void {
  if (value.length > MAX_GLOB_PATTERN_LENGTH) {
    throw new Error(
      `${what} is too long (${value.length} characters); the maximum is ${MAX_GLOB_PATTERN_LENGTH}`,
    );
  }
}

export async function searchFilesWithValidation(
  rootPath: string,
  pattern: string,
  allowedDirectories: string[],
  options: SearchOptions = {},
): Promise<string[]> {
  const { excludePatterns = [] } = options;
  const results: string[] = [];

  assertGlobPatternLength(pattern, "Glob pattern");
  for (const excludePattern of excludePatterns) {
    assertGlobPatternLength(excludePattern, "Exclude pattern");
  }

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
          minimatch(relativePath, excludePattern, { dot: true }),
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
  options: GrepOptions = {},
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
    regexFileTimeoutMs,
    regexTotalTimeoutMs,
  } = options;

  if (pattern.length > MAX_GREP_PATTERN_LENGTH) {
    throw new Error(
      `Regex pattern is too long (${pattern.length} characters); the maximum is ${MAX_GREP_PATTERN_LENGTH}`,
    );
  }
  if (globPattern) {
    assertGlobPatternLength(globPattern, "Glob pattern");
  }

  // Validate the pattern up front with the same flags the line matcher uses
  // (no 'g' flag to avoid stateful matching). Compiling is cheap; all matching
  // against file content happens in a time-bounded worker (VFO-14).
  const flags = caseInsensitive ? "i" : "";
  const dotAllFlag = multiline ? "s" : "";

  try {
    new RegExp(pattern, flags + dotAllFlag);
  } catch (error) {
    throw new Error(
      `Invalid regex pattern: ${pattern} - ${
        error instanceof Error ? error.message : String(error)
      }`,
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

  // One worker per call, reused across files and always terminated below.
  const regexSession = new RegexEvaluationSession({
    fileTimeoutMs: regexFileTimeoutMs,
    totalTimeoutMs: regexTotalTimeoutMs,
  });

  function buildMatch(filePath: string, lines: string[], i: number): GrepMatch {
    const match: GrepMatch = {
      file: filePath,
      line: i + 1,
      content: lines[i],
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

    return match;
  }

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

    // Apply glob filter. Like ripgrep's --glob, a pattern without a slash
    // (e.g. "*.md") matches the file name at any depth; a pattern with a
    // slash (e.g. "src/**/*.ts") is matched against the relative path.
    if (globPattern) {
      const relativePath = path.relative(searchPath, filePath);
      const matchBase = !/[\\/]/.test(globPattern);
      if (!minimatch(relativePath, globPattern, { dot: true, matchBase })) {
        return; // Skip files that don't match glob
      }
    }

    // Check file size (limit to 100MB to prevent memory issues)
    const MAX_FILE_SIZE = 100 * 1024 * 1024;
    try {
      const fileStats = await fs.stat(filePath);
      if (fileStats.size > MAX_FILE_SIZE) {
        console.warn(
          `Skipping large file: ${filePath} (${formatSize(fileStats.size)})`,
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

      // Matching lines still to be emitted before head_limit is reached in
      // content mode; lets the worker stop scanning early. Line output is
      // replayed below exactly as the former in-thread loop produced it.
      const remainingHead =
        outputMode === "content" && headLimit
          ? Math.max(0, headLimit - result.matches!.length)
          : undefined;

      if (multiline) {
        // For multiline mode, search the entire content (global regex without
        // dotAll), then find which lines match the dotAll regex.
        const evaluation = await regexSession.evaluate(
          {
            content,
            pattern,
            flags,
            multiline: true,
            needLines: outputMode === "content",
            maxLineMatches: remainingHead,
          },
          filePath,
        );

        if (evaluation.hasGlobalMatch) {
          fileHasMatch = true;
          fileMatchCount = evaluation.globalMatchCount;
          result.totalMatches += evaluation.globalMatchCount;

          if (outputMode === "content") {
            const lines = normalizeLineEndings(content).split("\n");
            for (const i of evaluation.lineIndices) {
              if (headLimit && result.matches!.length >= headLimit) {
                break;
              }
              result.matches!.push(buildMatch(filePath, lines, i));
            }
          }
        }
      } else {
        // For single-line mode, search line by line. In content mode the
        // former loop counted the match that hit head_limit before breaking,
        // so one extra matching line is requested.
        const evaluation = await regexSession.evaluate(
          {
            content,
            pattern,
            flags,
            multiline: false,
            needLines: true,
            maxLineMatches:
              remainingHead === undefined ? undefined : remainingHead + 1,
          },
          filePath,
        );

        const lines =
          outputMode === "content"
            ? normalizeLineEndings(content).split("\n")
            : [];
        for (const i of evaluation.lineIndices) {
          fileHasMatch = true;
          fileMatchCount++;
          result.totalMatches++;

          // Handle different output modes
          if (outputMode === "content") {
            // Check head limit for content mode
            if (headLimit && result.matches!.length >= headLimit) {
              break; // Stop processing this file
            }

            result.matches!.push(buildMatch(filePath, lines, i));
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
      // Regex timeouts / worker failures abort the whole search.
      if (error instanceof RegexEvaluationError) {
        throw error;
      }
      // Skip binary files or files we can't read
      return;
    }
  }

  async function searchDirectory(
    dirPath: string,
    depth: number = 0,
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
    } catch (error) {
      // Regex timeouts / worker failures abort the whole search.
      if (error instanceof RegexEvaluationError) {
        throw error;
      }
      // Skip directories we can't read
      return;
    }
  }

  // Execute search
  try {
    if (isDirectory) {
      await searchDirectory(searchPath);
    } else {
      await searchFile(searchPath);
    }
  } finally {
    await regexSession.dispose();
  }

  return result;
}

import path from "path";
import os from "os";
import { expandHome } from "./path-utils.js";

/**
 * Extract file and directory paths from shell command arguments
 * 
 * This function parses shell commands to identify file/directory paths
 * that need to be validated against allowed directories. It handles:
 * - Windows paths (C:\path, \\server\share\path)
 * - Unix paths (/path, ~/path)
 * - Relative paths (./path, ../path) - resolved to absolute
 * - Quoted paths ("path with spaces")
 * - Environment variables ($HOME, %USERPROFILE%)
 * 
 * @param command - The shell command string
 * @param workdir - Working directory for resolving relative paths
 * @returns Array of absolute paths found in the command
 */
export function extractPathsFromCommand(
  command: string,
  workdir: string
): string[] {
  if (!command || !command.trim()) {
    return [];
  }

  const paths: string[] = [];
  const tokens = tokenizeCommand(command);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    
    // Skip command name itself (first token)
    if (i === 0) {
      continue;
    }

    // Skip flags and options
    if (isFlagOrOption(token)) {
      // Some flags take arguments (like -o output.txt)
      // Check if next token might be a path argument
      if (i + 1 < tokens.length) {
        const nextToken = tokens[i + 1];
        if (isLikelyPathArgument(nextToken)) {
          const resolvedPath = resolvePath(nextToken, workdir);
          if (resolvedPath) {
            paths.push(resolvedPath);
            i++; // Skip the next token since we processed it
          }
        }
      }
      continue;
    }

    // Check if token is a path
    if (isLikelyPathArgument(token)) {
      const resolvedPath = resolvePath(token, workdir);
      if (resolvedPath) {
        paths.push(resolvedPath);
      }
    }
  }

  return paths;
}

/**
 * Tokenize command string, handling quoted arguments
 */
function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inDoubleQuotes = false;
  let inSingleQuotes = false;
  let escaped = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      current += char;
      continue;
    }

    if (char === '"' && !inSingleQuotes) {
      inDoubleQuotes = !inDoubleQuotes;
      current += char;
      continue;
    }

    if (char === "'" && !inDoubleQuotes) {
      inSingleQuotes = !inSingleQuotes;
      current += char;
      continue;
    }

    if ((char === " " || char === "\t") && !inDoubleQuotes && !inSingleQuotes) {
      if (current.trim()) {
        tokens.push(current.trim());
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    tokens.push(current.trim());
  }

  return tokens;
}

/**
 * Check if a token is a flag or option (not a path)
 */
function isFlagOrOption(token: string): boolean {
  // Remove surrounding quotes
  const cleanToken = token.replace(/^["']|["']$/g, "");

  // Windows: -flag or /flag
  if (cleanToken.match(/^[-/][^-/]/)) {
    return true;
  }

  // Unix: --long-flag or -s
  if (cleanToken.match(/^--?[a-zA-Z]/)) {
    return true;
  }

  return false;
}

/**
 * Check if a token is likely a file/directory path argument
 */
function isLikelyPathArgument(token: string): boolean {
  // Remove surrounding quotes
  const cleanToken = token.replace(/^["']|["']$/g, "");

  // Windows absolute path: C:\path or \\server\share\path
  if (cleanToken.match(/^[A-Za-z]:[\\/]/) || cleanToken.startsWith("\\\\")) {
    return true;
  }

  // Unix absolute path: /path
  if (cleanToken.startsWith("/") && !cleanToken.match(/^\/[a-zA-Z]\//)) {
    // Exclude Windows-style paths like /c/path
    return true;
  }

  // Home directory: ~/path or ~
  if (cleanToken.startsWith("~/") || cleanToken === "~") {
    return true;
  }

  // Relative path: ./path or ../path
  if (cleanToken.startsWith("./") || cleanToken.startsWith("../")) {
    return true;
  }

  // Path with environment variable: $HOME/path or %USERPROFILE%\path
  if (cleanToken.includes("$") || cleanToken.includes("%")) {
    return true;
  }

  // If it contains path separators, might be a path
  if (cleanToken.includes("/") || cleanToken.includes("\\")) {
    // But exclude URLs and other non-path strings
    if (
      !cleanToken.match(/^https?:\/\//) &&
      !cleanToken.match(/^[a-zA-Z]+:\/\//) &&
      !cleanToken.match(/^[a-zA-Z]+:/) // Exclude single-letter drive-like patterns
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Resolve a path token to an absolute path
 */
function resolvePath(token: string, workdir: string): string | null {
  try {
    // Remove surrounding quotes
    let cleanToken = token.replace(/^["']|["']$/g, "");

    // Expand environment variables
    cleanToken = expandEnvironmentVariables(cleanToken);

    // Expand home directory
    cleanToken = expandHome(cleanToken);

    // Resolve to absolute path
    let absolute: string;
    if (path.isAbsolute(cleanToken)) {
      absolute = path.resolve(cleanToken);
    } else {
      absolute = path.resolve(workdir, cleanToken);
    }

    // Normalize the path
    return path.normalize(absolute);
  } catch {
    // If resolution fails, return null (don't block, but don't validate)
    return null;
  }
}

/**
 * Expand environment variables in a path string
 */
function expandEnvironmentVariables(pathStr: string): string {
  // Windows: %VAR%
  pathStr = pathStr.replace(/%([^%]+)%/g, (match, varName) => {
    return process.env[varName] || match;
  });

  // Unix: $VAR or ${VAR}
  pathStr = pathStr.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, varName) => {
    return process.env[varName] || match;
  });

  pathStr = pathStr.replace(/\${([^}]+)}/g, (match, varName) => {
    return process.env[varName] || match;
  });

  return pathStr;
}


#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  InitializeRequestSchema,
  PingRequestSchema,
  ToolSchema,
  RootsListChangedNotificationSchema,
  LATEST_PROTOCOL_VERSION,
  type Root,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";
import dotenv from "dotenv";
import { normalizePath, expandHome } from "../utils/path-utils.js";
import { getValidRootDirectories } from "../utils/roots-utils.js";
import {
  setAllowedDirectories,
  getAllowedDirectories,
  setIgnoredFolders,
  setEnabledTools,
} from "../utils/lib.js";

// Import tool handlers
import { getReadTools } from "../tools/read-tools.js";
import { getWriteTools } from "../tools/write-tools.js";
import { getFileSystemTools } from "../tools/filesystem-tools.js";
import { getSearchTools } from "../tools/search-tools.js";
import { initializeShellTool, getShellTools } from "../tools/shell-tool.js";

// Configuration storage
let allowedDirectories: string[] = [];
let approvedFoldersFromArgs: string[] = [];
let approvedCommandsFromArgs: string[] = [];
let ignoredFolders: string[] = [];
let enabledToolCategories: string[] = [];
let enabledTools: string[] = [];

// Command line argument parsing
function parseArguments() {
  const args = process.argv.slice(2);
  const directories: string[] = [];
  let parsingIgnoredFolders = false;
  let parsingEnabledToolCategories = false;
  let parsingEnabledTools = false;
  let parsingApprovedFolders = false;
  let parsingApprovedCommands = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--approved-folders") {
      parsingApprovedFolders = true;
      parsingIgnoredFolders = false;
      parsingEnabledToolCategories = false;
      parsingEnabledTools = false;
      parsingApprovedCommands = false;

      // Look ahead to collect all non-flag arguments
      const folders: string[] = [];
      while (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        folders.push(args[i + 1]);
        i++;
      }

      // Also support comma-separated format for backward compatibility
      approvedFoldersFromArgs = folders.flatMap((f) =>
        f
          .split(",")
          .map((dir) => dir.trim())
          .filter((dir) => dir.length > 0)
      );

      continue;
    }

    if (arg === "--ignored-folders") {
      parsingIgnoredFolders = true;
      parsingApprovedFolders = false;
      parsingEnabledToolCategories = false;
      parsingEnabledTools = false;
      parsingApprovedCommands = false;

      // Look ahead to collect all non-flag arguments
      const folders: string[] = [];
      while (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        folders.push(args[i + 1]);
        i++;
      }

      // Also support comma-separated format for backward compatibility
      ignoredFolders = folders.flatMap((f) =>
        f
          .split(",")
          .map((dir) => dir.trim())
          .filter((dir) => dir.length > 0)
      );

      continue;
    }

    if (arg === "--enabled-tool-categories") {
      parsingEnabledToolCategories = true;
      parsingIgnoredFolders = false;
      parsingApprovedFolders = false;
      parsingEnabledTools = false;
      parsingApprovedCommands = false;

      // Look ahead to collect all non-flag arguments
      const categories: string[] = [];
      while (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        categories.push(args[i + 1]);
        i++;
      }

      // Also support comma-separated format for backward compatibility
      enabledToolCategories = categories.flatMap((c) =>
        c
          .split(",")
          .map((cat) => cat.trim())
          .filter((cat) => cat.length > 0)
      );

      continue;
    }

    if (arg === "--enabled-tools") {
      parsingEnabledTools = true;
      parsingIgnoredFolders = false;
      parsingApprovedFolders = false;
      parsingEnabledToolCategories = false;
      parsingApprovedCommands = false;

      // Look ahead to collect all non-flag arguments
      const tools: string[] = [];
      while (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        tools.push(args[i + 1]);
        i++;
      }

      // Also support comma-separated format for backward compatibility
      enabledTools = tools.flatMap((t) =>
        t
          .split(",")
          .map((tool) => tool.trim())
          .filter((tool) => tool.length > 0)
      );

      continue;
    }

    if (arg === "--approved-commands") {
      parsingApprovedCommands = true;
      parsingIgnoredFolders = false;
      parsingApprovedFolders = false;
      parsingEnabledToolCategories = false;
      parsingEnabledTools = false;

      // Look ahead to collect all non-flag arguments
      const commands: string[] = [];
      while (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        commands.push(args[i + 1]);
        i++;
      }

      // Also support comma-separated format for backward compatibility
      approvedCommandsFromArgs = commands.flatMap((c) =>
        c
          .split(",")
          .map((cmd) => cmd.trim())
          .filter((cmd) => cmd.length > 0)
      );

      continue;
    }

    // If we're not parsing a flag value, treat as directory
    if (
      !parsingIgnoredFolders &&
      !parsingApprovedFolders &&
      !parsingEnabledToolCategories &&
      !parsingEnabledTools &&
      !parsingApprovedCommands
    ) {
      directories.push(arg);
    }

    // Reset parsing flags
    parsingIgnoredFolders = false;
    parsingApprovedFolders = false;
    parsingEnabledToolCategories = false;
    parsingEnabledTools = false;
    parsingApprovedCommands = false;
  }

  return directories;
}

const directoryArgs = parseArguments();

// Async initialization function to be called in runServer()
async function initializeDirectories() {
  // Display configuration info
  if (
    approvedFoldersFromArgs.length > 0 ||
    directoryArgs.length > 0 ||
    ignoredFolders.length > 0 ||
    enabledToolCategories.length > 0 ||
    enabledTools.length > 0
  ) {
    console.error("Configuration:");
    if (approvedFoldersFromArgs.length > 0) {
      console.error(
        `  Approved folders: ${approvedFoldersFromArgs.join(", ")}`
      );
    }
    if (directoryArgs.length > 0) {
      console.error(`  Directories: ${directoryArgs.join(", ")}`);
    }
    if (ignoredFolders.length > 0) {
      console.error(`  Ignored folders: ${ignoredFolders.join(", ")}`);
    }
    if (enabledToolCategories.length > 0) {
      console.error(
        `  Enabled tool categories: ${enabledToolCategories.join(", ")}`
      );
    }
    if (enabledTools.length > 0) {
      console.error(`  Enabled tools: ${enabledTools.join(", ")}`);
    }
    console.error("");
  }

  // Process approved folders from CLI arguments (--approved-folders)
  if (approvedFoldersFromArgs.length > 0) {
    // Store approved directories in normalized and resolved form
    allowedDirectories = await Promise.all(
      approvedFoldersFromArgs.map(async (dir) => {
        const expanded = expandHome(dir);
        const absolute = path.resolve(expanded);
        try {
          // Security: Resolve symlinks in allowed directories during startup
          // This ensures we know the real paths and can validate against them later
          const resolved = await fs.realpath(absolute);
          return normalizePath(resolved);
        } catch (error) {
          // If we can't resolve (doesn't exist), use the normalized absolute path
          // This allows configuring allowed dirs that will be created later
          return normalizePath(absolute);
        }
      })
    );

    // Validate that all approved directories exist and are accessible
    await Promise.all(
      allowedDirectories.map(async (dir) => {
        try {
          const stats = await fs.stat(dir);
          if (!stats.isDirectory()) {
            console.error(`Error: Approved folder ${dir} is not a directory`);
            process.exit(1);
          }
        } catch (error) {
          console.error(`Error accessing approved folder ${dir}:`, error);
          process.exit(1);
        }
      })
    );

    console.error(
      `Initialized with ${allowedDirectories.length} approved ${
        allowedDirectories.length === 1 ? "directory" : "directories"
      }`
    );
  }

  // Handle legacy positional directory arguments (backward compatibility)
  // Note: --approved-folders is the preferred method for specifying directories
  if (directoryArgs.length > 0) {
    const legacyDirectories = await Promise.all(
      directoryArgs.map(async (dir) => {
        const expanded = expandHome(dir);
        const absolute = path.resolve(expanded);
        try {
          // Security: Resolve symlinks in allowed directories during startup
          const resolved = await fs.realpath(absolute);
          return normalizePath(resolved);
        } catch (error) {
          // If we can't resolve (doesn't exist), use the normalized absolute path
          return normalizePath(absolute);
        }
      })
    );

    // Validate legacy directories
    await Promise.all(
      legacyDirectories.map(async (dir) => {
        try {
          const stats = await fs.stat(dir);
          if (!stats.isDirectory()) {
            console.error(`Error: Legacy directory ${dir} is not a directory`);
            process.exit(1);
          }
        } catch (error) {
          console.error(`Error accessing legacy directory ${dir}:`, error);
          process.exit(1);
        }
      })
    );

    // Merge with approved folders (avoid duplicates)
    for (const dir of legacyDirectories) {
      if (!allowedDirectories.includes(dir)) {
        allowedDirectories.push(dir);
      }
    }
  }

  // Initialize the global configuration in lib.ts
  setAllowedDirectories(allowedDirectories);
  setIgnoredFolders(ignoredFolders);
  // Set individual enabled tools (categories are combined dynamically in tool handlers)
  setEnabledTools(enabledTools);

  // Load shell command configuration
  let finalApprovedCommands: string[] = [];

  // Priority 1: --approved-commands from CLI (supersedes .env)
  if (approvedCommandsFromArgs.length > 0) {
    finalApprovedCommands = approvedCommandsFromArgs;
    console.error(
      `  Approved commands (from CLI): ${finalApprovedCommands.join(", ")}`
    );
  } else {
    // Priority 2: Load from .env file
    try {
      const envPath = path.join(process.cwd(), ".env");
      dotenv.config({ path: envPath });

      if (process.env.APPROVED_COMMANDS) {
        finalApprovedCommands = process.env.APPROVED_COMMANDS.split(",")
          .map((c) => c.trim())
          .filter((c) => c.length > 0);
        console.error(
          `  Approved commands (from .env): ${finalApprovedCommands.join(", ")}`
        );
      }
    } catch (error) {
      console.error(
        "  Note: Could not load .env file (this is okay if using CLI args)"
      );
    }
  }

  // Initialize shell tool with approved commands
  if (finalApprovedCommands.length > 0) {
    initializeShellTool(finalApprovedCommands);
    console.error(
      `Initialized shell tool with ${finalApprovedCommands.length} approved command(s)`
    );
  } else {
    initializeShellTool([]);
    console.error(
      "Shell tool initialized with no pre-approved commands (all commands require approval)"
    );
  }
}

// Generate dynamic server description
function generateServerDescription(): string {
  const baseDescription =
    "A configurable Model Context Protocol server for secure filesystem operations that absolutely rocks. " +
    "Enables AI assistants to dynamically access and manage file system resources with runtime directory registration and selective tool activation.";

  const currentDirs = getAllowedDirectories();

  if (currentDirs.length === 0) {
    return (
      baseDescription +
      "\n\nNO DIRECTORIES CURRENTLY ACCESSIBLE. Use register_directory tool to grant access, or restart server with --approved-folders argument."
    );
  }

  const dirList = currentDirs.map((dir) => `  - ${dir}`).join("\n");

  return `${baseDescription}\n\nIMMEDIATELY ACCESSIBLE DIRECTORIES (pre-approved, no registration needed):\n${dirList}\n\nIMPORTANT: These directories are already accessible to all filesystem tools. Do NOT use register_directory for these paths.\n\nTo add additional directories at runtime, use the register_directory tool or MCP Roots protocol.`;
}

// Server setup
const server = new Server(
  {
    name: "vulcan-file-ops",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {
        listChanged: true,
      },
      resources: {},
      prompts: {},
    },
  }
);

// Initialize handler - required for MCP protocol
server.setRequestHandler(InitializeRequestSchema, async (request) => {
  const clientCapabilities = request.params.capabilities;

  return {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: {
      tools: {
        listChanged: true,
      },
      resources: {},
      prompts: {},
    },
    serverInfo: {
      name: "vulcan-file-ops",
      version: "1.0.0",
    },
    instructions: generateServerDescription(),
  };
});

// Ping handler - for health checks
server.setRequestHandler(PingRequestSchema, async () => {
  return {};
});

// Tool registry for selective activation
const TOOL_REGISTRY = {
  // Read tools
  read_file: () => getReadTools().find((t) => t.name === "read_file"),
  attach_image: () => getReadTools().find((t) => t.name === "attach_image"),
  read_multiple_files: () =>
    getReadTools().find((t) => t.name === "read_multiple_files"),

  // Write tools
  write_file: () => getWriteTools().find((t) => t.name === "write_file"),
  edit_file: () => getWriteTools().find((t) => t.name === "edit_file"),
  write_multiple_files: () =>
    getWriteTools().find((t) => t.name === "write_multiple_files"),

  // Filesystem tools
  make_directory: () =>
    getFileSystemTools().find((t) => t.name === "make_directory"),
  list_directory: () =>
    getFileSystemTools().find((t) => t.name === "list_directory"),
  move_file: () => getFileSystemTools().find((t) => t.name === "move_file"),
  file_operations: () =>
    getFileSystemTools().find((t) => t.name === "file_operations"),
  delete_files: () =>
    getFileSystemTools().find((t) => t.name === "delete_files"),
  get_file_info: () =>
    getFileSystemTools().find((t) => t.name === "get_file_info"),
  register_directory: () =>
    getFileSystemTools().find((t) => t.name === "register_directory"),
  list_allowed_directories: () =>
    getFileSystemTools().find((t) => t.name === "list_allowed_directories"),

  // Search tools
  glob_files: () => getSearchTools().find((t) => t.name === "glob_files"),
  grep_files: () => getSearchTools().find((t) => t.name === "grep_files"),

  // Shell tool
  execute_shell: () => getShellTools().find((t) => t.name === "execute_shell"),
};

// Tool categories for easier configuration
const TOOL_CATEGORIES = {
  read: ["read_file", "attach_image", "read_multiple_files"],
  write: ["write_file", "edit_file", "write_multiple_files"],
  filesystem: [
    "make_directory",
    "list_directory",
    "move_file",
    "file_operations",
    "delete_files",
    "get_file_info",
    "register_directory",
    "list_allowed_directories",
  ],
  search: ["glob_files", "grep_files"],
  shell: ["execute_shell"],
  all: [
    "read_file",
    "read_text_file",
    "read_media_file",
    "read_multiple_files",
    "write_file",
    "edit_file",
    "write_multiple_files",
    "make_directory",
    "list_directory",
    "move_file",
    "file_operations",
    "delete_files",
    "get_file_info",
    "register_directory",
    "list_allowed_directories",
    "glob_files",
    "grep_files",
    "execute_shell",
  ],
};

// Function to expand tool categories and validate tool names
function expandEnabledTools(requestedTools: string[]): string[] {
  const expandedTools = new Set<string>();

  for (const tool of requestedTools) {
    if (tool === "all") {
      // Add all tools
      TOOL_CATEGORIES.all.forEach((t) => expandedTools.add(t));
    } else if (TOOL_CATEGORIES[tool as keyof typeof TOOL_CATEGORIES]) {
      // Expand category
      (
        TOOL_CATEGORIES[tool as keyof typeof TOOL_CATEGORIES] as string[]
      ).forEach((t) => expandedTools.add(t));
    } else if (TOOL_REGISTRY[tool as keyof typeof TOOL_REGISTRY]) {
      // Individual tool
      expandedTools.add(tool);
    } else {
      console.warn(`Unknown tool or category: ${tool}`);
    }
  }

  return Array.from(expandedTools);
}

// Function to combine and validate enabled tools from both categories and individual tools
function combineEnabledTools(): string[] {
  const allRequestedTools = [...enabledToolCategories, ...enabledTools];

  if (allRequestedTools.length === 0) {
    // If no tools specified, enable all by default
    return TOOL_CATEGORIES.all;
  }

  return expandEnabledTools(allRequestedTools);
}

// Tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => {
  let tools = [
    ...getReadTools(),
    ...getWriteTools(),
    ...getFileSystemTools(),
    ...getSearchTools(),
    ...getShellTools(),
  ];

  // Filter tools if selective activation is configured
  if (enabledToolCategories.length > 0 || enabledTools.length > 0) {
    const combinedEnabledTools = combineEnabledTools();
    tools = tools.filter((tool) => combinedEnabledTools.includes(tool.name));
  }

  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    // Check if tool is enabled (if selective activation is configured)
    if (enabledToolCategories.length > 0 || enabledTools.length > 0) {
      const combinedEnabledTools = combineEnabledTools();
      if (!combinedEnabledTools.includes(name)) {
        throw new Error(
          `Tool '${name}' is not enabled. Enabled tools: ${combinedEnabledTools.join(
            ", "
          )}`
        );
      }
    }

    // Import the tool handler dynamically based on the tool name
    // This keeps the main server file clean and modular
    switch (name) {
      // Read tools
      case "read_file":
      case "attach_image":
      case "read_multiple_files": {
        const { handleReadTool } = await import("../tools/read-tools.js");
        return await handleReadTool(name, args);
      }

      // Write tools
      case "write_file":
      case "edit_file":
      case "write_multiple_files": {
        const { handleWriteTool } = await import("../tools/write-tools.js");
        return await handleWriteTool(name, args);
      }

      // Filesystem tools
      case "make_directory":
      case "list_directory":
      case "move_file":
      case "file_operations":
      case "delete_files":
      case "get_file_info":
      case "register_directory":
      case "list_allowed_directories": {
        const { handleFileSystemTool } = await import(
          "../tools/filesystem-tools.js"
        );
        return await handleFileSystemTool(name, args);
      }

      // Search tools
      case "glob_files":
      case "grep_files": {
        const { handleSearchTool } = await import("../tools/search-tools.js");
        return await handleSearchTool(name, args);
      }

      // Shell tool
      case "execute_shell": {
        const { handleShellTool } = await import("../tools/shell-tool.js");
        return await handleShellTool(name, args);
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error: ${errorMessage}` }],
      isError: true,
    };
  }
});

// Updates allowed directories based on MCP client roots
async function updateAllowedDirectoriesFromRoots(requestedRoots: Root[]) {
  const validatedRootDirs = await getValidRootDirectories(requestedRoots);
  if (validatedRootDirs.length > 0) {
    // Note: MCP Roots replaces ALL allowed directories, including those specified via --approved-folders
    // This is the expected behavior per MCP protocol - Roots provides runtime workspace context
    allowedDirectories = [...validatedRootDirs];
    setAllowedDirectories(allowedDirectories); // Update the global state in lib.ts
    console.error(
      `Updated allowed directories from MCP roots: ${validatedRootDirs.length} valid directories`
    );
    console.error(
      "Note: MCP Roots replaces all previously configured directories (including --approved-folders)"
    );
  } else {
    console.error("No valid root directories provided by client");
  }
}

// Handles dynamic roots updates during runtime, when client sends "roots/list_changed" notification, server fetches the updated roots and replaces all allowed directories with the new roots.
server.setNotificationHandler(RootsListChangedNotificationSchema, async () => {
  try {
    // Request the updated roots list from the client
    const response = await server.listRoots();
    if (response && "roots" in response) {
      await updateAllowedDirectoriesFromRoots(response.roots);
    }
  } catch (error) {
    console.error(
      "Failed to request roots from client:",
      error instanceof Error ? error.message : String(error)
    );
  }
});

// Handles post-initialization setup, specifically checking for and fetching MCP roots.
server.oninitialized = async () => {
  const clientCapabilities = server.getClientCapabilities();

  if (clientCapabilities?.roots) {
    try {
      const response = await server.listRoots();
      if (response && "roots" in response) {
        await updateAllowedDirectoriesFromRoots(response.roots);
      }
    } catch (error) {
      // Silently handle errors - dynamic access will work via register_directory tool
    }
  }
};

// Start server
export async function runServer() {
  // Initialize directories before starting server
  await initializeDirectories();

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Minimal logging to avoid issues with MCP clients
}

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
import { normalizePath, expandHome } from "../utils/path-utils.js";
import { getValidRootDirectories } from "../utils/roots-utils.js";
import { setAllowedDirectories } from "../utils/lib.js";

// Import tool handlers
import { getReadTools } from "../tools/read-tools.js";
import { getWriteTools } from "../tools/write-tools.js";
import { getFileSystemTools } from "../tools/filesystem-tools.js";
import { getSearchTools } from "../tools/search-tools.js";

// Command line argument parsing (optional - dynamic access via MCP roots)
const args = process.argv.slice(2);
if (args.length > 0) {
  console.error(
    "Optional: Directories can be provided as command-line arguments,"
  );
  console.error(
    "but dynamic directory access via MCP roots protocol is preferred."
  );
}

// Store allowed directories in normalized and resolved form
let allowedDirectories = await Promise.all(
  args.map(async (dir) => {
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

// Validate that all directories exist and are accessible
await Promise.all(
  allowedDirectories.map(async (dir) => {
    try {
      const stats = await fs.stat(dir);
      if (!stats.isDirectory()) {
        console.error(`Error: ${dir} is not a directory`);
        process.exit(1);
      }
    } catch (error) {
      console.error(`Error accessing directory ${dir}:`, error);
      process.exit(1);
    }
  })
);

// Initialize the global allowedDirectories in lib.ts
setAllowedDirectories(allowedDirectories);

// Server setup
const server = new Server(
  {
    name: "filesystem-of-a-down",
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
      name: "filesystem-of-a-down",
      version: "1.0.0",
    },
  };
});

// Ping handler - for health checks
server.setRequestHandler(PingRequestSchema, async () => {
  return {};
});

// Tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools = [
    ...getReadTools(),
    ...getWriteTools(),
    ...getFileSystemTools(),
    ...getSearchTools(),
  ];

  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    // Import the tool handler dynamically based on the tool name
    // This keeps the main server file clean and modular
    switch (name) {
      // Read tools
      case "read_file":
      case "read_text_file":
      case "read_media_file":
      case "read_multiple_files": {
        const { handleReadTool } = await import("../tools/read-tools.js");
        return await handleReadTool(name, args);
      }

      // Write tools
      case "write_file":
      case "edit_file": {
        const { handleWriteTool } = await import("../tools/write-tools.js");
        return await handleWriteTool(name, args);
      }

      // Filesystem tools
      case "create_directory":
      case "list_directory":
      case "list_directory_with_sizes":
      case "directory_tree":
      case "move_file":
      case "get_file_info":
      case "register_directory":
      case "list_allowed_directories": {
        const { handleFileSystemTool } = await import(
          "../tools/filesystem-tools.js"
        );
        return await handleFileSystemTool(name, args);
      }

      // Search tools
      case "search_files": {
        const { handleSearchTool } = await import("../tools/search-tools.js");
        return await handleSearchTool(name, args);
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
    allowedDirectories = [...validatedRootDirs];
    setAllowedDirectories(allowedDirectories); // Update the global state in lib.ts
    console.error(
      `Updated allowed directories from MCP roots: ${validatedRootDirs.length} valid directories`
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
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Minimal logging to avoid issues with MCP clients
}

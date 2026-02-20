#!/usr/bin/env node

// CRITICAL: Detect MCP mode and suppress console output BEFORE any imports
// MCP servers use stdin/stdout for JSON-RPC via stdio transport
// Detection: stdin/stdout are NOT TTY (piped/redirected) OR explicit MCP flags are present.
// Note: We exclude help/version flags to allow CLI usage even when piped.
const isMCP =
  ((!process.stdin.isTTY && !process.stdout.isTTY) ||
    process.argv.some(
      (arg) =>
        arg.includes("mcp") || arg.includes("stdio") || arg.includes("inspector")
    )) &&
  !process.argv.some((arg) => arg === "--help" || arg === "-h" || arg === "--version" || arg === "-v");

if (isMCP) {
  // Suppress all console methods (but NOT stdout/stderr streams - MCP SDK needs those)
  const noop = () => {};
  console.log = noop;
  console.error = noop;
  console.warn = noop;
  console.info = noop;
  console.debug = noop;
  // NOTE: Do NOT redirect process.stdout.write or process.stderr.write
  // as the MCP SDK uses those for JSON-RPC protocol communication
}

import { runServer } from "./server/index.js";

// Run the server and handle any fatal errors
runServer().catch((error) => {
  // Only show errors when not running under MCP (to avoid protocol corruption)
  if (!isMCP) {
    // Restore console.error temporarily for fatal errors
    const originalError = console.error;
    if (originalError.toString() !== "() => {}") {
      originalError("Fatal error running server:", error);
    }
  }
  process.exit(1);
});

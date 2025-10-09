#!/usr/bin/env node

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "fs";
import path from "path";

async function testAllTools() {
  console.log("🧪 Testing ALL Filesystem of a Down MCP Tools");
  console.log("=".repeat(50));

  // Create MCP client transport
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/cli.js"],
  });

  const client = new Client(
    {
      name: "test-client",
      version: "1.0.0",
    },
    {
      capabilities: {},
    }
  );

  try {
    // Connect and initialize
    await client.connect(transport);
    console.log("✅ Connected to MCP server");

    // Test directory for operations
    const testDir = "C:\\Development\\Projects\\Test";

    // 1. Register the test directory
    console.log("\n📁 1. Registering test directory...");
    try {
      const registerResult = await client.callTool({
        name: "register_directory",
        arguments: { path: testDir },
      });
      console.log("✅ Directory registered:", registerResult.content[0].text);
    } catch (error) {
      console.log("❌ Directory registration failed:", error.message);
      return;
    }

    // 2. List allowed directories
    console.log("\n📋 2. Listing allowed directories...");
    const listAllowedResult = await client.callTool({
      name: "list_allowed_directories",
      arguments: {},
    });
    console.log("✅ Allowed directories:", listAllowedResult.content[0].text);

    // 3. List directory contents
    console.log("\n📂 3. Listing directory contents...");
    const listDirResult = await client.callTool({
      name: "list_directory",
      arguments: { path: testDir },
    });
    console.log("✅ Directory listing:", listDirResult.content[0].text);

    // 4. Create a test file
    console.log("\n📝 4. Creating test file...");
    const testFile = path.join(testDir, "test-file.txt");
    const createFileResult = await client.callTool({
      name: "write_file",
      arguments: {
        path: testFile,
        content: "This is a test file created by MCP tools!\nLine 2\nLine 3",
      },
    });
    console.log("✅ File created:", createFileResult.content[0].text);

    // 5. Read the file (text)
    console.log("\n📖 5. Reading text file...");
    const readTextResult = await client.callTool({
      name: "read_text_file",
      arguments: { path: testFile },
    });
    console.log(
      "✅ File content:",
      readTextResult.content[0].text.substring(0, 50) + "..."
    );

    // 6. Read first 2 lines
    console.log("\n📖 6. Reading first 2 lines...");
    const readHeadResult = await client.callTool({
      name: "read_text_file",
      arguments: { path: testFile, head: 2 },
    });
    console.log("✅ First 2 lines:", readHeadResult.content[0].text);

    // 7. Read last line
    console.log("\n📖 7. Reading last line...");
    const readTailResult = await client.callTool({
      name: "read_text_file",
      arguments: { path: testFile, tail: 1 },
    });
    console.log("✅ Last line:", readTailResult.content[0].text);

    // 8. Get file info
    console.log("\nℹ️ 8. Getting file info...");
    const fileInfoResult = await client.callTool({
      name: "get_file_info",
      arguments: { path: testFile },
    });
    console.log("✅ File info:", fileInfoResult.content[0].text);

    // 9. List directory with sizes
    console.log("\n📊 9. Listing directory with sizes...");
    const listWithSizesResult = await client.callTool({
      name: "list_directory_with_sizes",
      arguments: { path: testDir, sortBy: "size" },
    });
    console.log(
      "✅ Directory with sizes:",
      listWithSizesResult.content[0].text
    );

    // 10. Create a subdirectory
    console.log("\n📁 10. Creating subdirectory...");
    const subDir = path.join(testDir, "test-subdir");
    const createDirResult = await client.callTool({
      name: "create_directory",
      arguments: { path: subDir },
    });
    console.log("✅ Directory created:", createDirResult.content[0].text);

    // 11. Move file to subdirectory
    console.log("\n📦 11. Moving file to subdirectory...");
    const movedFile = path.join(subDir, "moved-file.txt");
    const moveResult = await client.callTool({
      name: "move_file",
      arguments: {
        source: testFile,
        destination: movedFile,
      },
    });
    console.log("✅ File moved:", moveResult.content[0].text);

    // 12. Edit the moved file
    console.log("\n✏️ 12. Editing the moved file...");
    const editResult = await client.callTool({
      name: "edit_file",
      arguments: {
        path: movedFile,
        edits: [
          {
            oldText: "This is a test file created by MCP tools!",
            newText: "This is an EDITED test file created by MCP tools!",
          },
        ],
        dryRun: false,
      },
    });
    console.log("✅ File edited (check diff output)");

    // 13. Search for files
    console.log("\n🔍 13. Searching for files...");
    const searchResult = await client.callTool({
      name: "search_files",
      arguments: {
        path: testDir,
        pattern: "*.txt",
      },
    });
    console.log("✅ Search results:", searchResult.content[0].text);

    // 14. Get directory tree
    console.log("\n🌳 14. Getting directory tree...");
    const treeResult = await client.callTool({
      name: "directory_tree",
      arguments: { path: testDir },
    });
    console.log("✅ Directory tree:", treeResult.content[0].text);

    // 15. Read multiple files
    console.log("\n📚 15. Reading multiple files...");
    const multiReadResult = await client.callTool({
      name: "read_multiple_files",
      arguments: {
        paths: [movedFile],
      },
    });
    console.log(
      "✅ Multiple files read:",
      multiReadResult.content[0].text.substring(0, 100) + "..."
    );

    console.log("\n🎉 ALL TOOLS TESTED SUCCESSFULLY!");
    console.log("✅ Filesystem of a Down MCP Server is working perfectly!");
    console.log("\n📁 Test directory:", testDir);
    console.log("🧹 You can manually clean up the test files if needed.");
  } catch (error) {
    console.error("❌ Test failed:", error);
    console.error("Stack:", error.stack);
  } finally {
    client.close();
  }
}

testAllTools();

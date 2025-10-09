# Filesystem of a Down MCP Server

**Version 1.0.0**

Node.js server implementing Model Context Protocol (MCP) for filesystem operations. A fully local, modular MCP server with no external dependencies.

## Features

- Read/write files
- Create/list/delete directories
- Move files/directories
- Search files
- Get file metadata
- Dynamic directory access control via [Roots](https://modelcontextprotocol.io/docs/learn/client-concepts#roots)

## Directory Access Control

The server uses a flexible directory access control system. Directories can be specified via command-line arguments or dynamically via [Roots](https://modelcontextprotocol.io/docs/learn/client-concepts#roots).

### Method 1: Command-line Arguments

Specify Allowed directories when starting the server:

```bash
mcp-server-filesystem /path/to/dir1 /path/to/dir2
```

### Method 2: MCP Roots (Recommended)

MCP clients that support [Roots](https://modelcontextprotocol.io/docs/learn/client-concepts#roots) can dynamically update the Allowed directories.

Roots notified by Client to Server, completely replace any server-side Allowed directories when provided.

**Important**: If server starts without command-line arguments AND client doesn't support roots protocol (or provides empty roots), the server will throw an error during initialization.

This is the recommended method, as this enables runtime directory updates via `roots/list_changed` notifications without server restart, providing a more flexible and modern integration experience.

### How It Works

The server's directory access control follows this flow:

1. **Server Startup**

   - Server starts with directories from command-line arguments (if provided)
   - If no arguments provided, server starts with empty allowed directories

2. **Client Connection & Initialization**
   - Client connects and sends `initialize` request with capabilities
   - Server checks if client supports roots protocol (`capabilities.roots`)
3. **Roots Protocol Handling** (if client supports roots)

   - **On initialization**: Server requests roots from client via `roots/list`
   - Client responds with its configured roots
   - Server replaces ALL allowed directories with client's roots
   - **On runtime updates**: Client can send `notifications/roots/list_changed`
   - Server requests updated roots and replaces allowed directories again

4. **Fallback Behavior** (if client doesn't support roots)

   - Server continues using command-line directories only
   - No dynamic updates possible

5. **Access Control**
   - All filesystem operations are restricted to allowed directories
   - Use `list_allowed_directories` tool to see current directories
   - Server requires at least ONE allowed directory to operate

**Note**: The server will only allow operations within directories specified either via `args` or via Roots.

## API

### Tools

- **read_text_file**

  - Read complete contents of a file as text
  - Inputs:
    - `path` (string)
    - `head` (number, optional): First N lines
    - `tail` (number, optional): Last N lines
  - Always treats the file as UTF-8 text regardless of extension
  - Cannot specify both `head` and `tail` simultaneously

- **read_media_file**

  - Read an image or audio file
  - Inputs:
    - `path` (string)
  - Streams the file and returns base64 data with the corresponding MIME type

- **read_multiple_files**

  - Read multiple files simultaneously
  - Input: `paths` (string[])
  - Failed reads won't stop the entire operation

- **write_file**

  - Create new file or overwrite existing (exercise caution with this)
  - Inputs:
    - `path` (string): File location
    - `content` (string): File content

- **edit_file**

  - Make selective edits using advanced pattern matching and formatting
  - Features:
    - Line-based and multi-line content matching
    - Whitespace normalization with indentation preservation
    - Multiple simultaneous edits with correct positioning
    - Indentation style detection and preservation
    - Git-style diff output with context
    - Preview changes with dry run mode
  - Inputs:
    - `path` (string): File to edit
    - `edits` (array): List of edit operations
      - `oldText` (string): Text to search for (can be substring)
      - `newText` (string): Text to replace with
    - `dryRun` (boolean): Preview changes without applying (default: false)
  - Returns detailed diff and match information for dry runs, otherwise applies changes
  - Best Practice: Always use dryRun first to preview changes before applying them

- **create_directory**

  - Create new directory or ensure it exists
  - Input: `path` (string)
  - Creates parent directories if needed
  - Succeeds silently if directory exists

- **list_directory**

  - List directory contents with [FILE] or [DIR] prefixes
  - Input: `path` (string)

- **list_directory_with_sizes**

  - List directory contents with [FILE] or [DIR] prefixes, including file sizes
  - Inputs:
    - `path` (string): Directory path to list
    - `sortBy` (string, optional): Sort entries by "name" or "size" (default: "name")
  - Returns detailed listing with file sizes and summary statistics
  - Shows total files, directories, and combined size

- **move_file**

  - Move or rename files and directories
  - Inputs:
    - `source` (string)
    - `destination` (string)
  - Fails if destination exists

- **search_files**

  - Recursively search for files/directories that match or do not match patterns
  - Inputs:
    - `path` (string): Starting directory
    - `pattern` (string): Search pattern
    - `excludePatterns` (string[]): Exclude any patterns.
  - Glob-style pattern matching
  - Returns full paths to matches

- **directory_tree**
  - Get recursive JSON tree structure of directory contents
  - Inputs:
    - `path` (string): Starting directory
    - `excludePatterns` (string[]): Exclude any patterns. Glob formats are supported.
  - Returns:
    - JSON array where each entry contains:
      - `name` (string): File/directory name
      - `type` ('file'|'directory'): Entry type
      - `children` (array): Present only for directories
        - Empty array for empty directories
        - Omitted for files
  - Output is formatted with 2-space indentation for readability
- **get_file_info**

  - Get detailed file/directory metadata
  - Input: `path` (string)
  - Returns:
    - Size
    - Creation time
    - Modified time
    - Access time
    - Type (file/directory)
    - Permissions

- **register_directory**

  - Dynamically register a directory for access during runtime
  - Input: `path` (string) - Directory path to register
  - Allows the AI to gain access to directories specified by the human user during conversation
  - The registered directory and all its subdirectories become accessible

- **list_allowed_directories**
  - List all directories the server is allowed to access
  - No input required
  - Returns:
    - Directories that this server can read/write from

## Usage with Claude Desktop

Add this to your `claude_desktop_config.json`:

**Important**: This version supports **dynamic directory access**. Directories can be specified in three ways:

1. **MCP Roots Protocol** (recommended): MCP clients like Claude Desktop can dynamically specify directories at runtime
2. **Command-line arguments**: Optional static directories at server startup
3. **Runtime registration**: The AI can register directories during conversation using the `register_directory` tool

This provides maximum flexibility - the human user can specify any directory during conversation, and the AI will dynamically gain access to it.

### Local Installation (Recommended)

First, install the package locally:

```bash
npm install -g filesystem-of-a-down
# or
npm install filesystem-of-a-down
```

Then configure your MCP client:

```json
{
  "mcpServers": {
    "filesystem-of-a-down": {
      "command": "filesystem-of-a-down"
    }
  }
}
```

### Advanced Configuration

The server supports additional configuration options for fine-tuning behavior:

#### Directory Ignore Patterns

Exclude specific folders from directory listings to improve performance and reduce clutter:

```json
{
  "mcpServers": {
    "filesystem-of-a-down": {
      "command": "filesystem-of-a-down",
      "args": ["--ignored-folders", "node_modules,dist,.git,.next"]
    }
  }
}
```

#### Selective Tool Activation

Enable only specific tools or tool categories instead of all 15 tools:

```json
{
  "mcpServers": {
    "filesystem-of-a-down": {
      "command": "filesystem-of-a-down",
      "args": ["--enabled-tools", "read,write,filesystem"]
    }
  }
}
```

**Tool Categories:**

- `read` - File reading operations
- `write` - File writing and editing operations
- `filesystem` - Directory and file system operations
- `search` - File searching operations
- `all` - All tools (default behavior)

**Individual Tools:** You can also specify individual tool names instead of categories.

#### Combined Configuration

You can combine both features:

```json
{
  "mcpServers": {
    "filesystem-of-a-down": {
      "command": "filesystem-of-a-down",
      "args": [
        "--ignored-folders",
        "node_modules,dist,.git",
        "--enabled-tools",
        "read,filesystem,search"
      ]
    }
  }
}
```

**Note**: Unlike the original npx version, this local installation gives you full control over the MCP server with no external dependencies. Directory access is dynamic and user-controlled through MCP roots protocol.

## Usage with VS Code

For quick installation, click the installation buttons below...

[![Install locally in VS Code](https://img.shields.io/badge/VS_Code-NPM-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=filesystem-of-a-down&config=%7B%22command%22%3A%22filesystem-of-a-down%22%2C%22args%22%3A%5B%22%24%7BworkspaceFolder%7D%22%5D%7D) [![Install locally in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-NPM-24bfa5?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=filesystem-of-a-down&config=%7B%22command%22%3A%22filesystem-of-a-down%22%2C%22args%22%3A%5B%22%24%7BworkspaceFolder%7D%22%5D%7D&quality=insiders)

For manual installation, you can configure the MCP server using one of these methods:

**Method 1: User Configuration (Recommended)**
Add the configuration to your user-level MCP configuration file. Open the Command Palette (`Ctrl + Shift + P`) and run `MCP: Open User Configuration`. This will open your user `mcp.json` file where you can add the server configuration.

**Method 2: Workspace Configuration**
Alternatively, you can add the configuration to a file called `.vscode/mcp.json` in your workspace. This will allow you to share the configuration with others.

> For more details about MCP configuration in VS Code, see the [official VS Code MCP documentation](https://code.visualstudio.com/docs/copilot/mcp).

**Dynamic Directory Access**: This version uses MCP roots protocol for flexible, runtime-controlled directory access. No static configuration required.

### Local Installation

```json
{
  "servers": {
    "filesystem-of-a-down": {
      "command": "filesystem-of-a-down",
      "args": ["${workspaceFolder}"]
    }
  }
}
```

## Development

To build the project locally:

```bash
npm run build
```

To run tests:

```bash
npm test
```

To start the server directly:

```bash
npm start
```

## License

This MCP server is licensed under the MIT License. This means you are free to use, modify, and distribute the software, subject to the terms and conditions of the MIT License. For more details, please see the LICENSE file in the project repository.

# Filesystem of a Down MCP Server

![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)
[![MCP Server](https://badge.mcpx.dev?type=server "MCP Server")](https://modelcontextprotocol.io)
[![MCP Server with Tools](https://badge.mcpx.dev?type=server&features=tools "MCP server with tools")](https://modelcontextprotocol.io)
[![Development Status](https://img.shields.io/badge/status-production--stable-green.svg)](https://pypi.org/project/chronos-protocol/)
[![standard-readme compliant](https://img.shields.io/badge/readme%20style-standard-brightgreen.svg?style=flat-square)](https://github.com/RichardLitt/standard-readme)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A configurable Model Context Protocol server for secure filesystem operations that absolutely **rocks**. Enables AI assistants to dynamically access and manage file system resources with runtime directory registration and selective tool activation.

## Table of Contents

- [Background](#background)
- [Install](#install)
- [Usage](#usage)
- [API](#api)
- [Contributing](#contributing)
- [License](#license)

## Background

### Model Context Protocol

The [Model Context Protocol](https://modelcontextprotocol.io) (MCP) enables AI assistants to securely access external resources and services. This server implements MCP for filesystem operations, allowing AI agents to read, write, and manage files within controlled directory boundaries.

### Key Features

This enhanced implementation provides:

- **Dynamic Directory Access**: Runtime directory registration through conversational commands
- **Directory Filtering**: Exclude unwanted folders (node_modules, dist, .git) from listings
- **Selective Tool Activation**: Enable only specific tools or tool categories
- **High Performance**: Optimized search algorithms with smart recursion detection
- **Security Controls**: Path validation and access restrictions
- **Local Control**: Full local installation with no external dependencies

### Directory Access Model

This server supports multiple flexible approaches to directory access:

1. **Pre-configured Access**: Use `--approved-folders` to specify directories on server start for immediate access
2. **Runtime Registration**: Users can instruct AI agents to register directories during conversation via `register_directory` tool
3. **MCP Roots Protocol**: Client applications can provide workspace directories dynamically
4. **Flexible Permissions**: Combine multiple approaches - start with approved folders, add more at runtime
5. **Secure Boundaries**: All operations validate against registered directories regardless of access method

## Install

This server requires Node.js and can be installed locally for full control.

```bash
npm install -g filesystem-of-a-down
```

Or install in a specific project:

```bash
npm install filesystem-of-a-down
```

### Dependencies

Requires Node.js with support for ES2022 modules. The server has no external service dependencies and operates entirely locally.

## Usage

### Basic Configuration

Add to your MCP client configuration (e.g., `claude_desktop_config.json`):

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

#### Approved Folders

Pre-configure specific directories for immediate access on server start:

**macOS/Linux:**

```json
{
  "mcpServers": {
    "filesystem-of-a-down": {
      "command": "filesystem-of-a-down",
      "args": [
        "--approved-folders",
        "/Users/username/projects,/Users/username/documents"
      ]
    }
  }
}
```

**Windows:**

```json
{
  "mcpServers": {
    "filesystem-of-a-down": {
      "command": "filesystem-of-a-down",
      "args": [
        "--approved-folders",
        "C:/Users/username/projects,C:/Users/username/documents"
      ]
    }
  }
}
```

**Path Format Note:**

- **Windows**: Include drive letter (e.g., `C:/`, `D:/`). Use forward slashes in JSON to avoid escaping backslashes.
- **macOS/Linux**: Start with `/` for absolute paths, or use `~` for home directory.

**Benefits:**

- **Instant Access**: Directories are validated and ready immediately when server starts
- **Security**: Only specified directories are accessible (unless using MCP Roots protocol)
- **Convenience**: No need to manually register directories via conversation
- **AI Visibility**: Approved directories are dynamically embedded in `register_directory` and `list_allowed_directories` tool descriptions, ensuring AI assistants can see which directories are pre-approved and avoid redundant registration attempts

**How AI Assistants See Approved Folders:**

When you configure `--approved-folders`, the server dynamically injects this information into the tool descriptions for `register_directory` and `list_allowed_directories`. This ensures:

- ✅ AI assistants can see which directories are already accessible
- ✅ AI knows NOT to re-register pre-approved directories or their subdirectories
- ✅ Clear visibility without requiring the AI to call `list_allowed_directories` first
- ✅ Works reliably across all MCP clients (including Cursor, Claude Desktop, etc.)

**Example of what AI sees in tool description:**

```
PRE-APPROVED DIRECTORIES (already accessible, DO NOT register these):
  - C:\Users\username\projects
  - C:\Users\username\documents

IMPORTANT: These directories and their subdirectories are ALREADY accessible
to all filesystem tools. Do NOT use register_directory for these paths.
```

**Notes:**

- **Paths must be absolute**: Windows requires drive letter (`C:/path`), Unix/Mac starts with `/` or `~`
- Comma-separated list of directories (no spaces unless part of path)
- Directories are validated on startup; server will exit if any path is invalid
- Works alongside runtime `register_directory` tool for additional access
- MCP Roots protocol (if used by client) will replace approved folders with workspace roots

#### Directory Filtering

Exclude specific folders from directory listings:

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

#### Tool Selection

Enable only specific tool categories:

```json
{
  "mcpServers": {
    "filesystem-of-a-down": {
      "command": "filesystem-of-a-down",
      "args": ["--enabled-tool-categories", "read,filesystem"]
    }
  }
}
```

Or enable individual tools:

```json
{
  "mcpServers": {
    "filesystem-of-a-down": {
      "command": "filesystem-of-a-down",
      "args": ["--enabled-tools", "read_file,list_directory,search_files"]
    }
  }
}
```

#### Combined Configuration

All configuration options can be combined:

**Windows Example:**

```json
{
  "mcpServers": {
    "filesystem-of-a-down": {
      "command": "filesystem-of-a-down",
      "args": [
        "--approved-folders",
        "C:/Users/username/projects,C:/Users/username/documents",
        "--ignored-folders",
        "node_modules,dist,.git",
        "--approved-commands",
        "npm,node,git,ls,pwd,cat,echo",
        "--enabled-tool-categories",
        "read,filesystem,shell",
        "--enabled-tools",
        "list_directory,search_files,register_directory,execute_shell"
      ]
    }
  }
}
```

**macOS/Linux Example:**

```json
{
  "mcpServers": {
    "filesystem-of-a-down": {
      "command": "filesystem-of-a-down",
      "args": [
        "--approved-folders",
        "/Users/username/projects,/Users/username/documents",
        "--ignored-folders",
        "node_modules,dist,.git",
        "--approved-commands",
        "npm,node,git,ls,pwd,cat,echo",
        "--enabled-tool-categories",
        "read,filesystem,shell",
        "--enabled-tools",
        "list_directory,search_files,register_directory,execute_shell"
      ]
    }
  }
}
```

### Directory Registration

To access a specific directory, instruct the AI agent:

```
"Please register the directory C:\path\to\your\folder for access, then list its contents."
```

The AI will use the `register_directory` tool to gain access, then perform operations within that directory.

## API

### Available Tools by Categories

#### Read Operations

##### read_file

Read file contents with flexible modes (full, head, tail, range)

**Input:**

- `path` (string): File path
- `mode` (string, optional): Read mode
  - `full` - Read entire file (default)
  - `head` - Read first N lines
  - `tail` - Read last N lines
  - `range` - Read arbitrary line range (e.g., lines 50-100)
- `lines` (number, optional): Number of lines for head/tail mode
- `startLine` (number, optional): Start line for range mode
- `endLine` (number, optional): End line for range mode

**Output:** File contents as text. Supports text files and documents (PDF, DOCX, PPTX, XLSX, ODT, ODP, ODS)

##### attach_image

Attach images for AI vision analysis

**Input:**

- `path` (string | string[]): Path to image file, or array of paths to attach multiple images at once

**Output:** Image content in MCP format for vision model processing. Supports PNG, JPEG, GIF, WebP, BMP, SVG

##### read_multiple_files

Batch read multiple files concurrently

**Input:**

- `files` (array): List of file objects with path and optional mode settings

**Output:** Contents of all files. Failed reads don't stop the operation

#### Write Operations

##### write_file

Create or replace file content

**Input:**

- `path` (string): File path
- `content` (string): File content (text or HTML for PDF/DOCX conversion)

**Output:** Success confirmation. Supports HTML-to-PDF/DOCX conversion with rich formatting

##### write_multiple_files

Create or replace multiple files concurrently

**Input:**

- `files` (array): List of file objects with path and content

**Output:** Status for each file. Failed writes don't stop other files

##### edit_file

Intelligent file modification with pattern matching

**Input:**

- `path` (string): File path
- `edits` (array): List of edit operations (oldText, newText)
- `dryRun` (boolean, optional): Preview changes without writing
- `matchingStrategy` (string, optional): Matching strategy
  - `exact` - Character-for-character match
  - `flexible` - Whitespace-insensitive matching
  - `fuzzy` - Token-based regex matching
  - `auto` - Try exact → flexible → fuzzy (default)

**Output:** Detailed diff with statistics showing changes made

#### Filesystem Operations

##### make_directory

Create single or multiple directories (like Unix `mkdir -p`)

**Input:**

- `paths` (string | array): Single path or array of paths

**Output:** Success confirmation. Creates parent directories recursively, idempotent

##### list_directory

List directory contents with multiple output formats

**Input:**

- `path` (string): Directory path
- `format` (string, optional): Output format
  - `simple` - Basic [DIR]/[FILE] listing (default)
  - `detailed` - With sizes, timestamps, and statistics
  - `tree` - Hierarchical text tree view
  - `json` - Structured data with full metadata
- `sortBy` (string, optional): Sort order
  - `name` - Alphabetical (default)
  - `size` - Largest first
- `excludePatterns` (array, optional): Glob patterns to exclude (e.g., `['*.log', 'temp*']`)

**Output:** Directory listing in specified format with metadata

##### move_file

Relocate or rename files and directories

**Input:**

- `source` (string): Source path
- `destination` (string): Destination path

**Output:** Success confirmation

##### file_operations

Bulk file operations (move, copy, rename)

**Input:**

- `operation` (string): Operation type
  - `move` - Relocate files
  - `copy` - Duplicate files
  - `rename` - Rename files
- `files` (array): List of source-destination pairs
- `onConflict` (string, optional): Conflict resolution
  - `skip` - Skip existing files
  - `overwrite` - Replace existing files
  - `error` - Fail on conflicts (default)

**Output:** Status for each operation. Maximum 100 files per operation

##### delete_files

Delete single or multiple files and directories

**Input:**

- `paths` (array): List of paths to delete
- `recursive` (boolean, optional): Enable recursive deletion
- `force` (boolean, optional): Force delete read-only files

**Output:** Status for each deletion. Non-recursive by default for safety

##### get_file_info

Retrieve file and directory metadata

**Input:**

- `path` (string): File or directory path

**Output:** Size, timestamps, permissions, and type information

##### register_directory

Enable runtime access to new directories

**Input:**

- `path` (string): Directory path to register

**Output:** Success confirmation. Directory becomes accessible for operations

##### list_allowed_directories

Display currently accessible directory paths

**Input:** None

**Output:** List of all allowed directories

#### Search Operations

##### glob_files

Find files using glob pattern matching

**Input:**

- `path` (string): Directory to search
- `pattern` (string): Glob pattern (e.g., `**/*.ts`)
- `excludePatterns` (array, optional): Patterns to exclude

**Output:** List of matching file paths

##### grep_files

Search for text patterns within files

**Input:**

- `pattern` (string): Regex pattern to search
- `path` (string, optional): Directory to search
- `-i` (boolean, optional): Case insensitive
- `-A/-B/-C` (number, optional): Context lines before/after matches
- `type` (string, optional): File type filter (js, py, ts, etc.)
- `output_mode` (string, optional): Output format
  - `content` - Matching lines with line numbers (default)
  - `files_with_matches` - File paths only
  - `count` - Match counts per file
- `head_limit` (number, optional): Limit results

**Output:** Matching lines with context, file paths, or match counts

#### Shell Operations

##### execute_shell

Execute shell commands with security controls

**Input:**

- `command` (string): Shell command to execute
- `description` (string, optional): Command purpose
- `workdir` (string, optional): Working directory
- `timeout` (number, optional): Timeout in milliseconds (default: 30000)

**Output:** Exit code, stdout, stderr, and execution metadata

---

For detailed usage examples, see [Tool Usage Guide](docs/TOOL_USAGE_GUIDE.md)

### Supported File Types

#### Text File Operations

**Read Tools** (`read_file`, `read_multiple_files`):

- **Text files**: Reads any file as UTF-8 encoded text (source code, configuration files, markdown, JSON, XML, CSV, logs)
- **Document files**: Automatically detects and parses:
  - **PDF** (`.pdf`) - Plain text extraction via `pdf-parse`
  - **Word** (`.docx`) - Markdown with formatting (headings, bold, lists, tables) via `mammoth`
  - **PowerPoint** (`.pptx`) - Plain text extraction via `officeparser`
  - **Excel** (`.xlsx`) - Plain text extraction via `officeparser`
  - **OpenDocument Text** (`.odt`) - Plain text extraction via `officeparser`
  - **OpenDocument Presentation** (`.odp`) - Plain text extraction via `officeparser`
  - **OpenDocument Spreadsheet** (`.ods`) - Plain text extraction via `officeparser`
- `read_file` supports four modes for text files:
  - **full**: Read entire file
  - **head**: Read first N lines
  - **tail**: Read last N lines
  - **range**: Read arbitrary line range (e.g., lines 50-100, inclusive, 1-indexed)
- `read_multiple_files` allows per-file mode specification - each file can use a different mode in a single operation
- Document files ignore mode parameters and always return full content
- Will produce garbled output for unsupported binary files (images, executables, compressed files)

**Write Tools** (`write_file`, `write_multiple_files`, `edit_file`):

- Writes UTF-8 encoded text content
- Supports HTML-to-PDF/DOCX conversion with rich formatting (headings, bold, italic, tables, lists, colors)
- Can create: Source code, configuration files, markdown, JSON, XML, CSV, text documents, formatted PDF/DOCX from HTML
- Plain text fallback for PDF/DOCX when HTML is not detected
- Cannot write binary files (no base64-to-binary conversion available)

#### Image File Operations

**Attach Image Tool** (`attach_image`):

- Attaches images for AI vision analysis (requires vision-capable MCP client)
- **Supported formats**: PNG, JPEG, GIF, WebP, BMP, SVG
- **Batch support**: Can attach single image or multiple images in one call
- Images are presented to the AI as if uploaded directly by the user
- Enables visual analysis: reading text in images, analyzing diagrams, describing scenes
- **Use cases**:
  - Analyze screenshots for debugging
  - Extract text from images (OCR-like)
  - Compare UI mockups (attach multiple screenshots at once)
  - Describe charts and graphs
  - Identify objects in photos
- Returns images in MCP standard format for client vision processing
- Only works within allowed directories

**Example Usage:**

```
# Single image
User: "Attach /screenshots/error.png and tell me what's wrong"
AI: [Analyzes image] "This screenshot shows a TypeError on line 42..."

# Multiple images at once
User: "Attach both /screenshots/before.png and /screenshots/after.png and compare them"
AI: [Analyzes both images] "The 'before' screenshot shows..., while the 'after' screenshot..."
```

**Client Compatibility:**

- ✅ Works with: Claude Desktop, Claude.ai, Cursor, ChatGPT Desktop
- ✅ Requires: MCP client with vision capabilities
- ❌ Non-vision clients will receive an error

**Note**: There is currently no write capability for binary files. You can attach images for vision analysis but cannot create or modify image files through the filesystem tools.

#### File System Operations

**File Operations Tool** (`file_operations`, `move_file`):

- Works with any file type (text or binary)
- Operations: move, copy, rename
- Handles both files and directories
- Preserves file content without modification during operations

#### File Editing

**Edit File Tool** (`edit_file`):

- Intelligent file modification with automatic matching strategies (exact → flexible → fuzzy)
- Supports multiple sequential edits in one operation
- Provides detailed diff output with statistics
- Optional preview mode (`dryRun: true`)
- Preserves indentation and line endings

### Development Setup

```bash
# Clone the repository
git clone https://github.com/n0zer0d4y/filesystem-of-a-down.git
cd filesystem-of-a-down

# Install dependencies
npm install

# Run tests
npm test

# Build the project
npm run build

# Start development server
npm start
```

### Testing

The project includes comprehensive test coverage. Run tests with:

```bash
npm test
```

## Contributing

Pull requests are not being accepted for this project.

Bug reports and feature requests are welcome through GitHub issues. Please include:

- For bugs: reproduction steps, expected vs actual behavior, environment details
- For features: clear description of what you need and your use case

Existing issues may already cover your topic, so please search first.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

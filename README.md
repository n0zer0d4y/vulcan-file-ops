# Filesystem of a Down MCP Server

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

### Available Tools

- **read_file**: Read file contents with flexible modes (full, head, tail) for efficient file access
- **read_media_file**: Process image and audio files with MIME type detection
- **read_multiple_files**: Batch file reading with error isolation
- **write_file**: Create or replace file content
- **write_multiple_files**: Create or replace multiple files concurrently
- **edit_file**: Perform intelligent file modifications with three-tier matching (exact/flexible/fuzzy) and detailed diff output
- **create_directory**: Generate directory structures with parent creation
- **list_directory**: Display directory contents with type indicators
- **list_directory_with_sizes**: Show directory contents with size information and sorting
- **directory_tree**: Generate hierarchical directory structure as JSON
- **move_file**: Relocate or rename files and directories
- **file_operations**: Perform single or bulk file operations (move, copy, rename) on multiple files and directories concurrently
- **delete_files**: Delete single or multiple files and directories with optional recursive deletion
- **glob_files**: Locate files using glob pattern matching with exclusion support
- **grep_files**: Search for text patterns within file contents with regex support and multiple output modes
- **get_file_info**: Retrieve comprehensive file and directory metadata
- **register_directory**: Enable runtime access to new directories
- **list_allowed_directories**: Display currently accessible directory paths
- **execute_shell**: Execute shell commands with security controls and approval system

### Tool Categories

- **read**: File content access operations (read_file, read_media_file, read_multiple_files)
- **write**: File modification operations (write_file, write_multiple_files, edit_file)
- **filesystem**: Directory and file system management (create_directory, list_directory, list_directory_with_sizes, directory_tree, move_file, file_operations, delete_files, get_file_info, register_directory, list_allowed_directories)
- **search**: File and content discovery operations (glob_files, grep_files)
- **shell**: Shell command execution (execute_shell)
- **all**: Complete tool set (default behavior)

### Supported File Types

#### Text File Operations

**Read Tools** (`read_file`, `read_multiple_files`):

- Reads any file as UTF-8 encoded text
- `read_file` supports three modes: full (entire file), head (first N lines), tail (last N lines)
- Best for: Source code, configuration files, markdown, JSON, XML, CSV, logs, text documents
- Will produce garbled output for binary files (images, executables, compressed files)

**Write Tools** (`write_file`, `write_multiple_files`, `edit_file`):

- Writes UTF-8 encoded text content only
- Can create: Source code, configuration files, markdown, JSON, XML, CSV, text documents
- Cannot write binary files (no base64-to-binary conversion available)

#### Binary File Operations

**Read Media Tool** (`read_media_file`):

- Returns base64-encoded data with MIME type detection
- **Supported image formats**: PNG, JPG/JPEG, GIF, WebP, BMP, SVG
- **Supported audio formats**: MP3, WAV, OGG, FLAC
- Falls back to `application/octet-stream` for other binary files
- This is the only tool that properly handles binary content

**Note**: There is currently no write capability for binary files. You can read images and audio as base64 but cannot write them back through the filesystem tools.

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

### Search Tool Usage

#### Glob Pattern Search (`glob_files`)

Use `glob_files` to find files and directories by name patterns:

```json
{
  "pattern": "**/*.ts",
  "path": "/path/to/project"
}
```

**Common patterns:**

- `*.js` - All JavaScript files in current directory
- `**/*.test.js` - All test files in all subdirectories
- `src/**/*.{ts,tsx}` - All TypeScript files in src directory

**With exclusions:**

```json
{
  "pattern": "**/*.js",
  "path": "/path/to/project",
  "excludePatterns": ["node_modules/**", "dist/**"]
}
```

#### Text Content Search (`grep_files`)

Use `grep_files` to search for text patterns within files:

**Basic search:**

```json
{
  "pattern": "TODO"
}
```

**Case-insensitive search:**

```json
{
  "pattern": "error",
  "-i": true
}
```

**Search with context lines:**

```json
{
  "pattern": "function.*test",
  "-C": 3
}
```

**Search only in specific file types:**

```json
{
  "pattern": "import.*React",
  "type": "ts"
}
```

**Output modes:**

```json
{
  "pattern": "FIXME",
  "output_mode": "files_with_matches"
}
```

**Available output modes:**

- `content` (default) - Shows matching lines with line numbers
- `files_with_matches` - Lists only file paths containing matches
- `count` - Shows match counts per file

**Limit results:**

```json
{
  "pattern": ".*",
  "head_limit": 50
}
```

#### File Deletion (`delete_files`)

Use `delete_files` to delete single or multiple files and directories:

**Delete single file:**

```json
{
  "paths": ["/path/to/file.txt"]
}
```

**Delete multiple files:**

```json
{
  "paths": ["/path/to/file1.txt", "/path/to/file2.txt", "/path/to/file3.txt"]
}
```

**Delete empty directory:**

```json
{
  "paths": ["/path/to/empty-directory"]
}
```

**Delete directory recursively:**

```json
{
  "paths": ["/path/to/directory"],
  "recursive": true
}
```

**Force delete read-only files:**

```json
{
  "paths": ["/path/to/readonly-file.txt"],
  "force": true
}
```

**Safety features:**

- Non-recursive by default (prevents accidental deletion of directory trees)
- All paths validated before any deletions occur
- Concurrent processing for performance
- Maximum 100 paths per operation
- Clear success/failure reporting for each path

#### Shell Command Execution (`execute_shell`)

Execute shell commands on the host system with comprehensive security controls.

**Parameters:**

```json
{
  "command": "npm install",
  "description": "Install project dependencies",
  "workdir": "/path/to/project",
  "timeout": 30000,
  "requiresApproval": false
}
```

- **command** (required): Shell command to execute
- **description** (optional): Brief description of command purpose
- **workdir** (optional): Working directory (must be within allowed directories)
- **timeout** (optional): Timeout in milliseconds (default: 30000)
- **requiresApproval** (optional): Flag for dangerous operations (default: false)

**Platform Behavior:**

- **Windows**: Commands executed via `powershell.exe -NoProfile -NonInteractive -Command <command>`
- **Unix/Mac**: Commands executed via `bash -c '<command>'`

**Security:**

- Command substitution patterns (`$()`, backticks, `<()`, `>()`) are blocked
- Dangerous commands require approval (rm -rf, sudo, format, kill -9, etc.)
- Working directory must be within allowed directories
- Configurable command approval system via CLI or .env file

**Configuration:**

Commands can be pre-approved via:

1. **CLI argument** (highest priority):

   ```json
   {
     "args": ["--approved-commands", "npm,node,git,ls,pwd,echo"]
   }
   ```

2. **.env file** (fallback):
   ```env
   APPROVED_COMMANDS=npm,node,git,ls,pwd,echo
   ```

**Recommended Approved Commands:**

- **Safe (read-only)**: `ls,pwd,cat,echo,head,tail,grep,find,which,type,file,stat`
- **Development**: `npm,node,git,python,pip,cargo,go,make,java,mvn`
- **System** (use with caution): `sudo,apt,yum,brew,systemctl`

**Example Result:**

```
Shell Command Execution Result:
================================

Command: npm install
Description: Install project dependencies
Working Directory: /path/to/project
Exit Code: 0
Signal: (none)

--- Standard Output ---
added 245 packages in 5.2s

--- Standard Error ---
(empty)
```

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

## License

This project is licensed under the MIT License - see the LICENSE file for details.

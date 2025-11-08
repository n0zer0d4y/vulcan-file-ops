# Vulcan File Ops MCP Server

![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)
[![MCP Badge](https://lobehub.com/badge/mcp/n0zer0d4y-vulcan-file-ops)](https://lobehub.com/mcp/n0zer0d4y-vulcan-file-ops)
[![MCP Server](https://badge.mcpx.dev?type=server "MCP Server")](https://modelcontextprotocol.io)
[![MCP Server with Tools](https://badge.mcpx.dev?type=server&features=tools "MCP server with tools")](https://modelcontextprotocol.io)
[![standard-readme compliant](https://img.shields.io/badge/readme%20style-standard-brightgreen.svg?style=flat-square)](https://github.com/RichardLitt/standard-readme)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Transform your desktop AI assistants into powerful development partners.** Vulcan File Ops bridges the gap between conversational AI (Claude Desktop, ChatGPT Desktop, etc.) and your local filesystem, unlocking the same file manipulation capabilities found in AI-powered IDEs like Cursor and Cline. Write code, refactor projects, manage documentation, and perform complex file operations—matching the power of dedicated AI coding assistants. With enterprise-grade security controls, dynamic directory registration, and intelligent tool filtering, you maintain complete control while your AI assistant handles the heavy lifting.

## Table of Contents

- [Background](#background)
- [Install](#install)
- [Usage](#usage)
- [API](#api)
  - [Read Operations](#read-operations)
    - [read_file](#read_file)
    - [attach_image](#attach_image)
    - [read_multiple_files](#read_multiple_files)
  - [Write Operations](#write-operations)
    - [write_file](#write_file)
    - [write_multiple_files](#write_multiple_files)
    - [edit_file](#edit_file)
  - [Filesystem Operations](#filesystem-operations)
    - [make_directory](#make_directory)
    - [list_directory](#list_directory)
    - [move_file](#move_file)
    - [file_operations](#file_operations)
    - [delete_files](#delete_files)
    - [get_file_info](#get_file_info)
    - [register_directory](#register_directory)
    - [list_allowed_directories](#list_allowed_directories)
  - [Search Operations](#search-operations)
    - [glob_files](#glob_files)
    - [grep_files](#grep_files)
  - [Shell Operations](#shell-operations)
    - [execute_shell](#execute_shell)
- [Security](#security)
- [Contributing](#contributing)
- [License](#license)

## Background

### Model Context Protocol

The [Model Context Protocol](https://modelcontextprotocol.io) (MCP) enables AI assistants to securely access external resources and services. This server implements MCP for filesystem operations, allowing AI agents to read, write, and manage files within controlled directory boundaries.

### Key Features

This enhanced implementation provides:

- **Dynamic Directory Access**: Runtime directory registration through conversational commands
- **Document Support**: Read/write PDF, DOCX, PPTX, XLSX, ODT with HTML-to-document conversion
- **Batch Operations**: Read, write, edit, copy, move, or rename multiple files concurrently
- **Advanced File Editing**: Pattern-based modifications with flexible matching and diff preview
- **Flexible Reading Modes**: Full file, head/tail, or arbitrary line ranges
- **Image Vision Support**: Attach images for AI analysis and description
- **Directory Filtering**: Exclude unwanted folders (node_modules, dist, .git) from listings
- **Selective Tool Activation**: Enable only specific tools or tool categories
- **High Performance**: Optimized search algorithms with smart recursion detection
- **Security Controls**: Path validation, access restrictions, and shell command approval
- **Local Control**: Full local installation with no external dependencies

### Directory Access Model

This server supports multiple flexible approaches to directory access:

1. **Pre-configured Access**: Use `--approved-folders` to specify directories on server start for immediate access
2. **Runtime Registration**: Users can instruct AI agents to register directories during conversation via `register_directory` tool
3. **MCP Roots Protocol**: Client applications can provide workspace directories dynamically
4. **Flexible Permissions**: Combine multiple approaches - start with approved folders, add more at runtime
5. **Secure Boundaries**: All operations validate against registered directories regardless of access method

## Install

This server requires Node.js and can be installed globally, locally, or run directly with npx. **Most users should use npx** for instant execution without installation.

### Quick Start (Recommended for Most Users)

Run directly without installation:

```bash
npx @n0zer0d4y/vulcan-file-ops --help
```

**For developers** who want to contribute or modify the code, see [Local Repository Execution](#option-4-local-repository-execution-for-developers) below.

### Global Installation

Install globally for system-wide access:

```bash
npm install -g @n0zer0d4y/vulcan-file-ops
```

### Local Installation

Install in a specific project:

```bash
npm install @n0zer0d4y/vulcan-file-ops
```

### Prerequisites

**Node.js** (version 14 or higher) must be installed on your system. This provides npm and npx, which are required to run this package.

- **Download Node.js**: https://nodejs.org/
- **Check installation**: Run `node --version` and `npm --version`

### Dependencies

The server has no external service dependencies and operates entirely locally. All required packages are automatically downloaded when using npx.

## Usage

This server can be used directly with npx (recommended) or installed globally/locally. The npx approach requires no installation and always uses the latest version.

### Basic Configuration

Add to your MCP client configuration (e.g., `claude_desktop_config.json`):

#### Option 1: Using npx (Recommended - No Installation Required)

```json
{
  "mcpServers": {
    "vulcan-file-ops": {
      "command": "npx",
      "args": ["@n0zer0d4y/vulcan-file-ops"]
    }
  }
}
```

#### Option 2: Using Global Installation

After running `npm install -g @n0zer0d4y/vulcan-file-ops`:

```json
{
  "mcpServers": {
    "vulcan-file-ops": {
      "command": "vulcan-file-ops"
    }
  }
}
```

#### Option 3: Using Local Installation

After running `npm install @n0zer0d4y/vulcan-file-ops` in your project:

```json
{
  "mcpServers": {
    "vulcan-file-ops": {
      "command": "./node_modules/.bin/vulcan-file-ops"
    }
  }
}
```

#### Option 4: Local Repository Execution (For Developers)

If you've cloned this repository and want to run from source:

```bash
git clone https://github.com/n0zer0d4y/vulcan-file-ops.git
cd vulcan-file-ops
npm install
npm run build
```

Then configure your MCP client:

```json
{
  "mcpServers": {
    "vulcan-file-ops": {
      "command": "vulcan-file-ops",
      "args": ["--approved-folders", "/path/to/your/allowed/directories"]
    }
  }
}
```

**Note:** The `vulcan-file-ops` command will be available in your PATH after building, or you can use the full path: `./dist/cli.js`

### Advanced Configuration

#### Approved Folders

Pre-configure specific directories for immediate access on server start:

**macOS/Linux (npx):**

```json
{
  "mcpServers": {
    "vulcan-file-ops": {
      "command": "npx",
      "args": [
        "@n0zer0d4y/vulcan-file-ops",
        "--approved-folders",
        "/Users/username/projects,/Users/username/documents"
      ]
    }
  }
}
```

**Windows (npx):**

```json
{
  "mcpServers": {
    "vulcan-file-ops": {
      "command": "npx",
      "args": [
        "@n0zer0d4y/vulcan-file-ops",
        "--approved-folders",
        "C:/Users/username/projects,C:/Users/username/documents"
      ]
    }
  }
}
```

**Alternative: Local Repository Execution**

For users running from a cloned repository (after `npm run build`):

```json
{
  "mcpServers": {
    "vulcan-file-ops": {
      "command": "vulcan-file-ops",
      "args": [
        "--approved-folders",
        "/Users/username/projects,/Users/username/documents"
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
    "vulcan-file-ops": {
      "command": "npx",
      "args": [
        "@n0zer0d4y/vulcan-file-ops",
        "--ignored-folders",
        "node_modules,dist,.git,.next"
      ]
    }
  }
}
```

#### Tool Selection

Enable only specific tool categories:

```json
{
  "mcpServers": {
    "vulcan-file-ops": {
      "command": "npx",
      "args": [
        "@n0zer0d4y/vulcan-file-ops",
        "--enabled-tool-categories",
        "read,filesystem"
      ]
    }
  }
}
```

Or enable individual tools:

```json
{
  "mcpServers": {
    "vulcan-file-ops": {
      "command": "npx",
      "args": [
        "@n0zer0d4y/vulcan-file-ops",
        "--enabled-tools",
        "read_file,list_directory,grep_files"
      ]
    }
  }
}
```

#### Combined Configuration

All configuration options can be combined:

**Windows Example (npx):**

```json
{
  "mcpServers": {
    "vulcan-file-ops": {
      "command": "npx",
      "args": [
        "@n0zer0d4y/vulcan-file-ops",
        "--approved-folders",
        "C:/Users/username/projects,C:/Users/username/documents",
        "--ignored-folders",
        "node_modules,dist,.git",
        "--approved-commands",
        "npm,node,git,ls,pwd,cat,echo",
        "--enabled-tool-categories",
        "read,filesystem,shell",
        "--enabled-tools",
        "read_file,attach_image,read_multiple_files,write_file,write_multiple_files,edit_file,make_directory,list_directory,move_file,file_operations,delete_files,get_file_info,register_directory,list_allowed_directories,glob_files,grep_files,execute_shell"
      ]
    }
  }
}
```

**macOS/Linux Example (npx):**

```json
{
  "mcpServers": {
    "vulcan-file-ops": {
      "command": "npx",
      "args": [
        "@n0zer0d4y/vulcan-file-ops",
        "--approved-folders",
        "/Users/username/projects,/Users/username/documents",
        "--ignored-folders",
        "node_modules,dist,.git",
        "--approved-commands",
        "npm,node,git,ls,pwd,cat,echo",
        "--enabled-tool-categories",
        "read,filesystem,shell",
        "--enabled-tools",
        "read_file,attach_image,read_multiple_files,write_file,write_multiple_files,edit_file,make_directory,list_directory,move_file,file_operations,delete_files,get_file_info,register_directory,list_allowed_directories,glob_files,grep_files,execute_shell"
      ]
    }
  }
}
```

**Alternative: Local Repository Execution**

For users running from a cloned repository (after `npm run build`):

```json
{
  "mcpServers": {
    "vulcan-file-ops": {
      "command": "vulcan-file-ops",
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
        "read_file,attach_image,read_multiple_files,write_file,write_multiple_files,edit_file,make_directory,list_directory,move_file,file_operations,delete_files,get_file_info,register_directory,list_allowed_directories,glob_files,grep_files,execute_shell"
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

Apply precise modifications to text and code files with intelligent matching. Supports both single-file and multi-file operations.

**Single File Input (mode: 'single'):**

- `mode` (string, optional): Set to `"single"` (default if omitted for backward compatibility)
- `path` (string): File path
- `edits` (array): List of edit operations, each containing:
  - `oldText` (string): Text to search for (include 3-5 lines of context)
  - `newText` (string): Text to replace with
  - `instruction` (string, optional): Description of what this edit does
  - `expectedOccurrences` (number, optional): Expected match count (default: 1)
- `matchingStrategy` (string, optional): Matching strategy
  - `exact` - Character-for-character match (fastest, safest)
  - `flexible` - Whitespace-insensitive matching, preserves indentation
  - `fuzzy` - Token-based regex matching (most permissive)
  - `auto` - Try exact → flexible → fuzzy (default)
- `dryRun` (boolean, optional): Preview changes without writing (default: false)
- `failOnAmbiguous` (boolean, optional): Fail when matches are ambiguous (default: true)

**Multi-File Input (mode: 'multiple'):**

- `mode` (string): Set to `"multiple"`
- `files` (array): Array of file edit requests (max 50), each containing:
  - `path` (string): File path
  - `edits` (array): List of edit operations for this file (same structure as above)
  - `matchingStrategy` (string, optional): Per-file matching strategy
  - `dryRun` (boolean, optional): Per-file dry-run mode
  - `failOnAmbiguous` (boolean, optional): Per-file ambiguity handling
- `failFast` (boolean, optional): Stop on first failure with rollback (true, default) or continue (false)

**Features:**

- Concurrent processing for multi-file operations
- Atomic operations with automatic rollback on failure (when failFast: true)
- Cross-platform line ending preservation
- Detailed diff output with statistics

**Output:** Detailed diff with statistics. For multi-file operations, includes per-file results and summary statistics with rollback information for atomic operations.

**Important:** Use actual newline characters in oldText/newText, NOT escape sequences like `\n`.

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
- `workdir` (string, optional): Working directory (must be within allowed directories)
- `timeout` (number, optional): Timeout in milliseconds (default: 30000)

**Output:** Exit code, stdout, stderr, and execution metadata

**Security:** All file/directory paths in command arguments are automatically extracted and validated against allowed directories. Commands referencing paths outside approved directories are blocked, preventing directory restriction bypasses.

### Multi-File Edit Examples

**Batch refactor across multiple files:**

```typescript
{
  files: [
    {
      path: "src/utils.ts",
      edits: [{
        instruction: "Update deprecated function call",
        oldText: "oldApi.getData()",
        newText: "newApi.fetchData()"
      }]
    },
    {
      path: "src/components/Button.tsx",
      edits: [{
        instruction: "Update component prop",
        oldText: "onClick={oldHandler}",
        newText: "onClick={newHandler}"
      }]
    },
    {
      path: "src/hooks/useData.ts",
      edits: [{
        instruction: "Update hook implementation",
        oldText: "const data = oldApi.getData()",
        newText: "const data = newApi.fetchData()"
      }]
    }
  ],
  failFast: true  // Atomic operation - rollback all if any fails
}
```

**Per-file configuration:**

```typescript
{
  files: [
    {
      path: "config.json",
      edits: [{
        oldText: '"version": "1.0.0"',
        newText: '"version": "1.1.0"'
      }],
      matchingStrategy: "exact"  // JSON needs exact matches
    },
    {
      path: "src/app.py",
      edits: [{
        oldText: "def old_function():",
        newText: "def new_function():"
      }],
      matchingStrategy: "flexible"  // Python indentation may vary
    },
    {
      path: "README.md",
      edits: [{
        oldText: "## Old Section",
        newText: "## New Section"
      }],
      matchingStrategy: "auto"  // Let AI decide best strategy
    }
  ],
  failFast: false  // Continue even if some files fail
}
```

---

For detailed usage examples, see [Tool Usage Guide](docs/TOOL_USAGE_GUIDE.md)

## Security

This MCP server implements enterprise-grade security controls to protect against common filesystem vulnerabilities. All security measures are based on industry best practices and address known CVE patterns.

### Protected Against

#### Path Traversal & Directory Bypass (CWE-22)

- **Protected Pattern**: CVE-2025-54794 / CVE-2025-53110
- **Mitigation**: Canonical path validation with path separator requirements prevents prefix collision attacks
- **Implementation**: Uses `isPathWithinAllowedDirectories()` which requires actual subdirectory paths (not just prefix matches)
- **Example**: Blocks `/path/to/allowed_evil` when `/path/to/allowed` is approved

#### Command Injection (CWE-78)

- **Protected Pattern**: CVE-2025-54795
- **Mitigation**: Multi-layer validation including command substitution detection, root command extraction, and dangerous pattern matching
- **Implementation**: Blocks `$()`, `` ` ` ``, `>()`, `<()` patterns; validates all commands in chains; requires approval for dangerous operations
- **Example**: Prevents `echo "; malicious_cmd; echo"` injection attempts

#### Shell Command Directory Bypass (CWE-22)

- **Protected Pattern**: Path restriction bypass via absolute paths in shell commands
- **Mitigation**: Path extraction and validation for all file/directory paths embedded in command arguments
- **Implementation**: Extracts paths from command strings (handles Windows/Unix paths, quotes, relative paths, environment variables), validates each path against allowed directories before execution
- **Example**: Blocks `type C:\Windows\System32\drivers\etc\hosts` and `cat /etc/passwd` when these paths are outside approved directories
- **Scope**: Applies to all shell commands executed via `execute_shell` tool - paths in arguments are validated just like filesystem operations

#### Symlink Attacks (CWE-59 / CWE-61)

- **Protected Pattern**: CVE-2025-53109
- **Mitigation**: All paths resolved via `realpath()` before validation to follow symlinks to actual targets
- **Implementation**: Symlink targets must be within allowed directories; validates parent directories for new files
- **Example**: Blocks symlinks pointing to `/etc/passwd` even if symlink is in allowed directory

#### Directory Traversal

- **Mitigation**: Strict path normalization and validation against approved directories only
- **Implementation**: Rejects `../` traversal attempts; validates parent directories before file creation
- **Example**: Blocks access to `/unauthorized/path` regardless of traversal attempts

### Security Controls

#### Path Validation

- **Canonical Path Resolution**: All paths normalized and resolved before validation
- **Separator Requirement**: Subdirectories must include path separators (prevents prefix collision)
- **Realpath Resolution**: Symlinks resolved to actual targets before access checks
- **Parent Directory Validation**: New file creation validates parent directory is within allowed scope

#### Command Execution

- **Command Whitelisting**: Only pre-approved commands execute without confirmation
- **Pattern Detection**: Blocks dangerous patterns (destructive, privilege escalation, network execution)
- **Command Substitution Blocking**: Prevents `$()`, backticks, process substitution
- **Root Command Extraction**: Analyzes all commands in chained operations for approval
- **Path Argument Validation**: Extracts and validates all file/directory paths in command arguments against allowed directories (prevents bypass via absolute paths in commands)

#### Access Controls

- **Directory Whitelisting**: Operations restricted to explicitly approved directories
- **Runtime Registration**: Additional directories require explicit registration via `register_directory` tool
- **Atomic Validation**: Paths validated before any file operations begin
- **Cross-Platform Safety**: Proper handling of Windows/Unix path differences and UNC paths

### Security Best Practices

1. **Minimize Approved Directories**: Only approve directories that require AI access
2. **Use Directory Filtering**: Exclude sensitive folders (e.g., `.git`, `node_modules`) from listings
3. **Limit Tool Access**: Enable only necessary tools via `--enabled-tools` or `--enabled-tool-categories`
4. **Command Approval**: Pre-approve safe commands via `--approved-commands`; require approval for others
5. **Monitor Operations**: Review MCP client logs for unexpected access attempts
6. **Regular Updates**: Keep the server updated to receive security patches

### Security Audit

This server has been audited against known vulnerabilities:

- ✅ CVE-2025-54794 (Path Restriction Bypass) - **FIXED**
- ✅ CVE-2025-54795 (Command Injection) - **PROTECTED**
- ✅ CVE-2025-53109 (Symlink Attacks) - **PROTECTED**
- ✅ CVE-2025-53110 (Directory Containment Bypass) - **PROTECTED**

For detailed security analysis, see [Vulnerability Research Findings](docs/VULNERABILITY_RESEARCH_FINDINGS.md).

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
git clone https://github.com/n0zer0d4y/vulcan-file-ops.git
cd vulcan-file-ops

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

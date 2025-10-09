# Filesystem of a Down MCP Server

[![MCP Server](https://badge.mcpx.dev?type=server&features=tools)](https://modelcontextprotocol.io)
[![MCP](https://badge.mcpx.dev)](https://modelcontextprotocol.io)

A configurable Model Context Protocol server for secure filesystem operations. Enables AI assistants to dynamically access and manage file system resources with runtime directory registration and selective tool activation.

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

Unlike traditional static configurations, this server enables dynamic directory access through:

1. **Runtime Registration**: Users can instruct AI agents to register directories during conversation
2. **Flexible Permissions**: Access any directory by registering it first
3. **Secure Boundaries**: All operations validate against registered directories
4. **No Pre-configuration**: Start with minimal setup, expand access as needed

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

```json
{
  "mcpServers": {
    "filesystem-of-a-down": {
      "command": "filesystem-of-a-down",
      "args": [
        "--ignored-folders",
        "node_modules,dist,.git",
        "--enabled-tool-categories",
        "read",
        "--enabled-tools",
        "list_directory,search_files"
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

- **read_file**: Retrieve complete file content as text or binary data
- **read_text_file**: Access file content with optional line range selection
- **read_media_file**: Process image and audio files with MIME type detection
- **read_multiple_files**: Batch file reading with error isolation
- **write_file**: Create or replace file content
- **edit_file**: Perform precise text modifications with diff output
- **create_directory**: Generate directory structures with parent creation
- **list_directory**: Display directory contents with type indicators
- **list_directory_with_sizes**: Show directory contents with size information and sorting
- **directory_tree**: Generate hierarchical directory structure as JSON
- **move_file**: Relocate or rename files and directories
- **search_files**: Locate files using pattern matching with exclusion support
- **get_file_info**: Retrieve comprehensive file and directory metadata
- **register_directory**: Enable runtime access to new directories
- **list_allowed_directories**: Display currently accessible directory paths

### Tool Categories

- **read**: File content access operations (read_file, read_text_file, read_media_file, read_multiple_files)
- **write**: File modification operations (write_file, edit_file)
- **filesystem**: Directory and file system management (create_directory, list_directory, list_directory_with_sizes, directory_tree, move_file, get_file_info, register_directory, list_allowed_directories)
- **search**: File discovery operations (search_files)
- **all**: Complete tool set (default behavior)

## Contributing

This project welcomes contributions. To contribute:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass
6. Submit a pull request

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

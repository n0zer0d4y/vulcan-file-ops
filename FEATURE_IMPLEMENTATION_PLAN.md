# Filesystem of a Down MCP Server - Feature Implementation Plan

## Overview

This document outlines the implementation plan for two new features requested for the Filesystem of a Down MCP Server v1.0.0:

1. **Directory Ignore Patterns** - Exclude specific folders (like `node_modules`, `dist`) from directory listings
2. **Selective Tool Activation** - Enable/disable specific tools based on configuration

## Current Architecture Analysis

### Core Components

- **Server**: `src/server/index.ts` - Main MCP server setup and tool registration
- **Tools**: `src/tools/` - Modular tool implementations (read, write, filesystem, search)
- **Utils**: `src/utils/` - Core utilities and security functions
- **Types**: `src/types/` - Schema definitions and type safety
- **CLI**: `src/cli.ts` - Command-line interface entry point

### Current Tool Registration

- All tools are registered unconditionally in `ListToolsRequestSchema` handler
- No configuration-based filtering exists
- Directory listing tools don't support ignore patterns

---

## Feature 1: Directory Ignore Patterns

### Problem Statement

When using `list_directory`, `list_directory_with_sizes`, and other directory listing tools in Node.js projects, folders like `node_modules` (potentially thousands of files) and `dist` folders are included, making the output overwhelming and slow.

### Proposed Solution

Add an `ignoredFolders` configuration option that can be passed via MCP JSON schema arguments, which will be applied globally to all directory listing operations.

### Implementation Details

#### 1. Configuration Schema Extension

**File:** `src/types/index.ts`

- Add `ignoredFolders` to configuration schema
- Define validation rules for folder patterns

#### 2. Server Configuration Parsing

**File:** `src/server/index.ts`

- Parse `--ignored-folders` command line argument
- Store ignored folders globally (similar to allowed directories)
- Make available to all directory listing tools

#### 3. Directory Listing Tool Updates

**File:** `src/tools/filesystem-tools.ts`

- Update `list_directory` and `list_directory_with_sizes` to filter out ignored folders
- Add utility function to check if folder should be ignored
- Maintain existing functionality for explicit path requests

#### 4. Pattern Matching

**File:** `src/utils/lib.ts`

- Add `shouldIgnoreFolder()` utility function
- Support glob patterns for flexible matching
- Use existing `minimatch` dependency

### MCP JSON Schema Configuration

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

### Command Line Usage

```bash
filesystem-of-a-down --ignored-folders "node_modules,dist,.git"
```

---

## Feature 2: Selective Tool Activation

### Problem Statement

All 15 tools are currently active simultaneously, which may be overwhelming. Users may only need specific tools for their use case (e.g., read-only operations vs. full file manipulation).

### Proposed Solution

Add an `enabledTools` configuration option that allows specifying which tools should be active, improving performance and reducing UI clutter.

### Implementation Details

#### 1. Tool Registry System

**File:** `src/server/index.ts`

- Create `TOOL_REGISTRY` mapping tool names to their getter functions
- Implement tool filtering based on configuration

#### 2. Configuration Schema Extension

**File:** `src/types/index.ts`

- Add `enabledTools` to configuration schema
- Define validation for tool name arrays
- Support "all" as default value

#### 3. Dynamic Tool Registration

**File:** `src/server/index.ts`

- Modify `ListToolsRequestSchema` handler to filter tools based on configuration
- Update tool call routing to only allow enabled tools
- Add validation to prevent calling disabled tools

#### 4. Tool Categories

Define logical tool groupings for easier configuration:

- **read**: `read_file`, `read_text_file`, `read_media_file`, `read_multiple_files`
- **write**: `write_file`, `edit_file`
- **filesystem**: `create_directory`, `list_directory`, `list_directory_with_sizes`, `directory_tree`, `move_file`, `get_file_info`, `register_directory`, `list_allowed_directories`
- **search**: `search_files`

### MCP JSON Schema Configuration

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

### Command Line Usage

```bash
filesystem-of-a-down --enabled-tools "read,filesystem,search"
```

---

## Implementation Phases

### Phase 1: Directory Ignore Patterns

1. Extend configuration schema with `ignoredFolders`
2. Update server argument parsing
3. Modify directory listing tools to respect ignore patterns
4. Add pattern matching utility
5. Update documentation and examples

### Phase 2: Selective Tool Activation

1. Create tool registry system
2. Extend configuration schema with `enabledTools`
3. Implement dynamic tool filtering
4. Update tool call routing
5. Add tool category documentation

### Phase 3: Integration and Testing

1. Combine both features
2. Comprehensive testing of all combinations
3. Update README with examples
4. Performance testing with large directories

---

## Backward Compatibility

### Directory Ignore Patterns

- **Default behavior**: No folders ignored (current behavior)
- **Opt-in**: Only applies when `--ignored-folders` is specified
- **No breaking changes**: Existing usage continues to work

### Selective Tool Activation

- **Default behavior**: All tools enabled (current behavior)
- **Opt-in**: Only applies when `--enabled-tools` is specified
- **No breaking changes**: Existing configurations continue to work

---

## Technical Considerations

### Performance Impact

- **Directory filtering**: Minimal - filtering happens during directory reading
- **Tool filtering**: Minimal - registry lookup only
- **Memory usage**: Negligible additional overhead

### Security Implications

- **Directory ignoring**: No security impact - purely UI/filtering feature
- **Tool disabling**: Improves security by reducing attack surface when tools aren't needed

### Error Handling

- **Invalid ignore patterns**: Log warnings but continue with valid patterns
- **Invalid tool names**: Log warnings and enable valid tools
- **Empty configurations**: Fall back to default behavior

---

## Testing Strategy

### Unit Tests

- Test ignore pattern matching
- Test tool filtering logic
- Test configuration parsing

### Integration Tests

- Test full MCP server with various configurations
- Test directory listing with ignore patterns
- Test tool availability with selective activation

### Performance Tests

- Large directory listing with ignore patterns
- Tool registration overhead
- Memory usage with different configurations

---

## Documentation Updates

### README.md Changes

- Add configuration examples for both features
- Document all command-line options
- Add tool categories and descriptions
- Include performance recommendations

### Help Text Updates

- Update CLI help text to include new options
- Add examples for common use cases

---

## Migration Path

### For Existing Users

- No action required - features are opt-in
- Existing MCP configurations continue to work
- Performance remains unchanged

### For New Users

- Can immediately use ignore patterns for better UX
- Can selectively enable only needed tools
- Improved performance and reduced clutter

---

## Conclusion

These features will significantly improve the user experience by:

1. **Reducing clutter** in directory listings by hiding unwanted folders
2. **Improving performance** by avoiding unnecessary file operations
3. **Customizing the tool set** based on specific use cases
4. **Maintaining backward compatibility** while adding powerful new options

The implementation will be modular, well-tested, and thoroughly documented.

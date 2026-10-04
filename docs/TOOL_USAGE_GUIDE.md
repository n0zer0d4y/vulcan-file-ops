# Tool Usage Guide

This guide provides detailed technical examples for using the filesystem-of-a-down MCP server tools.

## Search Tool Usage

### Glob Pattern Search (`glob_files`)

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

### Text Content Search (`grep_files`)

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

**Filter by glob:**

```json
{
  "pattern": "TODO",
  "glob": "*.md"
}
```

A glob without a slash (`*.md`) matches file names at any depth, like ripgrep. A glob with a slash (`src/**/*.ts`) is matched against the path relative to the search root.

Regular expressions run with a time limit (5 s per file, 30 s per search). A pattern that causes catastrophic backtracking fails with a timeout error instead of freezing the server. Patterns are limited to 1,000 characters.

### File Deletion (`delete_files`)

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

### Shell Command Execution (`execute_shell`)

Execute shell commands on the host system with comprehensive security controls.

**Parameters:**

```json
{
  "command": "npm install",
  "description": "Install project dependencies",
  "workdir": "/path/to/project",
  "timeout": 30000
}
```

- **command** (required): Shell command to execute
- **description** (optional): Brief description of command purpose
- **workdir** (optional): Working directory (must be within allowed directories)
- **timeout** (optional): Timeout in milliseconds (default: 30000)
- **requiresApproval** (optional): Deprecated and ignored; dangerous commands can only be allowed by the server operator (`--allow-dangerous-commands`)

**Platform Behavior:**

- **Windows**: Commands executed via `powershell.exe -NoProfile -NonInteractive -Command <command>`
- **Unix/Mac**: Commands executed via `bash -c '<command>'`

**Security:**

- Command substitution, backticks, newlines, a lone `&`, `( )`/`{ }` grouping, heredocs and escaped quotes are rejected
- Every command in a chain must be approved
- Dangerous commands (rm -rf, sudo, format C:, kill -9, etc.) are blocked unless the operator allows them with `--allow-dangerous-commands`
- Working directory must be within allowed directories
- File operands, option values and redirection targets are validated against allowed directories (symlinks resolved)
- `execute_shell` is not a sandbox: approved interpreters (`node`, `python`, `bash`, ...) can run arbitrary code

**Configuration:**

Commands can be pre-approved via:

1. **CLI argument** (highest priority):

   ```json
   {
     "args": ["--approved-commands", "npm,node,git,ls,pwd,echo"]
   }
   ```

2. **Commands env file** (fallback, `--commands-env-file <path>`): only the `APPROVED_COMMANDS` key is read, and nothing is added to the environment. Since 1.3.0 the server no longer reads `.env` from its working directory.
   ```env
   APPROVED_COMMANDS=npm,node,git,ls,pwd,echo
   ```

**Recommended Approved Commands:**

- **Safe (read-only)**: `ls,pwd,cat,echo,head,tail,grep,find,which,type,file,stat`
- **Development**: `npm,node,git,python,pip,cargo,go,make,java,mvn`
- **System** (use with caution): `sudo,apt,yum,brew,systemctl`
- **Avoid**: shells and evaluators (`bash`, `sh`, `powershell`, `pwsh`, `cmd`, `eval`), which bypass command restrictions

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

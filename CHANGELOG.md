# Changelog

All notable changes to this project will be documented in this file.


The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),

and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).



## [1.2.14] - 2026-05-16

### Fixed

- **CRITICAL**: Fixed initialization deadlock with `claude-ai` v0.1.0 client (Claude Desktop web client, protocol `2025-11-25`).
  - **Root Cause**: A custom `setRequestHandler(InitializeRequestSchema, ...)` was overriding the SDK's internal `_oninitialize` handler. This broke the SDK's state machine: `_clientCapabilities` and `_clientVersion` were never set, and protocol version negotiation was bypassed — the server echoed back the client's requested version verbatim rather than responding with the highest version it actually supports. The new client's stricter handshake exposed this latent defect.
  - **Fix**: Removed the custom initialize handler and restored the SDK's built-in `_oninitialize`. The server now correctly negotiates `2025-06-18` when a client requests `2025-11-25`, which the client accepts per the MCP spec.
  - **Instructions**: Server instructions (`generateServerDescription()`) are now injected into the SDK's `_instructions` field after directory initialization in `runServer()`, so they remain present in the initialize response without requiring a custom handler.
- Fixed `oninitialized` callback blocking the MCP handshake. The `listRoots()` call inside `oninitialized` was previously awaited, creating a potential deadlock (client won't respond to `roots/list` until after `initialized` is acknowledged, but the callback blocked acknowledgement). Changed to a detached fire-and-forget promise.

## [1.2.13] - 2026-04-23

### Fixed

- Resolved the remaining MCP client tool discovery failure introduced after the SDK upgrade.
  - Tool schemas exposed through `tools/list` are now normalized for stricter MCP clients.
  - Removed client-hostile schema constructs from published tool input schemas, including `$schema`, `$ref`, `anyOf`, `oneOf`, and `allOf`.
  - Replaced the highest-risk wire schemas with explicit compatibility-first object schemas for `attach_image` and `make_directory`.
  - Preserved runtime backward compatibility while tightening the schemas advertised to clients.
- Fixed residual MCP mode detection drift so stdio mode is triggered reliably in local and `npx` execution paths.
- Added `zod` as a direct runtime dependency to avoid install-time fragility in clean environments and `npx` usage.
- Synchronized package metadata so published registry metadata and local package metadata report the same release version.
- Re-enabled and stabilized the previously skipped PDF-related Jest coverage.
  - Enabled the 10 skipped document tests for PDF read, HTML-to-PDF write, mixed document batches, and PDF round-trip paths.
  - Updated Jest PDF mocks so document tests exercise meaningful content paths instead of placeholder-only buffers.
  - Suppressed expected negative-path test diagnostics inside tests so successful runs no longer look like runtime failures.
- Added a regression test to prevent incompatible tool schema shapes from reappearing in future releases.

### Changed

- Documented the Codex-specific MCP configuration format in the README alongside the JSON-based client examples.
- Updated `npx` examples to use `-y` explicitly for non-interactive client execution.

## [1.2.12] - 2026-02-21

### Fixed

- **CRITICAL**: Fixed MCP server toggle failure and "no tools configured" error caused by Node.js version incompatibility and restrictive MCP detection.
  - **Node.js Compatibility**: Replaced `import ... with { type: "json" }` with manual `fs.readFileSync` for `package.json` to support Node.js versions earlier than 20.10.0 and 18.20.0 (including Node 14/16).
  - **Robust MCP Detection**: Changed TTY detection from AND to OR logic. The server now enters MCP mode (suppressing console output) if *either* stdin or stdout is redirected, improving reliability on Windows when run via `npx`.
  - **Silenced Dotenv**: Added `quiet: true` to `dotenv.config()` to prevent any leakage into the protocol stream.
- See `local_docs/RCA-MCP-Toggle-Failure-Node-Compatibility-2026-02-21.md` for full details.

## [1.2.11] - 2026-02-21

### Fixed

- **CRITICAL**: Fixed MCP server toggle failure and "no tools configured" error in Claude Desktop and Cursor.
  - **Root Cause**: ES Module execution order caused `parseArguments()` to run before console suppression logic. This allowed warning messages to be emitted to the protocol stream, corrupting JSON-RPC communication.
  - **Solution**: Moved console suppression to the absolute top of `server/index.ts` and deferred argument parsing to the `runServer()` function.
  - Improved MCP mode detection to exclude `--help` and `--version` flags.
- See `local_docs/RCA-MCP-Toggle-Failure-Stdout-Pollution-2026-02-21.md` for full details.

## [1.2.10] - 2026-01-31

### Fixed

- **CRITICAL**: Fixed MCP server toggle failure in Claude Desktop caused by capability mismatch
  - **Root Cause**: Server declared `resources: {}` and `prompts: {}` capabilities but had NO handlers for `resources/list` and `prompts/list` methods
  - Claude Desktop calls these methods after initialization, receives "Method not found" (-32601) errors, and fails to enable the server toggle
  - **Solution**: Removed `resources` and `prompts` capability declarations from both Server constructor and initialize response
  - Per MCP specification: A server MUST NOT declare capabilities for features it does not implement
  - This bug was originally fixed in v1.2.3 but was reintroduced in v1.2.8 when code was restored to v1.2.1 baseline
- See `local_docs/RCA-Claude-Desktop-MCP-Capability-Mismatch-2026-01-31.md` for complete root cause analysis

### Changed

- Server now only declares `tools` capability (which is fully implemented)
- Removed unused capability declarations that caused protocol compliance issues

### References

- [MCPcat Guide: Fix MCP Error -32601](https://mcpcat.io/guides/fixing-method-not-found-32601-error/)
- MCP Protocol Specification: Capability declaration requirements

## [1.2.9] - 2026-01-31

### Fixed

- **CRITICAL**: Fixed protocol version negotiation causing Claude Desktop connection failures
  - Server now returns the protocol version requested by the client instead of hardcoded `LATEST_PROTOCOL_VERSION`
  - Claude Desktop requests `2025-06-18` but previous versions returned `2025-11-25`, causing immediate disconnection
  - This fix ensures compatibility with all MCP clients regardless of their supported protocol version

### Changed

- Protocol version in initialize response now mirrors client's requested version
- Added documentation comments explaining protocol version negotiation requirements

## [1.2.8] - 2026-01-31

### Changed

- Restored source code to working v1.2.1 baseline
- Downgraded `@modelcontextprotocol/sdk` from `^1.25.2` to `1.20.0` for stability
- Removed experimental console suppression changes that caused issues

### Notes

- This release reverts problematic changes while maintaining SDK 1.20.0 compatibility

## [1.2.7] - 2026-01-31

### Fixed

- Downgraded `@modelcontextprotocol/sdk` to `1.20.0` to resolve Claude Desktop compatibility issues
- SDK 1.25.x introduced breaking changes in stdio transport and protocol handling

### Changed

- Locked SDK version to exact `1.20.0` (removed caret range)

## [1.2.6] - 2026-01-31

### Fixed

- Silenced dotenv debug output that was polluting stdout and corrupting MCP JSON-RPC protocol
  - Added `quiet: true` option to `dotenv.config()` call
- Improved MCP mode detection logic
  - Changed TTY detection from AND to OR logic: now triggers MCP mode if EITHER stdin OR stdout is piped
  - This fixes edge cases where different shells/platforms report TTY status inconsistently

### Changed

- Console suppression now activates when any standard stream is piped, not just when both are piped

## [1.2.5] - 2026-01-31

### Fixed

- **CRITICAL**: Fixed ES Module execution order bug causing stdout pollution in MCP mode
  - Console suppression code in `cli.ts` was ineffective due to ES Module static import hoisting
  - Child modules (including `server/index.ts`) were evaluated BEFORE parent module's top-level code
  - Moved console suppression to the top of `server/index.ts` before any imports
  - Deferred `parseArguments()` call from module-level to inside `runServer()` function
  - Added `--help` and `--version` flag detection to preserve CLI functionality
- See `local_docs/RCA-Claude-Desktop-MCP-Toggle-Failure-2026-01-31.md` for complete root cause analysis

### Changed

- MCP mode detection now excludes `--help` and `--version` flags to allow CLI usage
- Reorganized initialization sequence to ensure console suppression happens before any potential output

## [1.2.4] - 2026-01-21

### Fixed

- **CRITICAL**: Fixed MCP server connection failure in Claude Desktop caused by protocol version mismatch
  - MCP SDK 1.25.2 returns protocol version `2025-11-25` but Claude Desktop only supports `2025-06-18`
  - Hardcoded protocol version to `2025-06-18` in initialize response for maximum client compatibility
  - Server now successfully connects and maintains connection with Claude Desktop
  - Cursor IDE and other modern MCP clients continue to work normally
  - See `local_docs/RCA-Claude-Desktop-MCP-Connection-Failure-2026-01-21.md` for complete root cause analysis

### Changed

- Server initialization now explicitly uses protocol version `2025-06-18` instead of `LATEST_PROTOCOL_VERSION`
- Added detailed comments explaining protocol version compatibility requirements

### ⚠️ **User Impact Notice**

**This version resolves the persistent "Server transport closed unexpectedly" error in Claude Desktop.**

If you're still experiencing connection issues after upgrading to 1.2.4:
1. **Restart Claude Desktop completely** (not just refresh)
2. **Clear npm cache**: Run `npm cache clean --force`
3. **Verify version**: Ensure `vulcan-file-ops` version shows 1.2.4 in logs
4. **Check MCP configuration**: Ensure no cached versions in `node_modules`

## [1.2.3] - 2026-01-17

### Fixed

- **CRITICAL**: Fixed MCP server connection failure in Claude Desktop caused by unsupported capability declarations
  - Removed empty `resources: {}` and `prompts: {}` capability declarations from server initialization
  - Server was declaring capabilities it didn't implement, causing "Method not found" errors for `resources/list` and `prompts/list`
  - Post-MCP SDK upgrade compatibility fix: MCP protocol now strictly enforces that declared capabilities must have corresponding handlers
  - Claude Desktop can now successfully connect and initialize the server without errors

### Changed

- Server capabilities now only declare supported features (tools only)
- Improved MCP protocol compliance by removing unsupported capability declarations

### ⚠️ **User Impact Notice**

**Existing users may experience continued connection issues** due to MCP client caching. To resolve:

1. **Clear MCP client cache** (Claude Desktop: delete cache folder and restart)
2. **Force latest version**: Use `@latest` in MCP configuration: `"args": ["@n0zer0d4y/vulcan-file-ops@latest"]`
3. **Clear npm cache**: Run `npm cache clean --force` before restarting MCP client

**New installations are unaffected** and will work immediately with version 1.2.3.

## [1.2.2] - 2026-01-17

### Changed

- Upgraded `@modelcontextprotocol/sdk` to `^1.25.2`
- Applied safe dependency updates (patch/minor within existing major versions) including:
  - `diff` to `^8.0.3`
  - `html-to-pdfmake` to `^2.5.32`
  - `jsdom` to `^27.4.0`
  - `minimatch` to `^10.1.1`
  - `pdf-parse` to `^2.4.5`
  - `zod-to-json-schema` to `^3.25.1`

### Notes

- `npm audit fix --force` was intentionally not used, as it would introduce breaking changes (notably via a `ts-node` downgrade).

## [1.2.1] - 2025-12-07

### Changed

- Strengthened TypeScript types in `filesystem-tools` to eliminate implicit any usage in internal callbacks
  - Added explicit string typing for directory exclude pattern matching
  - Explicitly typed file operation inputs and indices in `file_operations` handling
  - Clarified intermediate result typing for file operation workflows without altering runtime behavior
- Improved overall type clarity for directory listing and file operations, preparing the codebase for stricter TypeScript configurations

## [1.2.0] - 2025-12-07


### Added

- Automatic parent directory creation for write tools:
  - `write_file` now detects when the target file's parent directory does not exist and, if the path is within approved directories, creates the full directory chain before writing
  - `write_multiple_files` now validates all requested paths and automatically creates any missing parent directories within approved directories before performing concurrent writes
  - This removes the need for the model to call `make_directory` explicitly before writing into new subdirectories, reducing round trips and tool calls
- New `ValidatePathOptions` support for `validatePath` with `createParentIfMissing` flag:
  - Optional flag that instructs `validatePath` to create missing parent directories, subject to strict allowed-directory and symlink safety checks
  - Designed specifically for write operations; read/search tools continue to validate paths without side effects
- Comprehensive test coverage for the new behavior:
  - Unit tests for `validatePath` covering:
    - Single-level and multi-level directory creation within allowed roots
    - Rejection of paths outside allowed directories even when `createParentIfMissing` is true
    - Handling of race conditions where directories are created between checks
    - Defensive behavior when an expected directory segment is actually a file
    - Symlink interactions to ensure created directories do not escape approved roots
  - Integration tests for:
    - `write_file` writing into deep, initially non-existent directory trees
    - `write_multiple_files` writing multiple files into separate, initially non-existent directory trees
    - Ensuring multi-file writes still fail cleanly when any path is outside approved directories

### Changed

- `handleWriteTool` implementation for `write_file` and `write_multiple_files` now opts into `validatePath(path, { createParentIfMissing: true })` for write operations only, preserving existing behavior for all other tools
- Internal path-validation logic refactored to centralize secure directory creation semantics in `validatePath`, ensuring:
  - Normalization and allowed-directory checks are performed before any directory creation
  - Each created directory is validated with `realpath` to stay inside allowed roots
  - Non-directory collisions and unsafe symlink targets are rejected with clear error messages

## [1.1.7] - 2025-11-18

### Security

- **CRITICAL**: Fixed command approval bypass vulnerability in `execute_shell` tool
  - Previously, unapproved commands could execute if they didn't match dangerous patterns and `requiresApproval` was not set
  - Now enforces strict whitelist: ALL commands must be in `--approved-commands` list to execute
  - Affected commands that were incorrectly allowed: `dir`, `whoami`, `ipconfig`, `type`, `copy`, `move`, `ren`, `del`, `mkdir`, `rmdir`
  - Added defense-in-depth: dangerous patterns now checked even on approved commands
  - Enhanced error messages showing approved vs unapproved commands with helpful guidance

### Added

- 19 comprehensive security tests for strict command whitelist enforcement
  - Tests for unapproved non-dangerous commands (whoami, hostname)
  - Tests for Windows-specific commands (dir, type, copy, move, ren, del, mkdir, rmdir, ipconfig)
  - Regression tests ensuring all vulnerability examples are blocked
  - Defense-in-depth tests for dangerous patterns on approved commands

### Changed

- Updated 9 existing shell-tool tests to reflect new strict approval logic
- Updated error messages from "Command requires approval" to "Command not in approved list"
- Shell command path validation tests now include all necessary commands in approved list

### Fixed

- `execute_shell` tool now properly blocks ALL unapproved commands regardless of `requiresApproval` parameter
- Closed security bypass where unapproved commands executed with default `requiresApproval=false`

## [1.1.6] - 2025-11-16

### Fixed

- README.md Configuration Examples: Corrected all `--approved-folders` examples to use separate array elements instead of comma-separated strings within quotes. This fixes setup failures for users with spaces in directory paths.
  - Before: `"C:/Users/username/projects,C:/Users/username/documents"` (breaks with spaces)
  - After: `"C:/Users/username/projects", "C:/Users/username/documents"` (works with spaces)
- Added clear guidance for paths containing spaces in MCP configuration

### Changed

- Updated all README configuration examples to use the correct array element format for better user experience

## [1.1.5] - 2025-11-15

### Added

- Comprehensive security audit documentation suite:
  - `docs/SNYK_VULNERABILITY_AUDIT_2025.md` - Static analysis audit report from Snyk platform
    - Validated 5/6 Snyk findings as false positives
    - Fixed 1 finding (defense-in-depth path validation in rollback function)
    - Created `.snyk` policy file to suppress false positives with justifications
  - `docs/CVE_MANUAL_AUDIT_2025-11-04.md` - Manual CVE pattern analysis audit
    - CVE-2025-54794/54795 pattern research and mitigation validation
    - Identified and fixed critical `make_directory` vulnerability
  - `docs/SHELL_COMMAND_AUDIT_2025-11-04.md` - Shell command directory bypass audit (retrospective)
    - Documents November 2024 security fix for path validation in shell command arguments
    - 419 lines of comprehensive test coverage
  - `docs/SECURITY_TEST_SUMMARY.md` - Security test coverage documentation
    - 2000+ lines of security-focused tests in `src/tests/`
    - Explicit CVE tests for CVE-2025-54794, CVE-2025-54795, CVE-2025-53109
- Security annotations and JSDoc comments in `src/tools/write-tools.ts` for static analysis tools

### Changed

- Reorganized vulnerability documentation with unique, descriptive filenames:
  - Renamed `docs/VULNERABILITY_RESEARCH_FINDINGS.md` → `docs/CVE_MANUAL_AUDIT_2025-11-04.md`
  - Renamed `local_docs/VULNERABILITY_RESEARCH_FINDINGS.md` → `local_docs/CVE_MANUAL_AUDIT_2025-11-03_DRAFT.md`
  - Updated dates in audit reports to reflect actual creation/audit dates (Nov 3-4, 2025)
- Enhanced README.md Security Audit section with comprehensive audit report references
  - Added "Latest Security Audits" section linking to all audit reports
  - Updated CVE Protection Status with current security posture
  - Clarified shell command directory bypass as fixed (November 2024)

### Security

- Added defense-in-depth path validation to `performRollback()` function in `write-tools.ts`
  - Re-validates paths before rollback operations
  - Protects against edge cases where allowed directories might change during multi-file operations

### Removed

- Deleted duplicate `VULNERABILITY_RESEARCH_FINDINGS.md` files from both `docs/` and `local_docs/` after proper renaming

## [1.1.4] - 2025-11-13

### Changed

- Updated package.json to version 1.1.4 and added the `mcpName` field for MCP Registry compatibility.
- Created `server.json` with version 1.1.4, updated schema (2025-10-17), `registryType` field, and added the `transport` field.

## [1.1.3] - 2025-11-13

### Security

- CRITICAL: Fixed shell execution directory bypass vulnerability that allowed arbitrary command execution in unapproved directories
  - Shell commands without explicit workdir parameter now properly validate process.cwd() against allowed directories
  - All shell executions now require at least one approved directory to be configured
  - Added mandatory directory validation for both explicit and default working directories
  - Enhanced error messages with clear guidance for users
  - This is a breaking change by design for security: users must configure approved directories or provide explicit workdir parameters

### Added

- 7 comprehensive security tests for shell execution directory validation
- Root Cause Analysis document: local_docs/RCA-Shell-Execution-Directory-Bypass-Vulnerability.md
- Security fix verification document: local_docs/SECURITY-FIX-VERIFICATION.md

### Changed

- Updated execute_shell tool description to explicitly document security requirements
- Updated 10+ existing tests to comply with enhanced security model

### Fixed

- Shell execution no longer bypasses directory validation when workdir parameter is omitted
- Process working directory is now validated against allowed directories in all cases

## [1.1.2] - 2025-01-12

### Fixed

- Added defensive string-to-array parsing for `make_directory` tool to handle MCP clients that incorrectly serialize array parameters as stringified JSON
  - Workaround for Claude Desktop serialization issue
  - Zero impact on correctly-functioning MCP clients (Cursor IDE verified)
  - Includes diagnostic logging to identify problematic clients
  - Comprehensive test coverage for stringified arrays and edge cases

### Added

- 4 new test cases for MCP client serialization workaround
- Diagnostic logging when stringified array parameters are detected
- Root Cause Analysis document in `local_docs/make_directory_batch_failure_rca.md`

## [1.1.1] - 2025-11-11

### Fixed

- Corrected Docker entrypoint to use dist/cli.js instead of dist/index.js for proper MCP server initialization
- Updated Node.js base image from node:22.12-alpine to node:22-alpine for better version compatibility

### Changed

- Added keywords to package.json for improved NPM discoverability

## [1.1.0] - 2025-11-08

### Added

- Multi-file editing capability for edit_file tool
  - Support for editing up to 50 files in a single operation
  - Mode discriminator (single/multiple) for backward compatibility
  - Atomic operations with automatic rollback on failure
  - Per-file configuration options (matching strategy, dryRun, failOnAmbiguous)
  - Concurrent file processing for improved performance
  - Detailed multi-file diff output with summary statistics
- Comprehensive test suite for multi-file editing functionality
- Implementation plan documentation in local_docs folder

### Changed

- Enhanced edit_file tool schema to support both single and multi-file modes
- Updated README documentation with complete edit_file feature specification
- Improved EditFileArgsSchema with explicit mode parameter for better MCP client compatibility

### Fixed

- Test timeout issues in shell-tool.test.ts and shell-command-path-validation.test.ts

## [1.0.1] - 2025-11-03

### Security

- Fixed path restriction bypass vulnerability in `make_directory` tool (CVE-2025-54794 pattern)
  - Replaced vulnerable prefix-based path validation with secure canonical path comparison
  - Now uses `isPathWithinAllowedDirectories()` which requires path separator, preventing prefix collision attacks
  - Example: Blocks `/path/to/allowed_evil` when `/path/to/allowed` is approved

### Added

- Added comprehensive security tests for path prefix collision protection
- Added security tests for command injection protection (CVE-2025-54795 pattern)
- Added vulnerability research findings documentation (`docs/VULNERABILITY_RESEARCH_FINDINGS.md`)
- Added Security section to README with CVE protection details and best practices

### Changed

- Updated README with dedicated Security section covering protected vulnerabilities and security controls
- Enhanced test coverage with security-focused test cases for make_directory and command execution

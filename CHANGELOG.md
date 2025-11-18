# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

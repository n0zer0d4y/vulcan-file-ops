# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

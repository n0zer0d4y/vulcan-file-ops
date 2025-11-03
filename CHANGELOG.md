# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

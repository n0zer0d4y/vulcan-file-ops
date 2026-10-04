# Security Policy

## Supported Versions

Security fixes are released for the latest minor version on npm.

| Version | Supported |
| ------- | --------- |
| 1.3.x   | Yes       |
| < 1.3   | No        |

## Reporting a Vulnerability

Please do **not** report security vulnerabilities in public GitHub issues.

Report them privately through GitHub:
**[Report a vulnerability](https://github.com/n0zer0d4y/vulcan-file-ops/security/advisories/new)**
(repository **Security** tab → **Report a vulnerability**).

Please include:

- affected version(s) and platform (Windows / macOS / Linux, Node.js version)
- the MCP client and server configuration used (command-line flags)
- a description of the impact and the steps to reproduce it

Reports are reviewed as text. Please do not send executables, scripts or archives;
describe the reproduction steps instead.

### What to expect

- Acknowledgement within 7 days.
- An assessment and, if confirmed, a fix timeline within 30 days.
- Coordinated disclosure through a GitHub Security Advisory once a fixed version
  is published. Reporters are credited unless they prefer otherwise.

## Security Model and Scope

Vulcan File Ops restricts file operations to approved directories. Please keep
these limits in mind when evaluating reports:

- **`execute_shell` is not a sandbox.** Commands are restricted to an allowlist and
  their file operands are validated, but an approved interpreter or tool that runs
  code (`node`, `python`, `bash`, `npm`, `git`, `find -exec`, ...) can do anything
  the user account can. Only approve commands you would let the AI run unsupervised,
  and use OS-level isolation (container, VM) for untrusted workloads.
- Directory access is granted by the operator (`--approved-folders`), by the MCP
  client (Roots), or at runtime through `register_directory`, which requires user
  confirmation by default (`--runtime-registration`).
- Vulnerabilities in bundled dependencies should also be reported upstream.

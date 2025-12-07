import { zodToJsonSchema } from "zod-to-json-schema";
import { ToolSchema } from "@modelcontextprotocol/sdk/types.js";
import path from "path";
import { promises as fs } from "fs";
import {
  WriteFileArgsSchema,
  WriteMultipleFilesArgsSchema,
  EditFileArgsSchema,
  EditFileRequestSchema,
  type WriteFileArgs,
  type WriteMultipleFilesArgs,
  type EditFileArgs,
  type EditFileRequest,
} from "../types/index.js";
import {
  validatePath,
  writeFileContent,
  readFileContent,
  applyFileEdits,
} from "../utils/lib.js";
import {
  isHTMLContent,
  convertHTMLToPDF,
  convertHTMLToDOCX,
} from "../utils/html-to-document.js";

const ToolInputSchema = ToolSchema.shape.inputSchema;
type ToolInput = any;

interface EditFileResult {
  path: string;
  success: boolean;
  strategy?: "exact" | "flexible" | "fuzzy";
  occurrences?: number;
  diff?: string;
  error?: string;
  dryRun?: boolean;
}

interface EditFileResults {
  results: EditFileResult[];
  summary: {
    total: number;
    successful: number;
    failed: number;
    hasFailures: boolean;
    failFast: boolean;
  };
}

/**
 * Helper function to write file content based on file extension
 * Supports HTML conversion for rich formatting in PDF and DOCX files
 *
 * @security Path must be pre-validated via validatePath() before calling this function
 * @param validPath - VALIDATED path (must have passed through validatePath())
 * @param content - File content to write
 */
async function writeFileBasedOnExtension(
  validPath: string,
  content: string,
): Promise<void> {
  const ext = path.extname(validPath).toLowerCase();
  const filename = path.basename(validPath);
  const fileTitle = path.basename(validPath, ext);

  // Detect if content is HTML
  const isHTML = isHTMLContent(content);

  if (ext === ".pdf") {
    if (isHTML) {
      // Use HTML-to-PDF converter for rich formatting
      const pdfBuffer = await convertHTMLToPDF(content, {
        title: fileTitle,
        author: "vulcan-file-ops",
      });
      // SECURITY: validPath pre-validated by validatePath() - safe from path traversal (CWE-23)
      await fs.writeFile(validPath, pdfBuffer);
    } else {
      // Fallback to simple text PDF for plain text
      const { createSimpleTextPDF } = await import("../utils/pdf-writer.js");
      const pdfBuffer = await createSimpleTextPDF(content);
      // SECURITY: validPath pre-validated by validatePath() - safe from path traversal (CWE-23)
      await fs.writeFile(validPath, pdfBuffer);
    }
  } else if (ext === ".docx") {
    if (isHTML) {
      // Use HTML-to-DOCX converter for rich formatting
      const docxBuffer = await convertHTMLToDOCX(content, {
        title: fileTitle,
        author: "vulcan-file-ops",
      });
      // SECURITY: validPath pre-validated by validatePath() - safe from path traversal (CWE-23)
      await fs.writeFile(validPath, docxBuffer);
    } else {
      // Fallback to simple text DOCX for plain text
      const { createSimpleDOCX } = await import("../utils/docx-writer.js");
      const docxBuffer = await createSimpleDOCX(content);
      // SECURITY: validPath pre-validated by validatePath() - safe from path traversal (CWE-23)
      await fs.writeFile(validPath, docxBuffer);
    }
  } else {
    // Regular text file
    // SECURITY: validPath pre-validated by validatePath() - writeFileContent adds additional atomic write protection
    await writeFileContent(validPath, content);
  }
}

/**
 * Process a single file edit request with validation
 *
 * @security All paths validated via validatePath() before file operations
 * @param request - Edit request with path and edits to apply
 * @param failOnAmbiguous - Whether to fail on ambiguous matches
 * @returns Edit result with success status and diff
 */
async function processFileEditRequest(
  request: EditFileRequest,
  failOnAmbiguous: boolean = true,
): Promise<EditFileResult> {
  try {
    // SECURITY: Path validated against allowed directories, symlink targets checked,
    // prevents CVE-2025-54794 (prefix collision), CVE-2025-53109 (symlink attacks)
    const validPath = await validatePath(request.path);
    const result = await applyFileEdits(
      validPath,
      request.edits,
      request.dryRun || false,
      request.matchingStrategy || "auto",
      request.failOnAmbiguous !== undefined
        ? request.failOnAmbiguous
        : failOnAmbiguous,
      true, // Return metadata
    );

    if (typeof result === "string") {
      throw new Error("Expected metadata but got string result");
    }

    // Aggregate metadata from all edits
    const totalOccurrences = result.metadata.reduce(
      (sum, r) => sum + r.occurrences,
      0,
    );
    const usedStrategies = [...new Set(result.metadata.map((r) => r.strategy))];
    const finalStrategy =
      result.metadata[result.metadata.length - 1]?.strategy || "exact";
    const warning = result.metadata.find((r) => r.warning)?.warning;
    const ambiguity = result.metadata.find((r) => r.ambiguity)?.ambiguity;

    return {
      path: request.path,
      success: true,
      strategy: finalStrategy,
      occurrences: totalOccurrences,
      diff: result.diff,
      dryRun: request.dryRun,
    };
  } catch (error) {
    return {
      path: request.path,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function processMultiFileEdits(
  files: EditFileRequest[],
  failFast: boolean = true,
): Promise<EditFileResults> {
  const results: EditFileResult[] = [];
  const rollbackData: Array<{ path: string; originalContent: string }> = [];
  let hasFailures = false;

  try {
    // Process files sequentially if failFast is true, concurrently if false
    if (failFast) {
      // Process sequentially to stop on first failure
      for (const request of files) {
        // For rollback capability, read original content before editing
        let originalContent: string | undefined;
        if (failFast && !request.dryRun) {
          try {
            originalContent = await readFileContent(
              await validatePath(request.path),
            );
          } catch (error) {
            // If we can't read the original content, we can't provide rollback
            // This is acceptable - the file might not exist or be readable
          }
        }

        const result = await processFileEditRequest(request);
        results.push(result);

        // Track successful edits for potential rollback
        if (
          result.success &&
          !request.dryRun &&
          originalContent !== undefined
        ) {
          rollbackData.push({
            path: request.path,
            originalContent,
          });
        }

        if (!result.success) {
          hasFailures = true;
          // Rollback all previously successful edits
          await performRollback(rollbackData);
          break; // Stop processing remaining files
        }
      }
    } else {
      // Process all concurrently, collect all results (no rollback for concurrent mode)
      const promises = files.map((request) => processFileEditRequest(request));
      const allResults = await Promise.allSettled(promises);

      for (let i = 0; i < allResults.length; i++) {
        const settled = allResults[i];
        const request = files[i];

        if (settled.status === "fulfilled") {
          results.push(settled.value);
          if (!settled.value.success) hasFailures = true;
        } else {
          // Handle unexpected promise rejections
          results.push({
            path: request.path,
            success: false,
            error: `Unexpected error: ${settled.reason}`,
          });
          hasFailures = true;
        }
      }
    }
  } catch (error) {
    // If there's an unexpected error during processing, attempt rollback
    if (failFast && rollbackData.length > 0) {
      await performRollback(rollbackData);
    }
    throw error;
  }

  return {
    results,
    summary: {
      total: files.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      hasFailures,
      failFast,
    },
  };
}

async function performRollback(
  rollbackData: Array<{ path: string; originalContent: string }>,
): Promise<void> {
  for (const item of rollbackData.reverse()) {
    // Rollback in reverse order
    try {
      // Security: Re-validate path before rollback to ensure it's still within allowed directories
      // Defense-in-depth: Even though paths were validated during edit, re-validate during rollback
      // to protect against edge cases where allowed directories might have changed
      const validPath = await validatePath(item.path);
      await writeFileContent(validPath, item.originalContent);
    } catch (rollbackError) {
      // Log rollback failure but don't throw - we want to attempt all rollbacks
      console.error(`Failed to rollback ${item.path}: ${rollbackError}`);
    }
  }
}

function formatMultiFileEditResults(editResults: EditFileResults): string {
  let output = "";

  // Summary header
  output += `Multi-File Edit Summary:\n`;
  output += `Total files: ${editResults.summary.total}\n`;
  output += `Successful: ${editResults.summary.successful}\n`;
  output += `Failed: ${editResults.summary.failed}\n`;
  output += `Mode: ${
    editResults.summary.failFast ? "failFast (atomic)" : "continueOnError"
  }\n`;

  if (editResults.summary.failFast && editResults.summary.hasFailures) {
    output += `⚠️  Atomic operation failed - all successful edits were rolled back\n`;
  }

  output += `\n`;

  // Individual file results
  editResults.results.forEach((result, index) => {
    output += `File ${index + 1}: ${result.path}\n`;
    output += `Status: ${result.success ? "✓ SUCCESS" : "✗ FAILED"}\n`;

    if (result.success) {
      if (result.strategy) {
        output += `Strategy: ${result.strategy}\n`;
      }
      if (result.occurrences !== undefined) {
        output += `Occurrences: ${result.occurrences}\n`;
      }
      if (result.dryRun) {
        output += `Mode: DRY RUN (no changes made)\n`;
      }
      if (result.diff) {
        output += `\n${result.diff}\n`;
      }
    } else {
      output += `Error: ${result.error}\n`;
    }

    output += "\n" + "=".repeat(50) + "\n\n";
  });

  return output.trim();
}

export function getWriteTools() {
  return [
    {
      name: "write_file",
      description:
        "Create/replace files. Supports text (UTF-8), PDF, and DOCX with HTML formatting. " +
        "\n\n" +
        "**PDF/DOCX with HTML Formatting:**\n" +
        "- Provide HTML content for rich formatting (headings, bold, italic, colors, tables, lists)\n" +
        "- Supports: <h1>-<h6>, <p>, <div>, <span>, <strong>, <em>, <u>, <table>, <ul>, <ol>\n" +
        "- CSS styling: colors, fonts, alignment, borders, margins, padding\n" +
        "- Example: '<html><body><h1 style=\"color: #2c3e50;\">Title</h1><p>Content</p></body></html>'\n" +
        "- Plain text fallback: If content is not HTML, creates simple formatted document\n" +
        "\n" +
        "**Text files:** UTF-8 encoding. " +
        "**Overwrites without confirmation.**\n" +
        "\n" +
        "IMPORTANT - Multi-line Content:\n" +
        "- Use actual newline characters in the content string, NOT escape sequences like \\n\n" +
        "- MCP/JSON will handle the encoding automatically\n" +
        '- Incorrect: {"content": "line1\\nline2"} - this writes literal \\n characters\n' +
        "- Correct: Use actual line breaks in your JSON string value\n" +
        "\n" +
        "Only works within allowed directories.",
      inputSchema: zodToJsonSchema(WriteFileArgsSchema) as ToolInput,
    },
    {
      name: "edit_file",
      description:
        "Apply precise modifications to text and code files with intelligent matching.\n\n" +
        "**Single File Editing (mode: 'single'):**\n" +
        "Edit one file with multiple sequential edits using exact, flexible, or fuzzy matching strategies.\n\n" +
        "**Multi-File Editing (mode: 'multiple'):**\n" +
        "Edit multiple files concurrently in a single operation. Each file can have its own edit configuration.\n\n" +
        "**Matching Strategies:**\n" +
        "1. Exact: Character-for-character match (fastest, safest)\n" +
        "2. Flexible: Whitespace-insensitive, preserves original indentation\n" +
        "3. Fuzzy: Token-based regex matching for maximum compatibility\n\n" +
        "**Features:**\n" +
        "- Concurrent processing for multi-file operations\n" +
        "- Per-file matching strategy control\n" +
        "- Dry-run preview mode\n" +
        "- Detailed diff output with statistics\n" +
        "- Atomic operations with rollback capability\n" +
        "- Cross-platform line ending preservation\n\n" +
        "**Maximum:** 50 files per multi-file operation\n\n" +
        "**Best Practices:**\n" +
        "- Include 3-5 lines of context before and after the change for reliability\n" +
        "- Add 'instruction' field to describe the purpose of each edit\n" +
        "- Use 'dryRun: true' to preview changes before applying\n" +
        "- For multiple related changes, use array of edits (applied sequentially)\n" +
        "- Set 'expectedOccurrences' to validate replacement count\n" +
        "- Use 'matchingStrategy' to control matching behavior (defaults to 'auto')\n\n" +
        "**CRITICAL - Multi-line Content:**\n" +
        "- Use actual newline characters in oldText/newText strings, NOT \\n escape sequences\n" +
        "- The MCP/JSON layer handles encoding automatically\n" +
        "- Using \\n literally will search for/write backslash+n characters (wrong!)\n\n" +
        "Only works within allowed directories.",
      inputSchema: zodToJsonSchema(EditFileArgsSchema) as ToolInput,
    },
    {
      name: "write_multiple_files",
      description:
        "Write multiple files concurrently. Supports text, PDF, and DOCX with HTML formatting. " +
        "File type auto-detected by extension. Failed writes for individual files " +
        "won't stop others. Returns detailed results for each file. " +
        "\n\n" +
        "**PDF/DOCX with HTML:** Provide HTML content for rich formatting. " +
        "Automatically detects HTML and applies formatting. Plain text creates simple documents.\n" +
        "\n" +
        "IMPORTANT - Multi-line Content:\n" +
        "- Use actual newline characters in content strings, NOT \\n escape sequences\n" +
        "- Each file's content will be written exactly as provided in the string\n" +
        "\n" +
        "Only works within allowed directories.",
      inputSchema: zodToJsonSchema(WriteMultipleFilesArgsSchema) as ToolInput,
    },
  ];
}

export async function handleWriteTool(name: string, args: any) {
  switch (name) {
    case "write_file": {
      const parsed = WriteFileArgsSchema.safeParse(args);
      if (!parsed.success) {
        throw new Error(`Invalid arguments for write_file: ${parsed.error}`);
      }
      // SECURITY: validatePath() enforces:
      // 1. Canonical path resolution (path.resolve + path.normalize)
      // 2. Allowed directory boundary checking (isPathWithinAllowedDirectories)
      // 3. Symlink resolution and target validation (fs.realpath)
      // 4. Parent directory validation for new files
      // Prevents: CWE-23 (Path Traversal), CVE-2025-54794, CVE-2025-53109, CVE-2025-53110
      const validPath = await validatePath(parsed.data.path, {
        createParentIfMissing: true,
      });
      await writeFileBasedOnExtension(validPath, parsed.data.content);
      return {
        content: [
          { type: "text", text: `Successfully wrote to ${parsed.data.path}` },
        ],
      };
    }

    case "edit_file": {
      const parsed = EditFileArgsSchema.safeParse(args);
      if (!parsed.success) {
        throw new Error(`Invalid arguments for edit_file: ${parsed.error}`);
      }

      // Determine mode and route to appropriate handler
      const mode = parsed.data.mode || "single";

      if (mode === "single") {
        // Single file mode (backward compatible)
        if (!parsed.data.path || !parsed.data.edits) {
          throw new Error("Single mode requires 'path' and 'edits' fields");
        }

        const result = await processFileEditRequest({
          path: parsed.data.path,
          edits: parsed.data.edits,
          matchingStrategy: parsed.data.matchingStrategy,
          dryRun: parsed.data.dryRun,
          failOnAmbiguous: parsed.data.failOnAmbiguous,
        });

        if (!result.success) {
          throw new Error(result.error);
        }

        return {
          content: [{ type: "text", text: result.diff }],
        };
      } else if (mode === "multiple") {
        // Multi-file mode
        if (!parsed.data.files) {
          throw new Error("Multiple mode requires 'files' field");
        }

        const editResults = await processMultiFileEdits(
          parsed.data.files,
          parsed.data.failFast,
        );

        const output = formatMultiFileEditResults(editResults);
        return {
          content: [{ type: "text", text: output }],
        };
      } else {
        throw new Error(`Invalid mode: ${mode}`);
      }
    }

    case "write_multiple_files": {
      const parsed = WriteMultipleFilesArgsSchema.safeParse(args);
      if (!parsed.success) {
        throw new Error(
          `Invalid arguments for write_multiple_files: ${parsed.error}`,
        );
      }

      // Validate all paths before any writing, auto-creating parent directories
      const validationPromises = parsed.data.files.map(async (file) => {
        try {
          const validPath = await validatePath(file.path, {
            createParentIfMissing: true,
          });
          return {
            path: file.path,
            validPath,
            content: file.content,
            success: true,
          };
        } catch (error) {
          return {
            path: file.path,
            content: file.content,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      });

      const validatedFiles = await Promise.all(validationPromises);

      // Separate valid and invalid files
      const validFiles = validatedFiles.filter((f) => f.success) as Array<{
        path: string;
        validPath: string;
        content: string;
        success: true;
      }>;
      const invalidFiles = validatedFiles.filter((f) => !f.success);

      // If any paths are invalid, fail the entire operation
      if (invalidFiles.length > 0) {
        const errorMessages = invalidFiles
          .map((f) => `${f.path}: ${f.error || "Unknown error"}`)
          .join("\n");
        throw new Error(`Invalid file paths:\n${errorMessages}`);
      }

      // Write all valid files concurrently
      const writePromises = validFiles.map(async (file) => {
        try {
          await writeFileBasedOnExtension(file.validPath, file.content);
          return {
            path: file.path,
            success: true,
            size: Buffer.byteLength(file.content, "utf8"),
          };
        } catch (error) {
          return {
            path: file.path,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      });

      const results = await Promise.allSettled(writePromises);
      const successful = results.filter(
        (r) => r.status === "fulfilled" && r.value.success,
      ).length;
      const failed = results.filter(
        (r) => r.status === "fulfilled" && !r.value.success,
      ).length;

      // Format results
      const resultLines = results.map((result, index) => {
        if (result.status === "rejected") {
          return `✗ ${parsed.data.files[index].path} - Unexpected error`;
        }
        const file = result.value;
        if (file && file.success) {
          return `✓ ${file.path} (${file.size} bytes)`;
        } else if (file) {
          return `✗ ${file.path} - Error: ${file.error || "Unknown error"}`;
        } else {
          return `✗ ${parsed.data.files[index].path} - Unknown error`;
        }
      });

      const summary = `\nWrote ${successful} of ${parsed.data.files.length} files:`;
      const resultText = summary + "\n" + resultLines.join("\n");

      if (failed === 0) {
        return {
          content: [
            {
              type: "text",
              text: resultText + "\n\nAll files written successfully.",
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: "text",
              text:
                resultText +
                `\n\n${successful} files succeeded, ${failed} failed.`,
            },
          ],
        };
      }
    }

    default:
      throw new Error(`Unknown write tool: ${name}`);
  }
}

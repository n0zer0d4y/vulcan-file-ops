import { zodToJsonSchema } from "zod-to-json-schema";
import { ToolSchema } from "@modelcontextprotocol/sdk/types.js";
import path from "path";
import { promises as fs } from "fs";
import {
  WriteFileArgsSchema,
  WriteMultipleFilesArgsSchema,
  EditFileArgsSchema,
  type WriteFileArgs,
  type WriteMultipleFilesArgs,
  type EditFileArgs,
} from "../types/index.js";
import {
  validatePath,
  writeFileContent,
  applyFileEdits,
} from "../utils/lib.js";
import {
  isHTMLContent,
  convertHTMLToPDF,
  convertHTMLToDOCX,
} from "../utils/html-to-document.js";

const ToolInputSchema = ToolSchema.shape.inputSchema;
type ToolInput = any;

/**
 * Helper function to write file content based on file extension
 * Supports HTML conversion for rich formatting in PDF and DOCX files
 */
async function writeFileBasedOnExtension(
  validPath: string,
  content: string
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
      await fs.writeFile(validPath, pdfBuffer);
    } else {
      // Fallback to simple text PDF for plain text
      const { createSimpleTextPDF } = await import("../utils/pdf-writer.js");
      const pdfBuffer = await createSimpleTextPDF(content);
      await fs.writeFile(validPath, pdfBuffer);
    }
  } else if (ext === ".docx") {
    if (isHTML) {
      // Use HTML-to-DOCX converter for rich formatting
      const docxBuffer = await convertHTMLToDOCX(content, {
        title: fileTitle,
        author: "vulcan-file-ops",
      });
      await fs.writeFile(validPath, docxBuffer);
    } else {
      // Fallback to simple text DOCX for plain text
      const { createSimpleDOCX } = await import("../utils/docx-writer.js");
      const docxBuffer = await createSimpleDOCX(content);
      await fs.writeFile(validPath, docxBuffer);
    }
  } else {
    // Regular text file
    await writeFileContent(validPath, content);
  }
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
        "Apply precise modifications to text and code files with intelligent matching. " +
        "Performs exact text substitution with automatic fallback to flexible whitespace-insensitive matching " +
        "and fuzzy token-based matching for maximum reliability. " +
        "Supports multiple sequential edits in a single operation. " +
        "Provides detailed diff output with change statistics and strategy information. " +
        "Preserves original file formatting including indentation and line endings. " +
        "\n\n" +
        "Matching Strategies (in order when using 'auto'):\n" +
        "1. Exact: Character-for-character match (fastest, safest)\n" +
        "2. Flexible: Whitespace-insensitive, preserves original indentation\n" +
        "3. Fuzzy: Token-based regex matching for maximum compatibility\n" +
        "\n" +
        "Best Practices:\n" +
        "- Include 3-5 lines of context before and after the change for reliability\n" +
        "- Add 'instruction' field to describe the purpose of each edit\n" +
        "- Use 'dryRun: true' to preview changes before applying\n" +
        "- For multiple related changes, use array of edits (applied sequentially)\n" +
        "- Set 'expectedOccurrences' to validate replacement count\n" +
        "- Use 'matchingStrategy' to control matching behavior (defaults to 'auto')\n" +
        "\n" +
        "CRITICAL - Multi-line Content:\n" +
        "- Use actual newline characters in oldText/newText strings, NOT \\n escape sequences\n" +
        "- The MCP/JSON layer handles encoding automatically\n" +
        "- Using \\n literally will search for/write backslash+n characters (wrong!)\n" +
        "\n" +
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
      const validPath = await validatePath(parsed.data.path);
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
      const validPath = await validatePath(parsed.data.path);
      const result = await applyFileEdits(
        validPath,
        parsed.data.edits,
        parsed.data.dryRun,
        parsed.data.matchingStrategy,
        parsed.data.failOnAmbiguous
      );
      return {
        content: [{ type: "text", text: result }],
      };
    }

    case "write_multiple_files": {
      const parsed = WriteMultipleFilesArgsSchema.safeParse(args);
      if (!parsed.success) {
        throw new Error(
          `Invalid arguments for write_multiple_files: ${parsed.error}`
        );
      }

      // Validate all paths before any writing
      const validationPromises = parsed.data.files.map(async (file) => {
        try {
          const validPath = await validatePath(file.path);
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
        (r) => r.status === "fulfilled" && r.value.success
      ).length;
      const failed = results.filter(
        (r) => r.status === "fulfilled" && !r.value.success
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

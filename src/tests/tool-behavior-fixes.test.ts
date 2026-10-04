/**
 * Regressions for tool behavior issues found in live client testing (1.3.0):
 * move_file overwrite, tail with a trailing newline, write_multiple_files
 * byte counts, and the "parent does not exist" message masking access denial.
 */

import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import { promises as fs, realpathSync } from "fs";
import path from "path";
import os from "os";
import { handleFileSystemTool } from "../tools/filesystem-tools.js";
import { handleReadTool } from "../tools/read-tools.js";
import { handleWriteTool } from "../tools/write-tools.js";
import { setAllowedDirectories, getAllowedDirectories } from "../utils/lib.js";

const LINK_TYPE = process.platform === "win32" ? "junction" : "dir";

describe("tool behavior fixes", () => {
  const originalAllowed = getAllowedDirectories();
  let root: string;
  let allowed: string;
  let outside: string;

  beforeEach(async () => {
    root = realpathSync(await fs.mkdtemp(path.join(os.tmpdir(), "vulcan-fixes-")));
    allowed = path.join(root, "allowed");
    outside = path.join(root, "outside");
    await fs.mkdir(allowed);
    await fs.mkdir(outside);
    setAllowedDirectories([allowed]);
  });

  afterEach(async () => {
    setAllowedDirectories(originalAllowed);
    await fs.rm(root, { recursive: true, force: true });
  });

  describe("move_file", () => {
    test("moves to a new destination", async () => {
      await fs.writeFile(path.join(allowed, "a.txt"), "A");
      await handleFileSystemTool("move_file", {
        source: path.join(allowed, "a.txt"),
        destination: path.join(allowed, "b.txt"),
      });
      expect(await fs.readFile(path.join(allowed, "b.txt"), "utf-8")).toBe("A");
    });

    test("refuses to overwrite an existing destination", async () => {
      await fs.writeFile(path.join(allowed, "alpha.txt"), "ALPHA");
      await fs.writeFile(path.join(allowed, "beta.json"), "BETA");
      await expect(
        handleFileSystemTool("move_file", {
          source: path.join(allowed, "alpha.txt"),
          destination: path.join(allowed, "beta.json"),
        })
      ).rejects.toThrow(/Destination already exists/);
      expect(await fs.readFile(path.join(allowed, "beta.json"), "utf-8")).toBe("BETA");
      expect(await fs.readFile(path.join(allowed, "alpha.txt"), "utf-8")).toBe("ALPHA");
    });

    test("allows a case-only rename (same file)", async () => {
      await fs.writeFile(path.join(allowed, "readme.md"), "R");
      await handleFileSystemTool("move_file", {
        source: path.join(allowed, "readme.md"),
        destination: path.join(allowed, "README.md"),
      });
      expect(await fs.readdir(allowed)).toContain("README.md");
    });

    test("reports access denied (not 'does not exist') for a destination through a link", async () => {
      await fs.writeFile(path.join(allowed, "a.txt"), "A");
      await fs.symlink(outside, path.join(allowed, "link"), LINK_TYPE);
      await expect(
        handleFileSystemTool("move_file", {
          source: path.join(allowed, "a.txt"),
          destination: path.join(allowed, "link", "moved.txt"),
        })
      ).rejects.toThrow(/Access denied/);
      expect(await fs.readdir(outside)).toEqual([]);
    });
  });

  describe("read_file tail", () => {
    test("ignores the newline that ends the last line", async () => {
      const file = path.join(allowed, "lines.txt");
      await fs.writeFile(file, "one\ntwo\nthree\n");
      const result = await handleReadTool("read_file", { path: file, mode: "tail", lines: 2 });
      expect(result.content[0].text).toBe("two\nthree");
    });

    test("works without a trailing newline", async () => {
      const file = path.join(allowed, "lines.txt");
      await fs.writeFile(file, "one\ntwo\nthree");
      const result = await handleReadTool("read_file", { path: file, mode: "tail", lines: 2 });
      expect(result.content[0].text).toBe("two\nthree");
    });

    test("keeps a genuinely empty last line", async () => {
      const file = path.join(allowed, "lines.txt");
      await fs.writeFile(file, "one\n\n");
      const result = await handleReadTool("read_file", { path: file, mode: "tail", lines: 2 });
      expect(result.content[0].text).toBe("one\n");
    });

    test("handles CRLF files", async () => {
      const file = path.join(allowed, "lines.txt");
      await fs.writeFile(file, "one\r\ntwo\r\nthree\r\n");
      const result = await handleReadTool("read_file", { path: file, mode: "tail", lines: 1 });
      expect(result.content[0].text).toBe("three");
    });
  });

  describe("write_multiple_files byte counts", () => {
    test("reports the size of the written file, not the input", async () => {
      const html = "<h1>Title</h1><p>Body</p>";
      const files = ["doc.pdf", "doc.docx", "plain.txt"].map((name) => ({
        path: path.join(allowed, name),
        content: html,
      }));
      const result = await handleWriteTool("write_multiple_files", { files });
      const text = result.content[0].text as string;
      for (const f of files) {
        const { size } = await fs.stat(f.path);
        expect(text).toContain(`${f.path} (${size} bytes)`);
      }
    });
  });
});

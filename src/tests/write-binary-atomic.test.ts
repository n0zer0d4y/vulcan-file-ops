/**
 * VFO-17: PDF/DOCX output goes through writeBinaryFileAtomic ('wx' + atomic
 * rename), like text files.
 */

import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { handleWriteTool } from "../tools/write-tools.js";
import { handleReadTool } from "../tools/read-tools.js";
import { setAllowedDirectories, getAllowedDirectories } from "../utils/lib.js";

const ROOT = path.join(
  os.tmpdir(),
  `vulcan-test-binary-atomic-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
);
const WORKSPACE = path.join(ROOT, "allowed");
const OUTSIDE = path.join(ROOT, "outside");

const posixTest = process.platform === "win32" ? test.skip : test;

async function listTempFiles(dir: string): Promise<string[]> {
  return (await fs.readdir(dir)).filter((f) => f.endsWith(".tmp"));
}

describe("atomic PDF/DOCX writes (VFO-17)", () => {
  let originalDirs: string[];

  beforeAll(async () => {
    await fs.mkdir(WORKSPACE, { recursive: true });
    await fs.mkdir(OUTSIDE, { recursive: true });
    originalDirs = getAllowedDirectories();
    setAllowedDirectories([...originalDirs, WORKSPACE]);
  });

  afterAll(async () => {
    setAllowedDirectories(originalDirs);
    await fs.rm(ROOT, { recursive: true, force: true });
  });

  test("overwrites an existing PDF (HTML) via the atomic replace path", async () => {
    const pdfPath = path.join(WORKSPACE, "report.pdf");
    await handleWriteTool("write_file", { path: pdfPath, content: "<h1>First version</h1>" });
    await handleWriteTool("write_file", { path: pdfPath, content: "<h1>Second version</h1>" });

    const bytes = await fs.readFile(pdfPath);
    expect(bytes.toString("latin1", 0, 4)).toBe("%PDF");
    expect(bytes.toString("latin1")).toContain("Second version");
    expect(bytes.toString("latin1")).not.toContain("First version");
    expect(await listTempFiles(WORKSPACE)).toEqual([]);
  });

  test("overwrites an existing plain-text PDF", async () => {
    const pdfPath = path.join(WORKSPACE, "plain.pdf");
    await handleWriteTool("write_file", { path: pdfPath, content: "first" });
    const first = await fs.readFile(pdfPath);
    await handleWriteTool("write_file", { path: pdfPath, content: "second, longer text" });
    const second = await fs.readFile(pdfPath);
    expect((await fs.lstat(pdfPath)).isFile()).toBe(true);
    expect(second.toString("latin1", 0, 4)).toBe("%PDF");
    expect(second.equals(first)).toBe(false);
    expect(await listTempFiles(WORKSPACE)).toEqual([]);
  });

  test("overwrites existing DOCX files (plain text and HTML)", async () => {
    const docxPath = path.join(WORKSPACE, "notes.docx");
    await handleWriteTool("write_file", { path: docxPath, content: "Old text" });
    await handleWriteTool("write_file", { path: docxPath, content: "New text" });
    const readText = async () =>
      ((await handleReadTool("read_file", { path: docxPath })) as any).content[0]
        .text as string;
    let text = await readText();
    expect(text).toContain("New text");
    expect(text).not.toContain("Old text");

    await handleWriteTool("write_file", { path: docxPath, content: "<p>HTML version</p>" });
    text = await readText();
    expect(text).toContain("HTML version");
    expect(await listTempFiles(WORKSPACE)).toEqual([]);
  });

  test("write_multiple_files overwrites existing PDF and DOCX files", async () => {
    const pdfPath = path.join(WORKSPACE, "multi.pdf");
    const docxPath = path.join(WORKSPACE, "multi.docx");
    await fs.writeFile(pdfPath, "placeholder");
    await fs.writeFile(docxPath, "placeholder");

    const result: any = await handleWriteTool("write_multiple_files", {
      files: [
        { path: pdfPath, content: "<p>Batch PDF</p>" },
        { path: docxPath, content: "Batch DOCX" },
      ],
    });
    expect(result.content[0].text).toContain("All files written successfully.");
    expect((await fs.readFile(pdfPath)).toString("latin1", 0, 4)).toBe("%PDF");
    expect((await fs.readFile(docxPath)).toString("latin1", 0, 2)).toBe("PK");
  });

  test("write_multiple_files rejects the whole batch when any path is invalid", async () => {
    const okPath = path.join(WORKSPACE, "never-written.pdf");
    await expect(
      handleWriteTool("write_multiple_files", {
        files: [
          { path: okPath, content: "x" },
          { path: path.join(OUTSIDE, "evil.pdf"), content: "x" },
        ],
      })
    ).rejects.toThrow(/Invalid file paths:[\s\S]*evil\.pdf/);
    await expect(fs.access(okPath)).rejects.toThrow();
  });

  posixTest.each(["link.pdf", "link.docx"])(
    "replaces a pre-existing (dangling) symlink %s instead of writing through it",
    async (name) => {
      const linkPath = path.join(WORKSPACE, name);
      const outsideTarget = path.join(OUTSIDE, `target-${name}`);
      await fs.symlink(outsideTarget, linkPath);

      await handleWriteTool("write_file", { path: linkPath, content: "<p>Inside</p>" });

      const st = await fs.lstat(linkPath);
      expect(st.isSymbolicLink()).toBe(false);
      expect(st.isFile()).toBe(true);
      await expect(fs.access(outsideTarget)).rejects.toThrow();
    }
  );
});

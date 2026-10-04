/**
 * VFO-15: size caps for read_file / read_multiple_files (full mode) and
 * attach_image, and bounded memory for head/tail/range reads.
 * Large files are created sparsely with truncate().
 */

import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { handleReadTool } from "../tools/read-tools.js";
import { setAllowedDirectories, getAllowedDirectories } from "../utils/lib.js";
import {
  MAX_IMAGE_ATTACH_BYTES,
  MAX_TEXT_READ_BYTES,
} from "../utils/limits.js";

const WORKSPACE = path.join(
  os.tmpdir(),
  `vulcan-test-read-limits-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
);
const MB = 1024 * 1024;
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

/** Create a file with `prefix`, extended (sparsely, with NULs) to `size` bytes, then `suffix`. */
async function makeFile(
  name: string,
  size: number,
  prefix = "",
  suffix = ""
): Promise<string> {
  const p = path.join(WORKSPACE, name);
  await fs.writeFile(p, prefix);
  await fs.truncate(p, size);
  if (suffix) await fs.appendFile(p, suffix);
  return p;
}

const textOf = (result: any) => result.content[0].text as string;

describe("read size limits (VFO-15)", () => {
  let originalDirs: string[];

  beforeAll(async () => {
    await fs.mkdir(WORKSPACE, { recursive: true });
    originalDirs = getAllowedDirectories();
    setAllowedDirectories([...originalDirs, WORKSPACE]);
  });

  afterAll(async () => {
    setAllowedDirectories(originalDirs);
    await fs.rm(WORKSPACE, { recursive: true, force: true });
  });

  describe("read_file full mode", () => {
    test("rejects text files above the cap with a hint to use partial modes", async () => {
      const big = await makeFile("big.log", MAX_TEXT_READ_BYTES + 1, "line1\n");
      await expect(
        handleReadTool("read_file", { path: big })
      ).rejects.toThrow(/too large to read in full mode.*"head", "tail" or "range"/);
      // mode omitted and mode "full" behave the same
      await expect(
        handleReadTool("read_file", { path: big, mode: "full" })
      ).rejects.toThrow(/10\.0 MB/);
    });

    test("reads files at exactly the cap", async () => {
      const edge = await makeFile("edge.txt", MAX_TEXT_READ_BYTES, "hello");
      const text = textOf(await handleReadTool("read_file", { path: edge }));
      expect(text.length).toBe(MAX_TEXT_READ_BYTES);
      expect(text.startsWith("hello")).toBe(true);
    });

    test("head/range still work on files above the cap", async () => {
      const big = await makeFile(
        "big-lines.log",
        MAX_TEXT_READ_BYTES + MB,
        "line1\nline2\nline3\n"
      );
      expect(
        textOf(await handleReadTool("read_file", { path: big, mode: "head", lines: 2 }))
      ).toBe("line1\nline2");
      expect(
        textOf(
          await handleReadTool("read_file", {
            path: big,
            mode: "range",
            startLine: 2,
            endLine: 3,
          })
        )
      ).toBe("line2\nline3");
    });

    test("tail works on a large file whose last lines are short", async () => {
      const big = await makeFile("big-tail.log", MAX_TEXT_READ_BYTES + MB, "", "\nalpha\nbeta");
      expect(
        textOf(await handleReadTool("read_file", { path: big, mode: "tail", lines: 2 }))
      ).toBe("alpha\nbeta");
    });

    test("range skips a huge line before the requested range", async () => {
      const big = await makeFile("huge-first-line.log", MAX_TEXT_READ_BYTES + MB, "", "\nx\ny\n");
      expect(
        textOf(
          await handleReadTool("read_file", {
            path: big,
            mode: "range",
            startLine: 2,
            endLine: 3,
          })
        )
      ).toBe("x\ny");
    });

    test("head/tail/range refuse to buffer a single line above the cap", async () => {
      const oneLine = await makeFile("one-line.bin", MAX_TEXT_READ_BYTES + MB);
      await expect(
        handleReadTool("read_file", { path: oneLine, mode: "head", lines: 1 })
      ).rejects.toThrow(/read limit/);
      await expect(
        handleReadTool("read_file", { path: oneLine, mode: "tail", lines: 1 })
      ).rejects.toThrow(/read limit/);
      await expect(
        handleReadTool("read_file", {
          path: oneLine,
          mode: "range",
          startLine: 1,
          endLine: 1,
        })
      ).rejects.toThrow(/read limit/);
    }, 30000);
  });

  describe("read_multiple_files full mode", () => {
    test("reports oversized files per file without failing the others", async () => {
      const big = await makeFile("multi-big.txt", MAX_TEXT_READ_BYTES + 1);
      const small = path.join(WORKSPACE, "multi-small.txt");
      await fs.writeFile(small, "small content");

      const text = textOf(
        await handleReadTool("read_multiple_files", {
          files: [{ path: big }, { path: small, mode: "full" }],
        })
      );
      expect(text).toContain(`${big}: Error - File is too large to read in full mode`);
      expect(text).toContain("small content");
    });

    test("allows head mode on oversized files", async () => {
      const big = await makeFile("multi-big-head.txt", MAX_TEXT_READ_BYTES + 1, "first\nsecond\n");
      const text = textOf(
        await handleReadTool("read_multiple_files", {
          files: [{ path: big, mode: "head", lines: 1 }],
        })
      );
      expect(text).toContain("first");
      expect(text).not.toContain("Error");
    });
  });

  describe("attach_image", () => {
    test("attaches images within the limits", async () => {
      const img = path.join(WORKSPACE, "ok.png");
      await fs.writeFile(img, PNG_1x1);
      const result: any = await handleReadTool("attach_image", { path: [img] });
      expect(result.content[0].data).toBe(PNG_1x1.toString("base64"));
    });

    test("rejects a single image above the per-image cap and names it", async () => {
      const big = await makeFile("huge.png", MAX_IMAGE_ATTACH_BYTES + 1);
      const ok = path.join(WORKSPACE, "ok2.png");
      await fs.writeFile(ok, PNG_1x1);
      await expect(
        handleReadTool("attach_image", { path: [ok, big] })
      ).rejects.toThrow(
        new RegExp(`per-image limit: .*${path.basename(big).replace(".", "\\.")} \\(10\\.0 MB\\)`)
      );
    });

    test("rejects calls whose images exceed the total cap", async () => {
      const a = await makeFile("t1.png", 8 * MB);
      const b = await makeFile("t2.png", 8 * MB);
      const c = await makeFile("t3.png", 8 * MB);
      await expect(
        handleReadTool("attach_image", { path: [a, b, c] })
      ).rejects.toThrow(/total 24\.0 MB.*20\.0 MB limit per attach_image call/);
      // Two of them fit.
      const result: any = await handleReadTool("attach_image", { path: [a, b] });
      expect(result.content).toHaveLength(2);
    });
  });
});

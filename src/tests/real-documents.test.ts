/**
 * End-to-end PDF and DOCX round trips with the real libraries, against the
 * built server in dist/ (what users run).
 *
 * jest.config.cjs maps pdfmake, html-to-pdfmake, jsdom and pdf-parse to mocks,
 * so the other suites cannot notice when an upgrade breaks real output (pdfmake
 * 0.3 did). Here write_file and read_file run in a child Node process, where the
 * module mapping does not apply. dist/ is used rather than the ts-node loader,
 * because ts-node loads @turbodocx/html-to-docx's untyped ESM build as
 * CommonJS and fails. Run `npm run build` before `npm test`; CI does.
 */

import { describe, test, expect, beforeAll, afterAll, jest } from "@jest/globals";
import { promises as fs, existsSync, readdirSync, realpathSync, statSync } from "fs";
import path from "path";
import os from "os";
import { spawn } from "child_process";
import { pathToFileURL } from "url";

jest.setTimeout(120_000);

const repoRoot = process.cwd();
const distDir = path.join(repoRoot, "dist");
const distFile = (rel: string) => pathToFileURL(path.join(distDir, rel)).href;

// 1x1 PNG, embedded as an inline data: image.
const PNG_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// Markers avoid underscores: DOCX text is read back as Markdown, which escapes them.
const HTML = [
  "<h1>RealDocTitle</h1>",
  "<p>Paragraph with <b>bold</b> and <i>italic</i> text: RealDocBody</p>",
  "<ul><li>first item</li><li>second item</li></ul>",
  "<table><tr><td>CellAlpha</td><td>CellBeta</td></tr></table>",
  `<img src="${PNG_DATA_URI}">`,
].join("");

interface RoundTrip {
  ok: boolean;
  error?: string;
  readText?: string;
}

/** Newest modification time of the server sources (tests excluded). */
function newestSourceMtime(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "tests" || entry.name === "__tests__") continue;
      newest = Math.max(newest, newestSourceMtime(full));
    } else if (entry.name.endsWith(".ts")) {
      newest = Math.max(newest, statSync(full).mtimeMs);
    }
  }
  return newest;
}

let workspace: string;

async function roundTripInChild(fileName: string): Promise<RoundTrip> {
  const runner = path.join(workspace, `run-${fileName}.mjs`);
  const target = path.join(workspace, fileName);
  await fs.writeFile(
    runner,
    [
      `const { setAllowedDirectories } = await import(${JSON.stringify(distFile("utils/lib.js"))});`,
      `const { handleWriteTool } = await import(${JSON.stringify(distFile("tools/write-tools.js"))});`,
      `const { handleReadTool } = await import(${JSON.stringify(distFile("tools/read-tools.js"))});`,
      `setAllowedDirectories([${JSON.stringify(workspace)}]);`,
      "try {",
      `  await handleWriteTool("write_file", { path: ${JSON.stringify(target)}, content: ${JSON.stringify(HTML)} });`,
      `  const r = await handleReadTool("read_file", { path: ${JSON.stringify(target)} });`,
      "  process.stdout.write(JSON.stringify({ ok: true, readText: r.content.map((c) => c.text || '').join(' ') }));",
      "} catch (e) {",
      "  process.stdout.write(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }));",
      "}",
    ].join(String.fromCharCode(10))
  );
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runner], {
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", () => {
      try {
        resolve(JSON.parse(out));
      } catch {
        reject(new Error(`round-trip runner produced no result. stderr: ${err.slice(0, 500)}`));
      }
    });
  });
}

describe("real PDF and DOCX generation (built server, no mocks)", () => {
  beforeAll(async () => {
    const builtEntry = path.join(distDir, "tools", "write-tools.js");
    if (!existsSync(builtEntry)) {
      throw new Error("dist/ is missing. Run `npm run build` before `npm test`.");
    }
    if (statSync(builtEntry).mtimeMs < newestSourceMtime(path.join(repoRoot, "src"))) {
      throw new Error("dist/ is older than src/. Run `npm run build` before `npm test`.");
    }
    workspace = realpathSync.native(
      await fs.mkdtemp(path.join(os.tmpdir(), "vulcan-real-docs-"))
    );
  });

  afterAll(async () => {
    if (workspace) await fs.rm(workspace, { recursive: true, force: true });
  });

  test("writes a valid PDF and reads its text back", async () => {
    const result = await roundTripInChild("real.pdf");
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);

    const bytes = await fs.readFile(path.join(workspace, "real.pdf"));
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(bytes.subarray(-8).toString("latin1")).toContain("%%EOF");
    expect(bytes.toString("latin1")).toMatch(/\/Subtype\s*\/Image/);

    expect(result.readText).toContain("RealDocTitle");
    expect(result.readText).toContain("RealDocBody");
    expect(result.readText).toContain("CellBeta");
  });

  test("writes a valid DOCX and reads its text back", async () => {
    const result = await roundTripInChild("real.docx");
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);

    const bytes = await fs.readFile(path.join(workspace, "real.docx"));
    expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK");

    expect(result.readText).toContain("RealDocTitle");
    expect(result.readText).toContain("RealDocBody");
    expect(result.readText).toContain("CellBeta");
  });
});

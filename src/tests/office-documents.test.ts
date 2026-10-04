/**
 * Office/ODF text extraction through parseDocument (officeparser 7.x).
 * Fixtures are minimal, valid packages built in memory (with real CRCs).
 */

import { describe, test, expect, beforeAll, afterAll, jest } from "@jest/globals";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import zlib from "zlib";
import { spawn } from "child_process";
import { pathToFileURL } from "url";

// officeparser 7.x uses dynamic import() internally, which Jest's CommonJS
// runtime cannot execute without --experimental-vm-modules (and that mode
// breaks other suites). So documents are parsed by the real parseDocument in a
// child Node process, loaded with the same ts-node ESM loader as server-e2e.
jest.setTimeout(120_000);

const repoRoot = process.cwd();
const loaderUrl = pathToFileURL(
  path.join(repoRoot, "node_modules", "ts-node", "esm", "transpile-only.mjs")
).href;
const parserUrl = pathToFileURL(
  path.join(repoRoot, "src", "utils", "document-parser.ts")
).href;

interface ChildParseResult {
  ok: boolean;
  text?: string;
  parser?: string;
  format?: string;
  error?: string;
}

async function parseInChild(filePath: string): Promise<ChildParseResult> {
  const runner = path.join(WORKSPACE, "parse-runner.mjs");
  await fs.writeFile(
    runner,
    [
      `const { parseDocument } = await import(${JSON.stringify(parserUrl)});`,
      "try {",
      "  const r = await parseDocument(process.argv[2]);",
      "  process.stdout.write(JSON.stringify({ ok: true, text: r.text, parser: r.parser, format: r.metadata.format }));",
      "} catch (e) {",
      "  process.stdout.write(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }));",
      "}",
    ].join(String.fromCharCode(10))
  );
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--loader", loaderUrl, runner, filePath], {
      env: { ...process.env, TS_NODE_PROJECT: path.join(repoRoot, "tsconfig.json"), NODE_NO_WARNINGS: "1" },
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
        reject(new Error(`parse runner produced no result. stderr: ${err.slice(0, 500)}`));
      }
    });
  });
}

const WORKSPACE = path.join(
  os.tmpdir(),
  `vulcan-test-office-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
);

/** Minimal ZIP writer: deflated entries (stored for "mimetype") with CRC-32. */
function buildZip(entries: Array<[string, string]>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const data = Buffer.from(text, "utf8");
    const method = name === "mimetype" ? 0 : 8;
    const stored = method === 0 ? data : zlib.deflateRawSync(data);
    const crc = zlib.crc32(data);
    const nameBytes = Buffer.from(name, "utf8");

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);

    locals.push(local, nameBytes, stored);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + stored.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const OD_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const contentTypes = (overrides: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides}</Types>`;
const relationships = (type: string, target: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${type}" Target="${target}"/></Relationships>`;

function xlsx(cellText: string): Buffer {
  return buildZip([
    [
      "[Content_Types].xml",
      contentTypes(
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
      ),
    ],
    ["_rels/.rels", relationships(`${OD_REL}/officeDocument`, "xl/workbook.xml")],
    [
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${OD_REL}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ],
    ["xl/_rels/workbook.xml.rels", relationships(`${OD_REL}/worksheet`, "worksheets/sheet1.xml")],
    [
      "xl/worksheets/sheet1.xml",
      `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${cellText}</t></is></c><c r="B1"><v>42</v></c></row></sheetData></worksheet>`,
    ],
  ]);
}

function pptx(slideText: string): Buffer {
  return buildZip([
    [
      "[Content_Types].xml",
      contentTypes(
        `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
      ),
    ],
    ["_rels/.rels", relationships(`${OD_REL}/officeDocument`, "ppt/presentation.xml")],
    [
      "ppt/presentation.xml",
      `<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="${OD_REL}"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>`,
    ],
    ["ppt/_rels/presentation.xml.rels", relationships(`${OD_REL}/slide`, "slides/slide1.xml")],
    [
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${slideText}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    ],
  ]);
}

function odf(mime: string, body: string): Buffer {
  return buildZip([
    ["mimetype", mime],
    [
      "META-INF/manifest.xml",
      `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="${mime}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>`,
    ],
    [
      "content.xml",
      `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" office:version="1.2"><office:body>${body}</office:body></office:document-content>`,
    ],
  ]);
}

async function writeFixture(name: string, data: Buffer): Promise<string> {
  const p = path.join(WORKSPACE, name);
  await fs.writeFile(p, data);
  return p;
}

describe("Office/ODF documents via officeparser", () => {
  beforeAll(async () => {
    await fs.mkdir(WORKSPACE, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(WORKSPACE, { recursive: true, force: true });
  });

  test("extracts text from XLSX", async () => {
    const p = await writeFixture("sample.xlsx", xlsx("XLSX_CELL_ALPHA"));
    const result = await parseInChild(p);
    expect(result.ok).toBe(true);
    expect(result.parser).toBe("officeparser");
    expect(result.format).toBe("XLSX");
    expect(result.text).toContain("XLSX_CELL_ALPHA");
    expect(result.text).toContain("42");
  });

  test("extracts text from PPTX", async () => {
    const p = await writeFixture("sample.pptx", pptx("PPTX_SLIDE_TEXT"));
    const result = await parseInChild(p);
    expect(result.ok).toBe(true);
    expect(result.text).toContain("PPTX_SLIDE_TEXT");
  });

  test("extracts text from ODT", async () => {
    const p = await writeFixture(
      "sample.odt",
      odf(
        "application/vnd.oasis.opendocument.text",
        `<office:text><text:p>ODT_PARAGRAPH_TEXT</text:p></office:text>`
      )
    );
    const result = await parseInChild(p);
    expect(result.ok).toBe(true);
    expect(result.text).toContain("ODT_PARAGRAPH_TEXT");
  });

  test("extracts text from ODS", async () => {
    const p = await writeFixture(
      "sample.ods",
      odf(
        "application/vnd.oasis.opendocument.spreadsheet",
        `<office:spreadsheet><table:table table:name="Sheet1"><table:table-row><table:table-cell office:value-type="string"><text:p>ODS_CELL_TEXT</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet>`
      )
    );
    const result = await parseInChild(p);
    expect(result.ok).toBe(true);
    expect(result.text).toContain("ODS_CELL_TEXT");
  });

  test("extracts text from ODP", async () => {
    const p = await writeFixture(
      "sample.odp",
      odf(
        "application/vnd.oasis.opendocument.presentation",
        `<office:presentation><draw:page draw:name="page1"><draw:frame><draw:text-box><text:p>ODP_SLIDE_TEXT</text:p></draw:text-box></draw:frame></draw:page></office:presentation>`
      )
    );
    const result = await parseInChild(p);
    expect(result.ok).toBe(true);
    expect(result.text).toContain("ODP_SLIDE_TEXT");
  });

  test("bounds an ODS 'repeated cells' expansion bomb", async () => {
    // A few hundred bytes of XML that claims ~16 billion cells; ZIP sizes look
    // harmless, so only officeparser's table-cell limit (1,000,000 cells by
    // default) can stop it. The parse is truncated at the limit, not rejected.
    const p = await writeFixture(
      "cells-bomb.ods",
      odf(
        "application/vnd.oasis.opendocument.spreadsheet",
        `<office:spreadsheet><table:table table:name="Sheet1"><table:table-row table:number-rows-repeated="1000000"><table:table-cell table:number-columns-repeated="16384" office:value-type="string"><text:p>x</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet>`
      )
    );
    const started = Date.now();
    const result = await parseInChild(p);
    const elapsed = Date.now() - started;
    expect(result.ok).toBe(true);
    // ~1M cells of "x" plus separators: bounded, not 16 billion.
    expect(result.text!.length).toBeLessThan(5 * 1024 * 1024);
    expect(elapsed).toBeLessThan(60_000);
  });
});

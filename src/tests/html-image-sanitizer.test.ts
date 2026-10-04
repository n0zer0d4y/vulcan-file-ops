/**
 * VFO-13: image sanitization for HTML -> PDF/DOCX conversion.
 *
 * Note: pdfmake, html-to-pdfmake and jsdom are mocked in Jest (see
 * jest.config.cjs), so the real-library behavior (no crash/hang with the real
 * pdfmake) is verified separately outside Jest. html-to-docx is NOT mocked.
 */

import { describe, test, expect, jest, afterEach } from "@jest/globals";
import http from "http";
import zlib from "zlib";
import type { AddressInfo } from "net";
import {
  sanitizeHtmlImages,
  normalizeEmbeddableImageSrc,
  scrubPdfmakeImages,
  isPngSafeForPdfkit,
} from "../utils/html-image-sanitizer.js";
import {
  convertHTMLToPDF,
  convertHTMLToDOCX,
} from "../utils/html-to-document.js";

// 1x1 RGBA PNG
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PNG_URL = `data:image/png;base64,${PNG_B64}`;
const GIF_B64 = "R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const b of buf) {
    let c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function buildPng(opts: {
  width: number;
  height: number;
  colorType: number;
  idat: Buffer;
  interlace?: number;
  extra?: Buffer[];
}): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(opts.width, 0);
  ihdr.writeUInt32BE(opts.height, 4);
  ihdr[8] = 8;
  ihdr[9] = opts.colorType;
  ihdr[12] = opts.interlace ?? 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    ...(opts.extra ?? []),
    pngChunk("IDAT", opts.idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("normalizeEmbeddableImageSrc", () => {
  test("accepts a valid PNG data URL", () => {
    expect(normalizeEmbeddableImageSrc(PNG_URL)).toBe(PNG_URL);
  });

  test("normalizes jpg -> jpeg, case and embedded whitespace", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]).toString("base64");
    expect(
      normalizeEmbeddableImageSrc(`  DATA:image/JPG;base64,${jpeg.slice(0, 4)}\n${jpeg.slice(4)} `),
    ).toBe(`data:image/jpeg;base64,${jpeg}`);
  });

  test.each([
    ["relative path", "logo.png"],
    ["absolute path", "/etc/passwd"],
    ["windows path", "C:\\Windows\\win.ini"],
    ["file URL", "file:///etc/passwd"],
    ["http URL", "http://127.0.0.1/x.png"],
    ["https URL", "https://example.com/x.png"],
    ["protocol-relative", "//example.com/x.png"],
    ["svg data URL", "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="],
    ["non-base64 data URL", "data:image/png,rawbytes"],
    ["invalid base64", "data:image/png;base64,!!!notbase64"],
    ["bad base64 length", "data:image/png;base64,iVBORw0KG"],
    ["empty body", "data:image/png;base64,"],
    ["entity-encoded prefix", "&#100;ata:image/png;base64," + PNG_B64],
    ["declared type does not match content", `data:image/jpeg;base64,${PNG_B64}`],
    ["text/html data URL", "data:text/html;base64,PGgxPmhpPC9oMT4="],
  ])("rejects %s", (_name, src) => {
    expect(normalizeEmbeddableImageSrc(src)).toBeNull();
  });

  test("rejects non-string values", () => {
    expect(normalizeEmbeddableImageSrc(undefined)).toBeNull();
    expect(normalizeEmbeddableImageSrc({ url: PNG_URL })).toBeNull();
  });

  test("rejects images larger than the size cap", () => {
    expect(normalizeEmbeddableImageSrc(PNG_URL, { maxImageBytes: 10 })).toBeNull();
    // ~11 MB decoded with the default 10 MB cap
    const big = Buffer.alloc(11 * 1024 * 1024);
    Buffer.from(PNG_B64, "base64").copy(big);
    expect(
      normalizeEmbeddableImageSrc(`data:image/png;base64,${big.toString("base64")}`),
    ).toBeNull();
  });

  test("honors allowedTypes", () => {
    const gif = `data:image/gif;base64,${GIF_B64}`;
    expect(normalizeEmbeddableImageSrc(gif)).toBe(gif);
    expect(normalizeEmbeddableImageSrc(gif, { allowedTypes: ["png", "jpeg"] })).toBeNull();
  });
});

describe("sanitizeHtmlImages", () => {
  test.each([
    ["relative", `<img src="logo.png" alt="Logo">`],
    ["absolute", `<img src="/var/www/logo.png" alt="Logo">`],
    ["http", `<img src="http://127.0.0.1:1/x.png" alt="Logo">`],
    ["https", `<img src="https://example.com/x.png" alt="Logo">`],
    ["file", `<img src="file:///C:/Windows/win.ini" alt="Logo">`],
    ["unquoted", `<img src=http://127.0.0.1:1/x.png alt=Logo>`],
    ["single-quoted", `<img src='logo.png' alt='Logo'>`],
    ["uppercase tag", `<IMG SRC="logo.png" ALT="Logo">`],
    ["slash separators", `<img/src="logo.png"/alt="Logo"/>`],
    ["newline separators", `<img\nsrc="logo.png"\nalt="Logo">`],
    ["malformed data URL", `<img src="data:image/png;base64,%%%" alt="Logo">`],
    ["svg data URL", `<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" alt="Logo">`],
    ["image tag", `<image src="logo.png" alt="Logo">`],
  ])("replaces %s image with its alt text", (_name, html) => {
    expect(sanitizeHtmlImages(`<p>${html}</p>`)).toBe("<p>Logo</p>");
  });

  test("removes images without alt text", () => {
    expect(sanitizeHtmlImages(`<p>a<img src="logo.png">b</p>`)).toBe("<p>ab</p>");
  });

  test("escapes alt text and decodes basic entities once", () => {
    expect(
      sanitizeHtmlImages(`<img src="x.png" alt="<script>&amp;&quot;&#65;&#x42;">`),
    ).toBe("&lt;script&gt;&amp;&quot;AB");
  });

  test("keeps a valid data URL image and its presentational attributes", () => {
    const out = sanitizeHtmlImages(
      `<p><img alt="ok" src="${PNG_URL}" width="20" style="margin:0"></p>`,
    );
    expect(out).toBe(
      `<p><img alt="ok" src="${PNG_URL}" width="20" style="margin:0"></p>`,
    );
  });

  test("drops srcset and data-src even when src is valid", () => {
    const out = sanitizeHtmlImages(
      `<img src="${PNG_URL}" srcset="http://127.0.0.1:1/a.png 2x" data-src="b.png" alt="x">`,
    );
    expect(out).toBe(`<img src="${PNG_URL}" alt="x">`);
  });

  test("replaces images that only have srcset", () => {
    expect(
      sanitizeHtmlImages(`<img srcset="http://127.0.0.1:1/a.png 1x, b.png 2x" alt="s">`),
    ).toBe("s");
  });

  test("strips src/srcset from <source> elements", () => {
    expect(
      sanitizeHtmlImages(
        `<picture><source srcset="http://x/a.webp" type="image/webp"><img src="b.png" alt="p"></picture>`,
      ),
    ).toBe(`<picture><source type="image/webp">p</picture>`);
  });

  test("uses the first of duplicate attributes, like an HTML parser", () => {
    expect(sanitizeHtmlImages(`<img src="logo.png" src="${PNG_URL}" alt="d">`)).toBe("d");
    expect(sanitizeHtmlImages(`<img src="${PNG_URL}" src="logo.png">`)).toBe(
      `<img src="${PNG_URL}">`,
    );
  });

  test("rejects an image when any source attribute is not allowed", () => {
    expect(
      sanitizeHtmlImages(`<image href="${PNG_URL}" xlink:href="http://x/y.png" alt="z">`),
    ).toBe("z");
  });

  test("handles '>' inside quoted attribute values", () => {
    expect(sanitizeHtmlImages(`<img alt="a > b" src="logo.png">tail`)).toBe(
      "a &gt; btail",
    );
  });

  test("drops an unterminated image tag at end of input", () => {
    expect(sanitizeHtmlImages(`<p>x</p><img src="http://x/y.png`)).toBe("<p>x</p>");
  });

  test("sanitizes image tags inside comments and attribute values too", () => {
    expect(sanitizeHtmlImages(`<!-- <img src="a.png"> -->`)).toBe("<!--  -->");
    expect(sanitizeHtmlImages(`<a title="<img src=a.png>">t</a>`)).toBe(`<a title="">t</a>`);
  });

  test("leaves unrelated markup untouched", () => {
    const html = `<h1 class="t">Title</h1><p style="color: red">it's "quoted"</p><imgx src="a"><table><tr><td>1</td></tr></table>`;
    expect(sanitizeHtmlImages(html)).toBe(html);
  });

  test("escapes quotes in kept attribute values", () => {
    expect(sanitizeHtmlImages(`<img src='${PNG_URL}' title='say "hi"'>`)).toBe(
      `<img src="${PNG_URL}" title="say &quot;hi&quot;">`,
    );
  });
});

describe("scrubPdfmakeImages", () => {
  test("replaces non-data image nodes anywhere in the tree", () => {
    const tree: any = [
      { text: "a" },
      { image: "logo.png", width: 10 },
      { table: { body: [[{ image: "http://x/y.png" }, { image: PNG_URL }]] } },
      { stack: [{ image: { url: "x" } }] },
    ];
    scrubPdfmakeImages(tree);
    expect(tree[1]).toEqual({ text: "" });
    expect(tree[2].table.body[0][0]).toEqual({ text: "" });
    expect(tree[2].table.body[0][1]).toEqual({ image: PNG_URL });
    expect(tree[3].stack[0]).toEqual({ text: "" });
  });
});

describe("isPngSafeForPdfkit", () => {
  const MAX = 16 * 1024 * 1024;

  test("accepts a valid RGBA PNG", () => {
    expect(isPngSafeForPdfkit(Buffer.from(PNG_B64, "base64"), MAX)).toBe(true);
  });

  test("rejects an RGBA PNG whose IDAT is not a zlib stream", () => {
    const png = buildPng({ width: 4, height: 4, colorType: 6, idat: Buffer.from("not zlib data") });
    expect(isPngSafeForPdfkit(png, MAX)).toBe(false);
  });

  test("rejects an RGBA PNG with an invalid scanline filter", () => {
    const raw = Buffer.alloc(5);
    raw[0] = 7;
    const png = buildPng({ width: 1, height: 1, colorType: 6, idat: zlib.deflateSync(raw) });
    expect(isPngSafeForPdfkit(png, MAX)).toBe(false);
  });

  test("rejects an IDAT decompression bomb", () => {
    const png = buildPng({
      width: 1,
      height: 1,
      colorType: 6,
      idat: zlib.deflateSync(Buffer.alloc(8 * 1024 * 1024)),
    });
    expect(isPngSafeForPdfkit(png, MAX)).toBe(false);
  });

  test("rejects decoded images above the pixel cap", () => {
    const png = buildPng({ width: 5000, height: 5000, colorType: 6, idat: zlib.deflateSync(Buffer.alloc(1)) });
    expect(isPngSafeForPdfkit(png, MAX)).toBe(false);
  });

  test("accepts a valid interlaced RGBA PNG", () => {
    const passes = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
    const raw: number[] = [];
    for (const [x0, y0, dx, dy] of passes) {
      const w = Math.ceil((8 - x0) / dx);
      const h = Math.ceil((8 - y0) / dy);
      for (let r = 0; r < h; r++) {
        raw.push(0);
        for (let i = 0; i < w; i++) raw.push(1, 2, 3, 255);
      }
    }
    const png = buildPng({ width: 8, height: 8, colorType: 6, interlace: 1, idat: zlib.deflateSync(Buffer.from(raw)) });
    expect(isPngSafeForPdfkit(png, MAX)).toBe(true);
  });

  test("does not decode opaque, non-interlaced PNGs (embedded verbatim)", () => {
    const png = buildPng({ width: 4, height: 4, colorType: 2, idat: Buffer.from("garbage") });
    expect(isPngSafeForPdfkit(png, MAX)).toBe(true);
  });

  test("rejects truncated PNGs", () => {
    const png = Buffer.from(PNG_B64, "base64");
    expect(isPngSafeForPdfkit(png.subarray(0, 30), MAX)).toBe(false);
  });
});

describe("HTML -> PDF/DOCX image handling", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([
    `<h1>R</h1><img src="logo.png">`,
    `<h1>R</h1><img src="http://127.0.0.1:1/x.png" alt="remote">`,
    `<h1>R</h1><img src="file:///etc/passwd">`,
    `<h1>R</h1><img src="data:image/png;base64,broken">`,
    `<h1>R</h1><img src="${PNG_URL}">`,
  ])("PDF conversion resolves for %s", async (html) => {
    const buffer = await convertHTMLToPDF(html);
    expect(buffer.toString("latin1", 0, 4)).toBe("%PDF");
  });

  test("PDF rendering errors reject instead of hanging", async () => {
    const mod: any = await import("pdfmake/build/pdfmake.js");
    const pdfMake = mod.default || mod;
    jest.spyOn(pdfMake, "createPdf").mockImplementation(() => {
      // pdfmake throws strings, e.g. for invalid images
      throw "Invalid image: File 'logo.png' not found in virtual file system";
    });
    await expect(convertHTMLToPDF("<p>x</p>")).rejects.toThrow(
      /Failed to convert HTML to PDF: Invalid image/,
    );
  });

  test("PDF stream errors reject", async () => {
    const mod: any = await import("pdfmake/build/pdfmake.js");
    const pdfMake = mod.default || mod;
    const { PassThrough } = await import("stream");
    jest.spyOn(pdfMake, "createPdf").mockImplementation(() => ({
      getStream: () => {
        const s = new PassThrough();
        (s as any).end = () => {
          setImmediate(() => s.emit("error", new Error("boom")));
          return s;
        };
        return s;
      },
    }));
    await expect(convertHTMLToPDF("<p>x</p>")).rejects.toThrow(/boom/);
  });

  test("PDF rendering that never finishes times out", async () => {
    const mod: any = await import("pdfmake/build/pdfmake.js");
    const pdfMake = mod.default || mod;
    const { PassThrough } = await import("stream");
    jest.spyOn(pdfMake, "createPdf").mockImplementation(() => ({
      getStream: () => {
        const s = new PassThrough();
        (s as any).end = () => s; // never emits 'end'
        return s;
      },
    }));
    await expect(convertHTMLToPDF("<p>x</p>", { timeoutMs: 200 })).rejects.toThrow(
      /timed out after 200 ms/,
    );
  });

  test("DOCX conversion never fetches image URLs and still embeds data URLs", async () => {
    const hits: string[] = [];
    const server = http.createServer((req, res) => {
      hits.push(req.url ?? "");
      res.writeHead(200, { "content-type": "image/png" });
      res.end(Buffer.from(PNG_B64, "base64"));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const remote = await convertHTMLToDOCX(
        `<p>x</p><img src="http://127.0.0.1:${port}/q.png"><img src=http://127.0.0.1:${port}/u.png alt=u>` +
          `<img srcset="http://127.0.0.1:${port}/s.png 1x" alt="s">`,
      );
      expect(remote.toString("latin1", 0, 2)).toBe("PK");
      expect(remote.toString("latin1")).not.toMatch(/word\/media\//);

      const inline = await convertHTMLToDOCX(`<p>x</p><img src="${PNG_URL}" alt="ok">`);
      expect(inline.toString("latin1")).toMatch(/word\/media\//);

      expect(hits).toEqual([]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 30000);
});

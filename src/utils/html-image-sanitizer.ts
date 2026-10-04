/**
 * Image sanitization for HTML that is converted to PDF/DOCX (VFO-13).
 *
 * Only inline `data:image/...;base64,` images are allowed into generated
 * documents. Every other image reference (relative/absolute paths, `file:`,
 * `http(s):`, malformed data URLs, `srcset`, ...) is replaced with the image's
 * `alt` text, because:
 *   - pdfmake's browser build rejects such images inside its own promise chain,
 *     which previously hung the write and crashed the server (unhandled
 *     rejection), and
 *   - html-to-docx downloads `http(s):` image URLs (server-side request).
 *
 * The sanitizer is a small tokenizer that follows the WHATWG HTML tag and
 * attribute tokenization rules. It deliberately over-approximates: every
 * `<img`, `<image` and `<source` start tag anywhere in the input (including
 * inside comments, attribute values or raw-text elements) is rewritten, so a
 * downstream parser can never see an image tag that was not sanitized. Image
 * tags are re-serialized canonically (first attribute wins, values re-quoted)
 * so the downstream parser sees exactly the attributes that were validated.
 */

import zlib from "zlib";
import {
  MAX_DECODED_IMAGE_PIXELS,
  MAX_EMBEDDED_IMAGE_BYTES,
} from "./limits.js";

export type EmbeddableImageType = "png" | "jpeg" | "gif" | "webp" | "bmp";

export const ALL_EMBEDDABLE_IMAGE_TYPES: readonly EmbeddableImageType[] = [
  "png",
  "jpeg",
  "gif",
  "webp",
  "bmp",
];

export interface ImageSanitizeOptions {
  /** Image types to keep. Defaults to all {@link ALL_EMBEDDABLE_IMAGE_TYPES}. */
  allowedTypes?: readonly EmbeddableImageType[];
  /** Maximum decoded image size in bytes. Defaults to MAX_EMBEDDED_IMAGE_BYTES. */
  maxImageBytes?: number;
  /**
   * Fully validate PNGs that pdfkit would decode asynchronously (see
   * {@link isPngSafeForPdfkit}). Required for the PDF path.
   */
  verifyPngForPdfkit?: boolean;
  /** Maximum pixels for PNGs that must be decoded. Defaults to MAX_DECODED_IMAGE_PIXELS. */
  maxDecodedPixels?: number;
  /** Optional per-conversion memo of `src -> normalized src | null`. */
  memo?: Map<string, string | null>;
}

const DATA_URL_PREFIX_RE =
  /^data:image\/(png|jpe?g|gif|webp|bmp);base64,/i;
const BASE64_BODY_RE = /^[A-Za-z0-9+/]*={0,2}$/;
const HTML_WHITESPACE_RE = /[\t\n\f\r ]+/g;

function hasSignature(bytes: Buffer, type: EmbeddableImageType): boolean {
  switch (type) {
    case "png":
      return (
        bytes.length >= 8 &&
        bytes
          .subarray(0, 8)
          .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      );
    case "jpeg":
      return (
        bytes.length >= 3 &&
        bytes[0] === 0xff &&
        bytes[1] === 0xd8 &&
        bytes[2] === 0xff
      );
    case "gif": {
      const sig = bytes.subarray(0, 6).toString("latin1");
      return sig === "GIF87a" || sig === "GIF89a";
    }
    case "webp":
      return (
        bytes.length >= 12 &&
        bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
        bytes.subarray(8, 12).toString("latin1") === "WEBP"
      );
    case "bmp":
      return bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d;
  }
}

/**
 * Validate an image source and return its canonical form
 * (`data:image/<type>;base64,<base64 without whitespace>`), or `null` if the
 * source must not be embedded.
 */
export function normalizeEmbeddableImageSrc(
  src: unknown,
  options: ImageSanitizeOptions = {},
): string | null {
  if (typeof src !== "string") return null;
  const memo = options.memo;
  if (memo?.has(src)) return memo.get(src) ?? null;
  const result = normalizeImageSrcUncached(src, options);
  memo?.set(src, result);
  if (result !== null) memo?.set(result, result);
  return result;
}

function normalizeImageSrcUncached(
  src: string,
  options: ImageSanitizeOptions,
): string | null {
  const allowedTypes = options.allowedTypes ?? ALL_EMBEDDABLE_IMAGE_TYPES;
  const maxBytes = options.maxImageBytes ?? MAX_EMBEDDED_IMAGE_BYTES;

  // Cheap upper bound before any further work on very large strings:
  // base64 is 4 chars per 3 bytes; allow generous slack for whitespace.
  if (src.length > Math.ceil(maxBytes / 3) * 4 * 2 + 1024) return null;

  const trimmed = src.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, "");
  const prefix = DATA_URL_PREFIX_RE.exec(trimmed);
  if (!prefix) return null;

  const declared = prefix[1].toLowerCase();
  const type: EmbeddableImageType =
    declared === "jpg" ? "jpeg" : (declared as EmbeddableImageType);
  if (!allowedTypes.includes(type)) return null;

  const body = trimmed.slice(prefix[0].length).replace(HTML_WHITESPACE_RE, "");
  if (body.length === 0 || body.length % 4 !== 0) return null;
  if (!BASE64_BODY_RE.test(body)) return null;

  const padding = body.endsWith("==") ? 2 : body.endsWith("=") ? 1 : 0;
  const decodedBytes = (body.length / 4) * 3 - padding;
  if (decodedBytes > maxBytes) return null;

  // The declared type must match the actual content.
  const head = Buffer.from(body.slice(0, 16), "base64");
  if (!hasSignature(head, type)) return null;

  if (type === "png" && options.verifyPngForPdfkit) {
    const maxPixels = options.maxDecodedPixels ?? MAX_DECODED_IMAGE_PIXELS;
    if (!isPngSafeForPdfkit(Buffer.from(body, "base64"), maxPixels)) {
      return null;
    }
  }

  return `data:image/${type};base64,${body}`;
}

// ---------------------------------------------------------------------------
// PNG validation for pdfkit
// ---------------------------------------------------------------------------

const PNG_ALLOWED_BIT_DEPTHS: Record<number, readonly number[]> = {
  0: [1, 2, 4, 8, 16], // greyscale
  2: [8, 16], // truecolor
  3: [1, 2, 4, 8], // indexed
  4: [8, 16], // greyscale + alpha
  6: [8, 16], // truecolor + alpha
};

/**
 * pdfkit (bundled in pdfmake) embeds most PNGs as-is, but PNGs with an alpha
 * channel, indexed transparency (tRNS) or interlacing are decoded with png-js
 * inside an asynchronous zlib callback. Any error there (corrupt deflate
 * stream, invalid scanline filter) is thrown from that callback as an
 * uncaught exception, which terminates the server. Such PNGs are therefore
 * decoded here first, synchronously and with Node's zlib, replicating png-js'
 * scanline walk, so only images that png-js can decode without throwing are
 * embedded. Also bounds the memory png-js would allocate.
 */
export function isPngSafeForPdfkit(png: Buffer, maxPixels: number): boolean {
  try {
    let pos = 8;
    let ihdr: {
      width: number;
      height: number;
      bits: number;
      colorType: number;
      interlace: number;
    } | null = null;
    let hasPalette = false;
    let indexedTransparency = false;
    const idat: Buffer[] = [];
    let sawEnd = false;

    while (!sawEnd) {
      if (pos + 8 > png.length) return false;
      const length = png.readUInt32BE(pos);
      const type = png.toString("latin1", pos + 4, pos + 8);
      pos += 8;
      if (length > 0x7fffffff || pos + length + 4 > png.length) return false;
      const data = png.subarray(pos, pos + length);

      if (ihdr === null && type !== "IHDR") return false;
      switch (type) {
        case "IHDR":
          if (ihdr !== null || length !== 13) return false;
          ihdr = {
            width: data.readUInt32BE(0),
            height: data.readUInt32BE(4),
            bits: data[8],
            colorType: data[9],
            interlace: data[12],
          };
          if (data[10] !== 0 || data[11] !== 0) return false;
          break;
        case "PLTE":
          hasPalette = length > 0 && length % 3 === 0;
          break;
        case "IDAT":
          idat.push(data);
          break;
        case "tRNS":
          if (ihdr?.colorType === 3) indexedTransparency = true;
          break;
        case "IEND":
          sawEnd = true;
          break;
      }
      pos += length + 4; // data + CRC
    }

    if (!ihdr || idat.length === 0) return false;
    const { width, height, bits, colorType, interlace } = ihdr;
    if (width < 1 || height < 1 || width > 0x7fffffff || height > 0x7fffffff) {
      return false;
    }
    const allowedBits = PNG_ALLOWED_BIT_DEPTHS[colorType];
    if (!allowedBits || !allowedBits.includes(bits)) return false;
    if (interlace !== 0 && interlace !== 1) return false;
    if (colorType === 3 && !hasPalette) return false;

    const hasAlpha = colorType === 4 || colorType === 6;
    const needsDecode = hasAlpha || indexedTransparency || interlace === 1;
    if (!needsDecode) return true; // embedded verbatim, never decoded

    if (width * height > maxPixels) return false;

    // Same arithmetic as png-js (including its fractional pixelBytes).
    const colors = colorType === 2 || colorType === 6 ? 3 : 1;
    const pixelBytes = (bits * (colors + (hasAlpha ? 1 : 0))) / 8;
    const passes: Array<[number, number, number, number]> =
      interlace === 1
        ? [
            [0, 0, 8, 8],
            [4, 0, 8, 8],
            [0, 4, 4, 8],
            [2, 0, 4, 4],
            [0, 2, 2, 4],
            [1, 0, 2, 2],
            [0, 1, 1, 2],
          ]
        : [[0, 0, 1, 1]];

    let expected = 0;
    for (const [x0, y0, dx, dy] of passes) {
      const w = Math.ceil((width - x0) / dx);
      const h = Math.ceil((height - y0) / dy);
      if (h > 0) expected += h * (1 + Math.max(0, Math.ceil(pixelBytes * w)));
    }

    const compressed = Buffer.concat(idat);
    const { buffer: inflated, engine } = zlib.inflateSync(compressed, {
      info: true,
      maxOutputLength: expected + 1024,
    }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
    // Reject trailing data after the zlib stream (strict parity with pako).
    if (engine.bytesWritten !== compressed.length) return false;

    // Walk the scanlines exactly like png-js and check every filter byte.
    let p = 0;
    const length = inflated.length;
    for (const [x0, y0, dx, dy] of passes) {
      const w = Math.ceil((width - x0) / dx);
      const h = Math.ceil((height - y0) / dy);
      const rowBytes = Math.max(0, Math.ceil(pixelBytes * w));
      for (let row = 0; row < h && p < length; row++) {
        if (inflated[p++] > 4) return false;
        p += rowBytes;
      }
    }
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Minimal WHATWG-style tag tokenizer
// ---------------------------------------------------------------------------

interface ParsedTag {
  /** Attributes in source order; first occurrence of a name wins. */
  attributes: Map<string, string>;
  /** Index just past the closing `>`; -1 if the tag runs to end of input. */
  end: number;
}

const isTagWhitespace = (ch: string) =>
  ch === "\t" || ch === "\n" || ch === "\f" || ch === "\r" || ch === " ";

/**
 * Parse the attributes of a start tag whose name ends at `pos`.
 * Follows the HTML tokenizer states "before attribute name" through
 * "after attribute value (quoted)".
 */
function parseTagAttributes(html: string, pos: number): ParsedTag {
  const attributes = new Map<string, string>();
  const len = html.length;
  let i = pos;

  while (i < len) {
    // Before attribute name: skip whitespace and stray solidus.
    const ch = html[i];
    if (isTagWhitespace(ch) || ch === "/") {
      i++;
      continue;
    }
    if (ch === ">") {
      return { attributes, end: i + 1 };
    }

    // Attribute name (a leading "=" is part of the name per spec).
    let nameStart = i;
    i++;
    while (i < len) {
      const c = html[i];
      if (isTagWhitespace(c) || c === "/" || c === ">" || c === "=") break;
      i++;
    }
    const name = html.slice(nameStart, i).toLowerCase();

    // After attribute name.
    while (i < len && isTagWhitespace(html[i])) i++;
    let value = "";
    if (i < len && html[i] === "=") {
      i++;
      while (i < len && isTagWhitespace(html[i])) i++;
      if (i >= len) break;
      const q = html[i];
      if (q === '"' || q === "'") {
        const close = html.indexOf(q, i + 1);
        if (close === -1) {
          i = len; // EOF inside quoted value
          break;
        }
        value = html.slice(i + 1, close);
        i = close + 1;
      } else if (q !== ">") {
        const valueStart = i;
        while (i < len && !isTagWhitespace(html[i]) && html[i] !== ">") i++;
        value = html.slice(valueStart, i);
      }
    }
    if (!attributes.has(name)) attributes.set(name, value);
  }

  // EOF inside the tag: per spec the tag is dropped.
  return { attributes, end: -1 };
}

const NAMED_REFS: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Decode the character references that matter for alt text. */
function decodeBasicEntities(text: string): string {
  return text.replace(
    /&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]+);/g,
    (match, ref: string) => {
      if (ref[0] === "#") {
        const code =
          ref[1] === "x" || ref[1] === "X"
            ? parseInt(ref.slice(2), 16)
            : parseInt(ref.slice(1), 10);
        if (
          !Number.isFinite(code) ||
          code <= 0 ||
          code > 0x10ffff ||
          (code >= 0xd800 && code <= 0xdfff)
        ) {
          return "�";
        }
        return String.fromCodePoint(code);
      }
      const named = NAMED_REFS[ref.toLowerCase()];
      return named ?? match;
    },
  );
}

export function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SAFE_ATTR_NAME_RE = /^[a-zA-Z_:][-a-zA-Z0-9_:.]*$/;

/** Attributes that can make a converter fetch or reference an image. */
const IMAGE_SOURCE_ATTRS = new Set(["src", "href", "xlink:href"]);
const ALWAYS_DROPPED_ATTRS = new Set([
  "srcset",
  "data-src",
  "data-srcset",
  "lowsrc",
  "dynsrc",
  "longdesc",
  "usemap",
  "imagesizes",
  "imagesrcset",
]);

function serializeTag(tagName: string, attributes: Map<string, string>): string {
  let out = `<${tagName}`;
  for (const [name, value] of attributes) {
    if (!SAFE_ATTR_NAME_RE.test(name)) continue;
    // Keep character references as written (they decode identically when
    // re-parsed inside a double-quoted value); only the quote must be escaped.
    out += ` ${name}="${value.replace(/"/g, "&quot;")}"`;
  }
  return out + ">";
}

function sanitizeImageTag(
  tagName: string,
  attributes: Map<string, string>,
  options: ImageSanitizeOptions,
): string {
  const kept = new Map<string, string>();
  let hasSource = false;

  for (const [name, value] of attributes) {
    if (ALWAYS_DROPPED_ATTRS.has(name)) continue;
    if (IMAGE_SOURCE_ATTRS.has(name)) {
      const normalized = normalizeEmbeddableImageSrc(value, options);
      if (normalized === null) continue;
      kept.set(name, normalized);
      hasSource = true;
      continue;
    }
    kept.set(name, value);
  }

  // A disallowed source is not "partially" kept: if any source attribute was
  // rejected, the whole image is replaced (avoids parser disagreements over
  // which of src/href wins).
  const rejectedSource = [...attributes.keys()].some(
    (name) => IMAGE_SOURCE_ATTRS.has(name) && !kept.has(name),
  );

  if (hasSource && !rejectedSource) {
    return serializeTag(tagName, kept);
  }

  const alt = attributes.get("alt");
  return alt ? escapeHtmlText(decodeBasicEntities(alt)) : "";
}

function sanitizeSourceTag(attributes: Map<string, string>): string {
  const kept = new Map<string, string>();
  for (const [name, value] of attributes) {
    if (name === "src" || name === "srcset" || ALWAYS_DROPPED_ATTRS.has(name)) {
      continue;
    }
    kept.set(name, value);
  }
  return serializeTag("source", kept);
}

const IMAGE_TAG_START_RE = /<(img|image|source)(?=[\t\n\f\r />]|$)/giy;

/**
 * Rewrite every image-bearing tag in `html` so that only validated inline
 * `data:` images remain. Non-embeddable images are replaced with their
 * escaped `alt` text (or removed when there is none).
 */
export function sanitizeHtmlImages(
  html: string,
  options: ImageSanitizeOptions = {},
): string {
  let out = "";
  let last = 0;
  let searchFrom = 0;

  while (searchFrom < html.length) {
    const lt = html.indexOf("<", searchFrom);
    if (lt === -1) break;

    IMAGE_TAG_START_RE.lastIndex = lt;
    const match = IMAGE_TAG_START_RE.exec(html);
    if (!match) {
      searchFrom = lt + 1;
      continue;
    }

    const tagName = match[1].toLowerCase();
    const parsed = parseTagAttributes(html, lt + match[0].length);
    out += html.slice(last, lt);

    if (parsed.end === -1) {
      // Unterminated tag at end of input: drop it.
      last = html.length;
      break;
    }

    out +=
      tagName === "source"
        ? sanitizeSourceTag(parsed.attributes)
        : sanitizeImageTag(tagName, parsed.attributes, options);
    last = parsed.end;
    searchFrom = parsed.end;
  }

  return out + html.slice(last);
}

/**
 * Defense in depth for the PDF path: walk a pdfmake content tree and replace
 * any `image` node whose source is not an embeddable data URL (e.g. one that
 * entered through html-to-pdfmake's `data-pdfmake` attribute) with empty text.
 * Mutates and returns the tree.
 */
export function scrubPdfmakeImages<T>(
  content: T,
  options: ImageSanitizeOptions = {},
): T {
  const seen = new WeakSet<object>();

  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      if (seen.has(node)) return node;
      seen.add(node);
      for (let i = 0; i < node.length; i++) node[i] = visit(node[i]);
      return node;
    }
    if (node && typeof node === "object") {
      if (seen.has(node)) return node;
      seen.add(node);
      const record = node as Record<string, unknown>;
      if (Object.prototype.hasOwnProperty.call(record, "image")) {
        const normalized = normalizeEmbeddableImageSrc(record.image, options);
        if (normalized === null) return { text: "" };
        record.image = normalized;
      }
      for (const key of Object.keys(record)) {
        record[key] = visit(record[key]);
      }
    }
    return node;
  };

  return visit(content) as T;
}

/**
 * ZIP decompression-bomb guard for ZIP-based documents (VFO-15).
 *
 * Office Open XML (.docx/.xlsx/.pptx) and OpenDocument (.odt/.ods/.odp) files
 * are ZIP archives that mammoth (via JSZip) and officeparser (via yauzl)
 * inflate in memory. A small archive can expand to gigabytes, so before any
 * parser touches the file we:
 *
 *   1. Parse the End Of Central Directory record and the central directory
 *      (located from the tail of the file, the same way JSZip/yauzl find it)
 *      and enforce limits on entry count, total declared uncompressed size
 *      and per-entry compression ratio. ZIP64 and multi-disk archives are
 *      rejected (Office/ODF documents within our size limits never need them).
 *   2. Verify that no entry actually inflates beyond its declared size, by
 *      streaming each deflated entry through zlib and counting the output
 *      (nothing is kept in memory). Declared sizes are attacker-controlled and
 *      JSZip only checks them after inflating everything, so step 1 alone is
 *      not sufficient.
 *
 * No third-party dependencies.
 */

import { promises as fs, createReadStream } from "fs";
import zlib from "zlib";
import {
  ZIP_MAX_COMPRESSION_RATIO,
  ZIP_MAX_ENTRIES,
  ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES,
  ZIP_RATIO_CHECK_MIN_BYTES,
} from "./limits.js";

export interface ZipGuardLimits {
  maxTotalUncompressedBytes: number;
  maxEntries: number;
  maxCompressionRatio: number;
  ratioCheckMinBytes: number;
}

export const DEFAULT_ZIP_GUARD_LIMITS: Readonly<ZipGuardLimits> = {
  maxTotalUncompressedBytes: ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES,
  maxEntries: ZIP_MAX_ENTRIES,
  maxCompressionRatio: ZIP_MAX_COMPRESSION_RATIO,
  ratioCheckMinBytes: ZIP_RATIO_CHECK_MIN_BYTES,
};

/**
 * `invalid`: not a well-formed (non-ZIP64, single-disk) ZIP archive.
 * `unsupported`: ZIP64 / multi-disk archive.
 * `limit`: exceeds a decompression limit (possible zip bomb).
 */
export type UnsafeZipReason = "invalid" | "unsupported" | "limit";

export class UnsafeZipError extends Error {
  constructor(
    public readonly reason: UnsafeZipReason,
    message: string,
  ) {
    super(message);
    this.name = "UnsafeZipError";
  }
}

export interface ZipEntryInfo {
  name: string;
  flags: number;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

export interface ZipInspection {
  entries: ZipEntryInfo[];
  totalUncompressedBytes: number;
}

const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_EOCD_LOCATOR = 0x07064b50;
const SIG_CENTRAL_HEADER = 0x02014b50;
const SIG_LOCAL_HEADER = 0x04034b50;
const EOCD_MIN_SIZE = 22;
const MAX_COMMENT = 0xffff;
const CENTRAL_HEADER_SIZE = 46;
const LOCAL_HEADER_SIZE = 30;

function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function readAt(
  handle: fs.FileHandle,
  position: number,
  length: number,
): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(
      buffer,
      offset,
      length - offset,
      position + offset,
    );
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  return offset === length ? buffer : buffer.subarray(0, offset);
}

/**
 * Parse and validate the central directory of the ZIP file behind `handle`.
 * Only the EOCD search window (last 64 KiB + 22 bytes) and the central
 * directory itself are read.
 */
export async function inspectZipCentralDirectory(
  handle: fs.FileHandle,
  fileSize: number,
  limits: ZipGuardLimits = DEFAULT_ZIP_GUARD_LIMITS,
): Promise<ZipInspection> {
  if (fileSize < EOCD_MIN_SIZE) {
    throw new UnsafeZipError("invalid", "not a valid ZIP archive (file too small)");
  }

  // Locate the last EOCD signature, like JSZip and yauzl.
  const tailLength = Math.min(fileSize, EOCD_MIN_SIZE + MAX_COMMENT);
  const tailStart = fileSize - tailLength;
  const tail = await readAt(handle, tailStart, tailLength);
  let eocd = -1;
  for (let i = tail.length - EOCD_MIN_SIZE; i >= 0; i--) {
    if (tail.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) {
    throw new UnsafeZipError(
      "invalid",
      "not a valid ZIP archive (end of central directory not found)",
    );
  }
  const eocdAbs = tailStart + eocd;

  const diskNumber = tail.readUInt16LE(eocd + 4);
  const centralDirDisk = tail.readUInt16LE(eocd + 6);
  const entriesOnDisk = tail.readUInt16LE(eocd + 8);
  const totalEntries = tail.readUInt16LE(eocd + 10);
  const centralDirSize = tail.readUInt32LE(eocd + 12);
  const centralDirOffset = tail.readUInt32LE(eocd + 16);

  const zip64Locator =
    eocdAbs >= 20 &&
    (eocd >= 20
      ? tail.readUInt32LE(eocd - 20)
      : (await readAt(handle, eocdAbs - 20, 4)).readUInt32LE(0)) ===
      SIG_ZIP64_EOCD_LOCATOR;
  if (
    zip64Locator ||
    entriesOnDisk === 0xffff ||
    totalEntries === 0xffff ||
    centralDirSize === 0xffffffff ||
    centralDirOffset === 0xffffffff
  ) {
    throw new UnsafeZipError(
      "unsupported",
      "ZIP64 archives are not supported for document parsing",
    );
  }
  if (diskNumber !== 0 || centralDirDisk !== 0 || entriesOnDisk !== totalEntries) {
    throw new UnsafeZipError(
      "unsupported",
      "multi-disk ZIP archives are not supported for document parsing",
    );
  }
  if (totalEntries > limits.maxEntries) {
    throw new UnsafeZipError(
      "limit",
      `archive has ${totalEntries} entries (limit: ${limits.maxEntries})`,
    );
  }
  if (centralDirOffset + centralDirSize > eocdAbs) {
    throw new UnsafeZipError(
      "invalid",
      "not a valid ZIP archive (central directory out of bounds)",
    );
  }

  const cd = await readAt(handle, centralDirOffset, centralDirSize);
  if (cd.length !== centralDirSize) {
    throw new UnsafeZipError("invalid", "not a valid ZIP archive (truncated central directory)");
  }

  const entries: ZipEntryInfo[] = [];
  let total = 0;
  let p = 0;
  // Like JSZip, read every central header present (not just the declared
  // count) and require both to agree.
  while (p + 4 <= cd.length && cd.readUInt32LE(p) === SIG_CENTRAL_HEADER) {
    if (entries.length >= limits.maxEntries) {
      throw new UnsafeZipError(
        "limit",
        `archive has more than ${limits.maxEntries} entries`,
      );
    }
    if (p + CENTRAL_HEADER_SIZE > cd.length) {
      throw new UnsafeZipError("invalid", "not a valid ZIP archive (truncated central header)");
    }
    const flags = cd.readUInt16LE(p + 8);
    const method = cd.readUInt16LE(p + 10);
    const compressedSize = cd.readUInt32LE(p + 20);
    const uncompressedSize = cd.readUInt32LE(p + 24);
    const nameLength = cd.readUInt16LE(p + 28);
    const extraLength = cd.readUInt16LE(p + 30);
    const commentLength = cd.readUInt16LE(p + 32);
    const diskStart = cd.readUInt16LE(p + 34);
    const localHeaderOffset = cd.readUInt32LE(p + 42);
    const recordEnd =
      p + CENTRAL_HEADER_SIZE + nameLength + extraLength + commentLength;
    if (recordEnd > cd.length) {
      throw new UnsafeZipError("invalid", "not a valid ZIP archive (truncated central header)");
    }
    const name = cd.toString(
      "utf8",
      p + CENTRAL_HEADER_SIZE,
      p + CENTRAL_HEADER_SIZE + nameLength,
    );

    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff ||
      diskStart === 0xffff
    ) {
      throw new UnsafeZipError(
        "unsupported",
        "ZIP64 archives are not supported for document parsing",
      );
    }

    total += uncompressedSize;
    if (total > limits.maxTotalUncompressedBytes) {
      throw new UnsafeZipError(
        "limit",
        `total uncompressed size exceeds ${formatMB(limits.maxTotalUncompressedBytes)} ` +
          `(possible zip bomb)`,
      );
    }
    const ratio = uncompressedSize / Math.max(compressedSize, 1);
    if (
      uncompressedSize > limits.ratioCheckMinBytes &&
      ratio > limits.maxCompressionRatio
    ) {
      throw new UnsafeZipError(
        "limit",
        `entry "${name}" has a compression ratio of ${Math.round(ratio)}:1 ` +
          `(${formatMB(uncompressedSize)} uncompressed; limit ${limits.maxCompressionRatio}:1 ` +
          `above ${formatMB(limits.ratioCheckMinBytes)}) (possible zip bomb)`,
      );
    }

    entries.push({
      name,
      flags,
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    p = recordEnd;
  }

  if (entries.length !== totalEntries) {
    throw new UnsafeZipError(
      "invalid",
      `not a valid ZIP archive (central directory has ${entries.length} entries, ` +
        `end record declares ${totalEntries})`,
    );
  }

  return { entries, totalUncompressedBytes: total };
}

/**
 * Inflate one deflated entry without keeping the output, failing as soon as
 * it produces more than `maxBytes`. Corrupt data is not treated as a bomb
 * (the document parser will report it); only the size bound matters here.
 */
function countInflatedBytes(
  filePath: string,
  start: number,
  compressedSize: number,
  maxBytes: number,
): Promise<{ bytes: number; exceeded: boolean }> {
  return new Promise((resolve) => {
    if (compressedSize === 0) {
      resolve({ bytes: 0, exceeded: false });
      return;
    }
    const input = createReadStream(filePath, {
      start,
      end: start + compressedSize - 1,
    });
    const inflate = zlib.createInflateRaw();
    let bytes = 0;
    let done = false;
    const finish = (exceeded: boolean) => {
      if (done) return;
      done = true;
      input.destroy();
      inflate.destroy();
      resolve({ bytes, exceeded });
    };
    inflate.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) finish(true);
    });
    inflate.on("end", () => finish(false));
    inflate.on("error", () => finish(false));
    input.on("error", () => finish(false));
    input.pipe(inflate);
  });
}

/**
 * Throws {@link UnsafeZipError} unless the ZIP file at `filePath` is within
 * the configured decompression limits.
 */
export async function assertSafeZipFile(
  filePath: string,
  limits: ZipGuardLimits = DEFAULT_ZIP_GUARD_LIMITS,
): Promise<ZipInspection> {
  const handle = await fs.open(filePath, "r");
  try {
    const { size } = await handle.stat();
    const inspection = await inspectZipCentralDirectory(handle, size, limits);

    let actualTotal = 0;
    for (const entry of inspection.entries) {
      // Encrypted entries cannot be inflated; parsers refuse them anyway.
      if (entry.flags & 0x1) continue;
      if (entry.method !== 0 && entry.method !== 8) continue; // unsupported by parsers

      const local = await readAt(handle, entry.localHeaderOffset, LOCAL_HEADER_SIZE);
      if (local.length !== LOCAL_HEADER_SIZE || local.readUInt32LE(0) !== SIG_LOCAL_HEADER) {
        throw new UnsafeZipError(
          "invalid",
          `not a valid ZIP archive (bad local header for "${entry.name}")`,
        );
      }
      const dataStart =
        entry.localHeaderOffset +
        LOCAL_HEADER_SIZE +
        local.readUInt16LE(26) +
        local.readUInt16LE(28);
      if (dataStart + entry.compressedSize > size) {
        throw new UnsafeZipError(
          "invalid",
          `not a valid ZIP archive (data for "${entry.name}" out of bounds)`,
        );
      }

      if (entry.method === 0) {
        if (entry.compressedSize !== entry.uncompressedSize) {
          throw new UnsafeZipError(
            "invalid",
            `not a valid ZIP archive (stored entry "${entry.name}" has inconsistent sizes)`,
          );
        }
        actualTotal += entry.compressedSize;
        continue;
      }

      const { bytes, exceeded } = await countInflatedBytes(
        filePath,
        dataStart,
        entry.compressedSize,
        entry.uncompressedSize,
      );
      if (exceeded) {
        throw new UnsafeZipError(
          "limit",
          `entry "${entry.name}" inflates beyond its declared size of ` +
            `${entry.uncompressedSize} bytes (possible zip bomb)`,
        );
      }
      actualTotal += bytes;
    }

    // Declared sizes are already bounded and actual sizes never exceed them,
    // but keep an explicit check on what was actually produced.
    if (actualTotal > limits.maxTotalUncompressedBytes) {
      throw new UnsafeZipError(
        "limit",
        `total uncompressed size exceeds ${formatMB(limits.maxTotalUncompressedBytes)} ` +
          `(possible zip bomb)`,
      );
    }
    return inspection;
  } finally {
    await handle.close();
  }
}

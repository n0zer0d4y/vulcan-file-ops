/**
 * Centralized resource limits.
 *
 * These caps protect the (single-process, stdio) MCP server from requests that
 * would otherwise exhaust memory, hang, or crash it. Keep all tunables here so
 * they are easy to find and adjust.
 */

const MB = 1024 * 1024;

// ---------------------------------------------------------------------------
// HTML -> PDF / DOCX generation (VFO-13)
// ---------------------------------------------------------------------------

/** Maximum decoded size of a single embedded `data:` image in generated PDF/DOCX. */
export const MAX_EMBEDDED_IMAGE_BYTES = 10 * MB;

/**
 * Maximum pixel count of a PNG that the PDF renderer must fully decode
 * (alpha channel, indexed transparency or interlacing). 16 MP = 4096x4096.
 */
export const MAX_DECODED_IMAGE_PIXELS = 16 * 1024 * 1024;

/** Hard upper bound for rendering one PDF from HTML before the write fails. */
export const PDF_GENERATION_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Read paths (VFO-15)
// ---------------------------------------------------------------------------

/**
 * Maximum size of a plain-text file returned by read_file/read_multiple_files
 * in "full" mode, and maximum amount of text held in memory by head/tail/range
 * reads (output plus the current partial line).
 */
export const MAX_TEXT_READ_BYTES = 10 * MB;

/** Maximum size of a single image returned by attach_image. */
export const MAX_IMAGE_ATTACH_BYTES = 10 * MB;

/** Maximum combined size of all images in one attach_image call. */
export const MAX_IMAGE_ATTACH_TOTAL_BYTES = 20 * MB;

/** Maximum on-disk size of a document (PDF/Office/ODF) passed to a parser. */
export const MAX_DOCUMENT_FILE_BYTES = 50 * MB;

// ---------------------------------------------------------------------------
// ZIP-based documents (.docx .xlsx .pptx .odt .ods .odp) - zip bomb guard
// ---------------------------------------------------------------------------

/** Maximum total uncompressed size of all entries. */
export const ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES = 200 * MB;

/** Maximum number of entries in the central directory. */
export const ZIP_MAX_ENTRIES = 10_000;

/** Maximum compression ratio for an entry larger than ZIP_RATIO_CHECK_MIN_BYTES. */
export const ZIP_MAX_COMPRESSION_RATIO = 200;

/** Entries at or below this uncompressed size are exempt from the ratio check. */
export const ZIP_RATIO_CHECK_MIN_BYTES = 10 * MB;

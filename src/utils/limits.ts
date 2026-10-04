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

import "server-only";
import sharp from "sharp";

/** Largest decoded image accepted (pixels): protects the worker from decompression bombs. */
const MAX_INPUT_PIXELS = 40_000_000;

/**
 * Prepares an uploaded photo (JPEG, PNG or WebP, already content-checked at upload) for embedding
 * in a PDF: decodes it with strict error handling, applies the EXIF orientation, bounds its size,
 * flattens transparency onto white and re-encodes it as a baseline JPEG. The output carries no
 * metadata (EXIF, GPS). Returns null when the file cannot be decoded; the PDF then lists the file
 * name instead, and the original stays downloadable from the job.
 */
export async function photoForPdf(input: Buffer): Promise<Buffer | null> {
  try {
    return await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error", animated: false })
      .rotate()
      .resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 80 })
      .toBuffer();
  } catch {
    return null;
  }
}

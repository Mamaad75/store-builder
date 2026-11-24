/**
 * Public API of the (legacy) media module for layered modules. D35b-1: card-to-card receipts go through the SAME validation and re-encoding
 * as every upload (real format from the bytes, no trailing data, no animation, pixel limits, EXIF/GPS stripped), but are never written to
 * the public bucket: the caller keeps the bytes (the orders module stores them privately).
 */
import { processImage, type ProcessedImage } from "./process.js";

export type { ProcessedImage };
export const processReceiptImage = (input: Buffer): Promise<ProcessedImage> => processImage(input, { maxDimension: 1600, quality: 80 });

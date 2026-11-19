export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // original file
export const MAX_INPUT_PIXELS = 25_000_000; // decoded input (decompression-bomb guard)
export const MAX_OUTPUT_DIMENSION = 2048; // processed output, each side
export const MAX_MEDIA_PER_STORE = 100;
export const MAX_MEDIA_BYTES_PER_STORE = 100 * 1024 * 1024; // processed bytes
export const OUTPUT_MIME = "image/webp" as const;

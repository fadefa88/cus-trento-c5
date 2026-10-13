// Upload checks. The file type is decided by its bytes, never by the name or
// the Content-Type the client claims. SVG is refused: it is a document that can
// carry scripts, and nothing in the site needs it from the CMS.
import { HttpError } from "./errors";
import { SITE } from "../shared/site";

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const UPLOAD_DIR = "img/uploads";

const SIGNATURES: Array<{ ext: string; mime: string; test: (b: Uint8Array) => boolean }> = [
  { ext: "jpg", mime: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: "png", mime: "image/png", test: (b) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v) },
  { ext: "webp", mime: "image/webp", test: (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP" },
  { ext: "gif", mime: "image/gif", test: (b) => ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a" },
  { ext: "avif", mime: "image/avif", test: (b) => ascii(b, 4, 8) === "ftyp" && ["avif", "avis"].includes(ascii(b, 8, 12)) },
];

function ascii(b: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...b.subarray(start, end));
}

export function sniffImage(bytes: Uint8Array) {
  return SIGNATURES.find((s) => bytes.length > 12 && s.test(bytes)) ?? null;
}

/** Reads width and height from the header, to refuse decompression bombs and broken files. */
export function imageSize(bytes: Uint8Array, ext: string): { width: number; height: number } | null {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    if (ext === "png") return { width: dv.getUint32(16), height: dv.getUint32(20) };
    if (ext === "gif") return { width: dv.getUint16(6, true), height: dv.getUint16(8, true) };
    if (ext === "jpg") {
      let i = 2;
      while (i < bytes.length) {
        if (bytes[i] !== 0xff) return null;
        const marker = bytes[i + 1];
        const len = dv.getUint16(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) };
        i += 2 + len;
      }
      return null;
    }
    if (ext === "webp") {
      const chunk = ascii(bytes, 12, 16);
      if (chunk === "VP8 ") return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
      if (chunk === "VP8L") {
        const b = dv.getUint32(21, true);
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
      }
      if (chunk === "VP8X") return { width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)), height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) };
      return null;
    }
    if (ext === "avif") return { width: 1, height: 1 }; // container parsing not needed: size limit applies
  } catch {
    return null;
  }
  return null;
}

export interface CheckedUpload { path: string; publicPath: string; bytes: Uint8Array; mime: string; width: number; height: number }

export function checkUpload(bytes: Uint8Array, originalName: string): CheckedUpload {
  if (!bytes.length) throw new HttpError(400, "empty", "File vuoto.");
  if (bytes.length > MAX_UPLOAD_BYTES) throw new HttpError(413, "too_large", `Immagine troppo grande (massimo ${MAX_UPLOAD_BYTES / 1024 / 1024} MB).`);
  const head = new TextDecoder().decode(bytes.subarray(0, 512)).toLowerCase();
  if (head.includes("<svg") || head.includes("<?xml") || head.includes("<html") || head.includes("<script")) {
    throw new HttpError(415, "unsupported", "SVG e documenti non sono ammessi: carica PNG, JPG o WebP.");
  }
  const kind = sniffImage(bytes);
  if (!kind) throw new HttpError(415, "unsupported", "Formato non riconosciuto: carica PNG, JPG, WebP, GIF o AVIF.");
  const size = imageSize(bytes, kind.ext);
  if (!size || size.width < 1 || size.height < 1) throw new HttpError(415, "corrupt", "Immagine danneggiata o non leggibile.");
  if (size.width * size.height > 50_000_000) throw new HttpError(413, "too_large", "Immagine con troppi pixel.");
  const stem = SITE.slugify(originalName.replace(/\.[^.]*$/, "")).slice(0, 60) || "immagine";
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const path = `${UPLOAD_DIR}/${stem}-${suffix}.${kind.ext}`;
  return { path, publicPath: `/${path}`, bytes, mime: kind.mime, ...size };
}

export function isUploadPath(path: string) {
  return /^img\/uploads\/[a-z0-9][a-z0-9._-]{0,150}\.(jpe?g|png|webp|gif|avif)$/i.test(path) && !path.includes("..");
}

export function mimeFor(path: string) {
  const ext = path.split(".").pop()!.toLowerCase();
  return { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", avif: "image/avif" }[ext] || "application/octet-stream";
}

// Images are prepared in the browser before upload: orientation fixed, cropped
// if requested, resized to the size the site uses and re-encoded. This keeps
// uploads from an iPhone (often 4-8 MB HEIC/JPEG) small and strips metadata
// such as GPS position. The server still validates every byte.

export interface ImageProfile { maxWidth: number; maxHeight: number; aspect?: number; keepAlpha?: boolean; label: string }

/** Same targets as scripts/optimize_cms_images.py, so the workflow has little left to do. */
export const PROFILES = {
  people: { maxWidth: 800, maxHeight: 1000, aspect: 4 / 5, label: "Foto profilo" },
  news: { maxWidth: 1600, maxHeight: 1600, label: "Immagine articolo" },
  gallery: { maxWidth: 1600, maxHeight: 1600, label: "Foto gallery" },
  logo: { maxWidth: 600, maxHeight: 600, aspect: 1, keepAlpha: true, label: "Logo" },
  free: { maxWidth: 1600, maxHeight: 1600, label: "Immagine" },
} satisfies Record<string, ImageProfile>;
export type ProfileName = keyof typeof PROFILES;

export interface CropArea { x: number; y: number; width: number; height: number }

export async function loadImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } catch {
    URL.revokeObjectURL(url);
    throw new Error("Impossibile leggere l'immagine. Prova con un JPG o PNG.");
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function prepareImage(file: File, profile: ImageProfile, crop?: CropArea | null): Promise<{ blob: Blob; name: string }> {
  const img = await loadImage(file);
  const src = crop ?? { x: 0, y: 0, width: img.naturalWidth, height: img.naturalHeight };
  const scale = Math.min(1, profile.maxWidth / src.width, profile.maxHeight / src.height);
  const width = Math.max(1, Math.round(src.width * scale));
  const height = Math.max(1, Math.round(src.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  if (!profile.keepAlpha) {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(img, src.x, src.y, src.width, src.height, 0, 0, width, height);
  URL.revokeObjectURL(img.src);
  // WebP when the browser can encode it; Safari falls back to PNG for logos and JPEG for photos.
  let blob = await canvasToBlob(canvas, "image/webp", 0.84);
  let ext = "webp";
  if (!blob || blob.type !== "image/webp") {
    ext = profile.keepAlpha ? "png" : "jpg";
    blob = await canvasToBlob(canvas, profile.keepAlpha ? "image/png" : "image/jpeg", 0.86);
  }
  if (!blob) throw new Error("Conversione dell'immagine non riuscita.");
  const stem = file.name.replace(/\.[^.]*$/, "") || "immagine";
  return { blob, name: `${stem}.${ext}` };
}

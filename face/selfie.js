// Funky Cat selfie: turns one photo into a cut-out head for the FAN CAM and the share card.
// Built on the FaceKit from SlingToon (face-vision.js, portrait.js, face-mimic.js).
// Everything runs on the device: the photo is never uploaded anywhere.
import { FaceVision, FaceVisionError } from "./face-vision.js";
import { deriveHeadBounds, createCutoutPortrait } from "./portrait.js";

const MAX_EDGE = 1024;
const OUT = 256;
let vision = null;

async function decodeImage(file) {
  if (typeof createImageBitmap === "function") {
    try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch (e) { /* Safari: fall back */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

function orientedCanvas(image) {
  const w = image.naturalWidth || image.width, h = image.naturalHeight || image.height;
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  const x = c.getContext("2d", { alpha: false });
  x.imageSmoothingQuality = "high";
  x.fillStyle = "#2c2146";
  x.fillRect(0, 0, c.width, c.height);
  x.drawImage(image, 0, 0, c.width, c.height);
  return c;
}

function shrink(canvas) {
  const c = document.createElement("canvas");
  c.width = OUT; c.height = OUT;
  const x = c.getContext("2d");
  x.imageSmoothingQuality = "high";
  x.drawImage(canvas, 0, 0, OUT, OUT);
  return c.toDataURL("image/png");
}

class SelfieError extends Error {}

export async function makeSelfie(file, onProgress = () => {}) {
  try {
    return await buildSelfie(file, onProgress);
  } catch (error) {
    if (error instanceof SelfieError || error instanceof FaceVisionError) throw error;
    console.warn("[selfie]", error);
    throw new SelfieError("Nie udało się przygotować selfie. Spróbuj innego zdjęcia (JPG albo PNG).");
  }
}

async function buildSelfie(file, onProgress) {
  if (!file || !/^image\//.test(file.type || "image/")) throw new SelfieError("Wybierz zdjęcie (JPG, PNG albo HEIC).");
  if (file.size > 30 * 1024 * 1024) throw new SelfieError("Zdjęcie jest za duże. Wybierz plik mniejszy niż 30 MB.");
  onProgress("Wczytuję zdjęcie…");
  let image;
  try { image = await decodeImage(file); } catch (e) { throw new SelfieError("Nie mogę otworzyć tego zdjęcia. Wybierz JPG albo PNG."); }
  const canvas = orientedCanvas(image);
  if (typeof image.close === "function") image.close();
  vision = vision || new FaceVision();
  const analysis = await vision.analyze(canvas, onProgress);
  analysis.headBounds = deriveHeadBounds(analysis.landmarks, analysis.mask);
  onProgress("Wycinam głowę…");
  const portrait = createCutoutPortrait(canvas, analysis, 0.34, 512);
  if (!(portrait.metadata.coverage > 0.04)) {
    throw new SelfieError("Znalazłem twarz, ale nie udało się oddzielić jej od tła. Spróbuj zdjęcia z przodu, w dobrym świetle.");
  }
  const ex = portrait.expressions || {};
  return {
    neutral: shrink(portrait.image),
    happy: shrink(ex.victory || portrait.image),
    sing: shrink(ex.airborne || portrait.image),
  };
}

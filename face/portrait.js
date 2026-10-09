import { DEFAULT_MIMIC_STRENGTH, buildExpressionSheet, mimicAnchors, opaqueBounds } from "./face-mimic.js";

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

export const DEFAULT_PORTRAIT_STYLE = 0.78;
export const MAX_OUTLINE_WIDTH = 15;
export const PORTRAIT_MODES = Object.freeze({ CUTOUT: "cutout", TOON: "toon" });
// Likeness beats stylisation: the default keeps the player's real face.
export const DEFAULT_PORTRAIT_MODE = PORTRAIT_MODES.CUTOUT;
// Zapas przy krawędzi kadru, w pikselach portretu 512 px, na ruch min.
const MIMIC_HEADROOM = 26;
export const DEFAULT_OUTLINE_STRENGTH = 0.34;
export const FACE_CATEGORIES = Object.freeze({
  BACKGROUND: 0,
  HAIR: 1,
  BODY_SKIN: 2,
  FACE_SKIN: 3,
  CLOTHES: 4,
  ACCESSORIES: 5,
});

export function normalizePortraitStyle(value) {
  const numeric = Number(value);
  return clamp(Number.isFinite(numeric) ? numeric : DEFAULT_PORTRAIT_STYLE, 0.45, 1);
}

export function normalizePortraitMode(value) {
  return value === PORTRAIT_MODES.TOON ? PORTRAIT_MODES.TOON : PORTRAIT_MODES.CUTOUT;
}

export function normalizeOutlineStrength(value) {
  const numeric = Number(value);
  return clamp(Number.isFinite(numeric) ? numeric : DEFAULT_OUTLINE_STRENGTH, 0, 1);
}

export function outlineWidthFor(strength) {
  return normalizeOutlineStrength(strength) * MAX_OUTLINE_WIDTH;
}

export function boundsFromLandmarks(landmarks, indices = null) {
  const selected = indices?.length ? indices.map((index) => landmarks[index]).filter(Boolean) : landmarks;
  if (!selected?.length) return { left: 0.25, top: 0.2, right: 0.75, bottom: 0.82, width: 0.5, height: 0.62 };
  let left = 1;
  let top = 1;
  let right = 0;
  let bottom = 0;
  for (const point of selected) {
    left = Math.min(left, point.x);
    top = Math.min(top, point.y);
    right = Math.max(right, point.x);
    bottom = Math.max(bottom, point.y);
  }
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export function connectionPaths(connections = []) {
  const paths = [];
  let path = [];
  for (const connection of connections) {
    if (!path.length || path[path.length - 1] === connection.start) {
      if (!path.length) path.push(connection.start);
      path.push(connection.end);
    } else {
      paths.push(path);
      path = [connection.start, connection.end];
    }
  }
  if (path.length) paths.push(path);
  return paths;
}

export function deriveHeadBounds(landmarks, mask) {
  const face = boundsFromLandmarks(landmarks);
  // Follow the detected face instead of reserving a large fixed skull area.
  // This gives a distant face the same final framing as a close selfie.
  const fallback = {
    left: clamp(face.left - face.width * 0.16, 0, 1),
    right: clamp(face.right + face.width * 0.16, 0, 1),
    top: clamp(face.top - face.height * 0.27, 0, 1),
    bottom: clamp(face.bottom + face.height * 0.11, 0, 1),
  };

  const hairX = [];
  const hairY = [];
  let foundHair = false;
  const scanLeft = clamp(face.left - face.width * 0.52, 0, 1);
  const scanRight = clamp(face.right + face.width * 0.52, 0, 1);
  const scanTop = clamp(face.top - face.height * 0.95, 0, 1);
  const scanBottom = clamp(face.top + face.height * 0.62, 0, 1);

  if (mask && mask.categories?.length === mask.width * mask.height) {
    for (let y = 0; y < mask.height; y += 1) {
      const normalizedY = (y + 0.5) / mask.height;
      if (normalizedY < scanTop || normalizedY > scanBottom) continue;
      for (let x = 0; x < mask.width; x += 1) {
        const normalizedX = (x + 0.5) / mask.width;
        if (normalizedX < scanLeft || normalizedX > scanRight) continue;
        if (mask.categories[y * mask.width + x] !== FACE_CATEGORIES.HAIR) continue;
        hairX.push(normalizedX);
        hairY.push(normalizedY);
      }
    }
  }

  foundHair = hairX.length >= 2;
  hairX.sort((a, b) => a - b);
  hairY.sort((a, b) => a - b);
  const percentile = (values, amount, fallbackValue) => values.length
    ? values[Math.round((values.length - 1) * amount)]
    : fallbackValue;
  const hairLeft = percentile(hairX, 0.02, fallback.left);
  const hairRight = percentile(hairX, 0.98, fallback.right);
  const hairTop = percentile(hairY, 0.02, fallback.top);

  const left = clamp(Math.min(fallback.left, hairLeft - (foundHair ? face.width * 0.055 : 0)), 0, 1);
  const right = clamp(Math.max(fallback.right, hairRight + (foundHair ? face.width * 0.055 : 0)), 0, 1);
  const top = clamp(Math.min(fallback.top, hairTop - (foundHair ? face.height * 0.045 : 0)), 0, 1);
  const bottom = fallback.bottom;
  return { left, top, right, bottom, width: right - left, height: bottom - top, face, foundHair };
}

export function isHeadPixel(category, normalizedX, normalizedY, headBounds) {
  const face = headBounds.face;
  if (
    normalizedX < headBounds.left || normalizedX > headBounds.right ||
    normalizedY < headBounds.top || normalizedY > headBounds.bottom
  ) return false;
  if (category === FACE_CATEGORIES.HAIR || category === FACE_CATEGORIES.FACE_SKIN) return true;
  if (category === FACE_CATEGORIES.ACCESSORIES) {
    return normalizedY <= face.bottom + face.height * 0.05;
  }
  if (category === FACE_CATEGORIES.BODY_SKIN) {
    const earBand = normalizedX >= face.left - face.width * 0.14 && normalizedX <= face.right + face.width * 0.14;
    const verticalBand = normalizedY >= face.top + face.height * 0.14 && normalizedY <= face.bottom + face.height * 0.09;
    return earBand && verticalBand;
  }
  return false;
}

// How far the cut-out has to shrink, about the middle of the frame, to leave a
// margin the expressions can move into. Scaling about the centre and not about
// the photo's own box matters: the head has to stay where the renderer expects
// it, only smaller.
export function fitInsideFrame(canvas, margin) {
  const bounds = opaqueBounds(canvas);
  const middle = canvas.width / 2;
  let scale = 1;
  const pull = (edge, target) => {
    const span = edge - middle;
    if (Math.abs(span) < 1e-6) return;
    scale = Math.min(scale, (target - middle) / span);
  };
  if (bounds.left < margin) pull(bounds.left, margin);
  if (bounds.top < margin) pull(bounds.top, margin);
  if (bounds.right > canvas.width - 1 - margin) pull(bounds.right, canvas.width - 1 - margin);
  if (bounds.bottom > canvas.height - 1 - margin) pull(bounds.bottom, canvas.height - 1 - margin);
  return { scale: Math.max(0.5, Math.min(1, scale)), bounds };
}

function shrinkAboutCentre(canvas, scale, make) {
  const surface = make(canvas.width, canvas.height);
  const context = surface.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  const middle = canvas.width / 2;
  context.translate(middle, middle);
  context.scale(scale, scale);
  context.translate(-middle, -middle);
  context.drawImage(canvas, 0, 0);
  return surface;
}

function createCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function createHeadMaskCanvas(mask, headBounds, color = [92, 225, 189, 255], categoryFilter = null) {
  const canvas = createCanvas(mask.width, mask.height);
  const context = canvas.getContext("2d");
  const image = context.createImageData(mask.width, mask.height);
  for (let y = 0; y < mask.height; y += 1) {
    const normalizedY = (y + 0.5) / mask.height;
    for (let x = 0; x < mask.width; x += 1) {
      const index = y * mask.width + x;
      const category = mask.categories[index];
      const normalizedX = (x + 0.5) / mask.width;
      const included = categoryFilter
        ? categoryFilter(category, normalizedX, normalizedY)
        : isHeadPixel(category, normalizedX, normalizedY, headBounds);
      if (!included) continue;
      const pixel = index * 4;
      image.data[pixel] = color[0];
      image.data[pixel + 1] = color[1];
      image.data[pixel + 2] = color[2];
      image.data[pixel + 3] = color[3];
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

function channelMedian(values, fallback) {
  if (!values.length) return fallback;
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}

function sampleCategoryColor(sourceCanvas, mask, categories, bounds, fallback) {
  const context = sourceCanvas.getContext("2d", { willReadFrequently: true });
  const source = context.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height).data;
  const red = [];
  const green = [];
  const blue = [];
  const wanted = new Set(categories);
  const stride = Math.max(1, Math.round(Math.min(mask.width, mask.height) / 96));
  for (let y = 0; y < mask.height; y += stride) {
    const normalizedY = (y + 0.5) / mask.height;
    if (normalizedY < bounds.top || normalizedY > bounds.bottom) continue;
    for (let x = 0; x < mask.width; x += stride) {
      const normalizedX = (x + 0.5) / mask.width;
      if (normalizedX < bounds.left || normalizedX > bounds.right) continue;
      if (!wanted.has(mask.categories[y * mask.width + x])) continue;
      const sourceX = clamp(Math.floor(normalizedX * sourceCanvas.width), 0, sourceCanvas.width - 1);
      const sourceY = clamp(Math.floor(normalizedY * sourceCanvas.height), 0, sourceCanvas.height - 1);
      const pixel = (sourceY * sourceCanvas.width + sourceX) * 4;
      red.push(source[pixel]);
      green.push(source[pixel + 1]);
      blue.push(source[pixel + 2]);
    }
  }
  return [
    channelMedian(red, fallback[0]),
    channelMedian(green, fallback[1]),
    channelMedian(blue, fallback[2]),
  ];
}

function mixColor(first, second, amount) {
  return first.map((value, index) => Math.round(value + (second[index] - value) * amount));
}

function rgb(color) {
  return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
}

function stylizeColor(color, strength, kind) {
  const amount = normalizePortraitStyle(strength);
  if (kind === "skin") {
    const warmed = mixColor(color, [246, 174, 124], 0.18 + amount * 0.2);
    return mixColor(warmed, [255, 215, 171], 0.08 + amount * 0.08);
  }
  if (kind === "hair") {
    const target = color[0] + color[1] + color[2] < 230 ? [37, 29, 56] : [92, 63, 79];
    return mixColor(color, target, 0.16 + amount * 0.2);
  }
  return color;
}

export function createPortraitTransform(bounds, imageWidth, imageHeight, outputSize, padding = 34) {
  const left = bounds.left * imageWidth;
  const top = bounds.top * imageHeight;
  const width = Math.max(1, bounds.width * imageWidth);
  const height = Math.max(1, bounds.height * imageHeight);
  const scale = Math.min((outputSize - padding * 2) / width, (outputSize - padding * 2) / height);
  const offsetX = (outputSize - width * scale) / 2 - left * scale;
  const offsetY = (outputSize - height * scale) / 2 - top * scale;
  return {
    scale,
    offsetX,
    offsetY,
    map: (point) => ({
      x: point.x * imageWidth * scale + offsetX,
      y: point.y * imageHeight * scale + offsetY,
    }),
  };
}

function drawLandmarkPath(context, landmarks, indices, transform, close = true) {
  const points = indices.map((index) => landmarks[index]).filter(Boolean).map(transform.map);
  if (!points.length) return false;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) context.lineTo(points[index].x, points[index].y);
  if (close) context.closePath();
  return true;
}

function drawConnectionFeature(context, landmarks, connections, transform, options = {}) {
  const paths = connectionPaths(connections);
  for (const path of paths) {
    const closed = path.length > 2 && path[0] === path[path.length - 1];
    if (!drawLandmarkPath(context, landmarks, path, transform, closed)) continue;
    if (options.fill && closed) {
      context.fillStyle = options.fill;
      context.fill();
    }
    if (options.stroke) {
      context.strokeStyle = options.stroke;
      context.lineWidth = options.width ?? 5;
      context.stroke();
    }
  }
}

function maskLayer(maskCanvas, transform, imageWidth, imageHeight, outputSize, color) {
  const layer = createCanvas(outputSize, outputSize);
  const context = layer.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    maskCanvas,
    transform.offsetX,
    transform.offsetY,
    imageWidth * transform.scale,
    imageHeight * transform.scale,
  );
  context.globalCompositeOperation = "source-in";
  context.fillStyle = color;
  context.fillRect(0, 0, outputSize, outputSize);
  return layer;
}

function drawOffsetOutline(context, layer, radius) {
  for (let step = 0; step < 18; step += 1) {
    const angle = (step / 18) * Math.PI * 2;
    context.drawImage(layer, Math.cos(angle) * radius, Math.sin(angle) * radius);
  }
}

// Bilinear upscaling of the 256 px segmentation mask leaves a wide translucent
// fringe that would smuggle photo background into the cut-out. A steep alpha
// ramp removes that halo and still keeps about one pixel of antialiasing.
function sharpenAlpha(canvas, low = 0.42, high = 0.7) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const floor = low * 255;
  const span = (high - low) * 255;
  for (let index = 3; index < image.data.length; index += 4) {
    const alpha = image.data[index];
    image.data[index] = alpha <= floor ? 0 : Math.min(255, Math.round(((alpha - floor) / span) * 255));
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

function headSilhouette(mask, headBounds, transform, imageWidth, imageHeight, outputSize) {
  const headMask = createHeadMaskCanvas(mask, headBounds, [255, 255, 255, 255]);
  const layer = createCanvas(outputSize, outputSize);
  const context = layer.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(headMask, transform.offsetX, transform.offsetY, imageWidth * transform.scale, imageHeight * transform.scale);
  return sharpenAlpha(layer);
}

function tintLayer(layer, color) {
  const tinted = createCanvas(layer.width, layer.height);
  const context = tinted.getContext("2d");
  context.drawImage(layer, 0, 0);
  context.globalCompositeOperation = "source-in";
  context.fillStyle = color;
  context.fillRect(0, 0, layer.width, layer.height);
  return tinted;
}

// The cut-out keeps the photograph itself. Nothing is redrawn, so the head in
// the game still looks like the person; only the background is removed and an
// optional comic outline separates it from a busy stage.
export function createCutoutPortrait(sourceCanvas, analysis, outlineStrength = DEFAULT_OUTLINE_STRENGTH, outputSize = 512, mimicStrength = DEFAULT_MIMIC_STRENGTH) {
  const { landmarks, mask } = analysis;
  const headBounds = analysis.headBounds ?? deriveHeadBounds(landmarks, mask);
  const transform = createPortraitTransform(headBounds, sourceCanvas.width, sourceCanvas.height, outputSize);
  const silhouette = headSilhouette(mask, headBounds, transform, sourceCanvas.width, sourceCanvas.height, outputSize);

  const photo = createCanvas(outputSize, outputSize);
  const photoContext = photo.getContext("2d");
  photoContext.imageSmoothingEnabled = true;
  photoContext.imageSmoothingQuality = "high";
  photoContext.drawImage(silhouette, 0, 0);
  photoContext.globalCompositeOperation = "source-in";
  photoContext.drawImage(
    sourceCanvas,
    transform.offsetX,
    transform.offsetY,
    sourceCanvas.width * transform.scale,
    sourceCanvas.height * transform.scale,
  );

  const composed = createCanvas(outputSize, outputSize);
  const composedContext = composed.getContext("2d");
  const outlineWidth = outlineWidthFor(outlineStrength);
  if (outlineWidth >= 0.5) drawOffsetOutline(composedContext, tintLayer(silhouette, "rgb(27, 20, 44)"), outlineWidth);
  composedContext.drawImage(photo, 0, 0);

  // A collar that runs all the way to the bottom of the frame leaves the
  // expressions nowhere to go: tilting the head four degrees swings it straight
  // out of the canvas, and the guard then throws the whole tilt away. Easing the
  // whole cut-out in by a few percent buys that room back. Measured on a real
  // photograph it costs about 3% of head size — invisible — and it is what keeps
  // the wry, dizzy and squashed faces from collapsing back to a still photo.
  const headroom = fitInsideFrame(composed, MIMIC_HEADROOM);
  const canvas = headroom.scale < 1 ? shrinkAboutCentre(composed, headroom.scale, createCanvas) : composed;
  const context = canvas.getContext("2d");

  const face = headBounds.face;
  const metadata = {
    version: 4,
    technique: "segmented-photo-cutout",
    mode: PORTRAIT_MODES.CUTOUT,
    autoFaceZoom: true,
    outlineWidth,
    faceFillRatio: (face.height * sourceCanvas.height * transform.scale) / outputSize,
    sourceFaceHeightPixels: face.height * sourceCanvas.height,
    headAspect: (headBounds.width * sourceCanvas.width) / Math.max(1, headBounds.height * sourceCanvas.height),
    faceAspect: (face.width * sourceCanvas.width) / Math.max(1, face.height * sourceCanvas.height),
    hasHairMask: headBounds.foundHair,
  };
  canvas.slingtoonPortrait = metadata;

  // The expressions are baked here, once, while the photo is being accepted.
  // The game then only ever picks an already-finished image, so a face that
  // pulls faces costs nothing per frame.
  const middle = outputSize / 2;
  const toPortrait = (point) => {
    const mapped = transform.map(point);
    return {
      x: middle + (mapped.x - middle) * headroom.scale,
      y: middle + (mapped.y - middle) * headroom.scale,
    };
  };
  const anchors = mimicAnchors(landmarks, toPortrait);
  const faceHeight = face.height * sourceCanvas.height * transform.scale * headroom.scale;
  const bounds = opaqueBounds(canvas);
  metadata.coverage = bounds.coverage;
  const expressions = buildExpressionSheet(canvas, anchors, faceHeight, createCanvas, mimicStrength, bounds);
  metadata.mimicStrength = mimicStrength;
  metadata.mimicExpressions = Object.keys(expressions).length;

  return { image: canvas, metadata, headBounds, expressions };
}

export function createPortrait(sourceCanvas, analysis, options = {}) {
  return normalizePortraitMode(options.mode) === PORTRAIT_MODES.TOON
    ? createToonPortrait(sourceCanvas, analysis, options.style, options.outputSize)
    : createCutoutPortrait(sourceCanvas, analysis, options.outline, options.outputSize, options.mimic);
}

function averagePoint(landmarks, indices, transform) {
  const points = indices.map((index) => landmarks[index]).filter(Boolean).map(transform.map);
  if (!points.length) return { x: 0, y: 0 };
  return points.reduce((sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length }), { x: 0, y: 0 });
}

export function createToonPortrait(sourceCanvas, analysis, style = DEFAULT_PORTRAIT_STYLE, outputSize = 512) {
  const amount = normalizePortraitStyle(style);
  const { landmarks, mask, contours } = analysis;
  const headBounds = analysis.headBounds ?? deriveHeadBounds(landmarks, mask);
  const face = headBounds.face;
  const transform = createPortraitTransform(headBounds, sourceCanvas.width, sourceCanvas.height, outputSize);
  const canvas = createCanvas(outputSize, outputSize);
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.lineCap = "round";
  context.lineJoin = "round";

  const sampledSkin = sampleCategoryColor(sourceCanvas, mask, [FACE_CATEGORIES.FACE_SKIN], face, [226, 160, 119]);
  const sampledHair = sampleCategoryColor(sourceCanvas, mask, [FACE_CATEGORIES.HAIR], headBounds, [67, 48, 76]);
  const skin = stylizeColor(sampledSkin, amount, "skin");
  const hair = stylizeColor(sampledHair, amount, "hair");
  const ink = [27, 20, 44];
  const skinShadow = mixColor(skin, [139, 77, 84], 0.24 + amount * 0.09);
  const skinLight = mixColor(skin, [255, 244, 211], 0.3);
  const hairLight = mixColor(hair, [255, 188, 111], 0.22 + amount * 0.08);
  const outlineWidth = 6 + amount * 3.5;

  const hairMask = createHeadMaskCanvas(
    mask,
    headBounds,
    [255, 255, 255, 255],
    (category, x, y) => category === FACE_CATEGORIES.HAIR && isHeadPixel(category, x, y, headBounds),
  );
  const hairInkLayer = maskLayer(hairMask, transform, sourceCanvas.width, sourceCanvas.height, outputSize, rgb(ink));
  const hairColorLayer = maskLayer(hairMask, transform, sourceCanvas.width, sourceCanvas.height, outputSize, rgb(hair));
  drawOffsetOutline(context, hairInkLayer, outlineWidth * 0.72);
  context.drawImage(hairColorLayer, 0, 0);

  const chin = transform.map(landmarks[152] ?? { x: (face.left + face.right) / 2, y: face.bottom });
  const faceWidthPixels = face.width * sourceCanvas.width * transform.scale;
  const faceHeightPixels = face.height * sourceCanvas.height * transform.scale;
  context.fillStyle = rgb(skinShadow);
  context.strokeStyle = rgb(ink);
  context.lineWidth = outlineWidth;
  context.beginPath();
  const neckWidth = faceWidthPixels * 0.25;
  const neckHeight = faceHeightPixels * 0.22;
  context.roundRect(chin.x - neckWidth / 2, chin.y - neckHeight * 0.18, neckWidth, neckHeight, neckWidth * 0.32);
  context.fill();
  context.stroke();

  const leftEar = transform.map(landmarks[234] ?? { x: face.left, y: face.top + face.height * 0.55 });
  const rightEar = transform.map(landmarks[454] ?? { x: face.right, y: face.top + face.height * 0.55 });
  context.fillStyle = rgb(skin);
  context.strokeStyle = rgb(ink);
  context.lineWidth = outlineWidth;
  for (const ear of [leftEar, rightEar]) {
    context.beginPath();
    context.ellipse(ear.x, ear.y, faceWidthPixels * 0.075, faceHeightPixels * 0.1, 0, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }

  const facePath = connectionPaths(contours.faceOval)[0] ?? [];
  drawLandmarkPath(context, landmarks, facePath, transform, true);
  const faceGradient = context.createLinearGradient(
    transform.map({ x: face.left, y: face.top }).x,
    transform.map({ x: face.left, y: face.top }).y,
    transform.map({ x: face.right, y: face.bottom }).x,
    transform.map({ x: face.right, y: face.bottom }).y,
  );
  faceGradient.addColorStop(0, rgb(skinLight));
  faceGradient.addColorStop(0.45, rgb(skin));
  faceGradient.addColorStop(1, rgb(skinShadow));
  context.fillStyle = faceGradient;
  context.fill();
  context.strokeStyle = rgb(ink);
  context.lineWidth = outlineWidth;
  context.stroke();

  context.save();
  drawLandmarkPath(context, landmarks, facePath, transform, true);
  context.clip();
  context.fillStyle = `rgba(139, 77, 84, ${0.08 + amount * 0.08})`;
  context.beginPath();
  context.ellipse(
    transform.map({ x: face.right - face.width * 0.06, y: face.top + face.height * 0.58 }).x,
    transform.map({ x: face.right - face.width * 0.06, y: face.top + face.height * 0.58 }).y,
    faceWidthPixels * 0.36,
    faceHeightPixels * 0.54,
    -0.2,
    0,
    Math.PI * 2,
  );
  context.fill();
  context.restore();

  // A second hair pass only over the forehead keeps fringe/bangs in front of
  // the vector face, while the rest of the hair remains a clean silhouette.
  const fringeLimit = transform.map({ x: 0, y: face.top + face.height * 0.28 }).y;
  context.save();
  context.beginPath();
  context.rect(0, 0, outputSize, fringeLimit);
  context.clip();
  context.drawImage(hairInkLayer, 0, outlineWidth * 0.18);
  context.drawImage(hairColorLayer, 0, 0);
  context.restore();

  const white = "rgb(255, 250, 231)";
  drawConnectionFeature(context, landmarks, contours.rightEye, transform, { fill: white, stroke: rgb(ink), width: outlineWidth * 0.58 });
  drawConnectionFeature(context, landmarks, contours.leftEye, transform, { fill: white, stroke: rgb(ink), width: outlineWidth * 0.58 });
  drawConnectionFeature(context, landmarks, contours.rightIris, transform, { fill: rgb(mixColor(hair, [42, 116, 122], 0.32)), stroke: rgb(ink), width: outlineWidth * 0.48 });
  drawConnectionFeature(context, landmarks, contours.leftIris, transform, { fill: rgb(mixColor(hair, [42, 116, 122], 0.32)), stroke: rgb(ink), width: outlineWidth * 0.48 });
  drawConnectionFeature(context, landmarks, contours.rightEyebrow, transform, { stroke: rgb(ink), width: outlineWidth * 0.76 });
  drawConnectionFeature(context, landmarks, contours.leftEyebrow, transform, { stroke: rgb(ink), width: outlineWidth * 0.76 });

  const noseIndices = [168, 6, 197, 195, 5, 4, 1];
  if (drawLandmarkPath(context, landmarks, noseIndices, transform, false)) {
    context.strokeStyle = rgb(mixColor(ink, skinShadow, 0.34));
    context.lineWidth = outlineWidth * 0.45;
    context.stroke();
  }
  const nostrilIndices = [98, 97, 2, 326, 327];
  if (drawLandmarkPath(context, landmarks, nostrilIndices, transform, false)) {
    context.strokeStyle = rgb(mixColor(ink, skinShadow, 0.23));
    context.lineWidth = outlineWidth * 0.42;
    context.stroke();
  }

  const mouthPath = connectionPaths(contours.lips)[0] ?? [];
  if (drawLandmarkPath(context, landmarks, mouthPath, transform, true)) {
    context.fillStyle = rgb(mixColor(skinShadow, [220, 76, 105], 0.62));
    context.fill();
    context.strokeStyle = rgb(ink);
    context.lineWidth = outlineWidth * 0.55;
    context.stroke();
  }

  const leftCheek = averagePoint(landmarks, [116, 117, 118, 119], transform);
  const rightCheek = averagePoint(landmarks, [345, 346, 347, 348], transform);
  context.fillStyle = `rgba(255, 96, 120, ${0.12 + amount * 0.08})`;
  for (const cheek of [leftCheek, rightCheek]) {
    context.beginPath();
    context.ellipse(cheek.x, cheek.y, faceWidthPixels * 0.085, faceHeightPixels * 0.04, 0, 0, Math.PI * 2);
    context.fill();
  }

  if (headBounds.foundHair) {
    context.strokeStyle = rgb(hairLight);
    context.lineWidth = outlineWidth * 0.42;
    context.globalAlpha = 0.72;
    const hairTop = transform.map({ x: (headBounds.left + headBounds.right) / 2, y: headBounds.top + headBounds.height * 0.12 });
    context.beginPath();
    context.arc(hairTop.x - faceWidthPixels * 0.08, hairTop.y + faceHeightPixels * 0.12, faceWidthPixels * 0.19, Math.PI * 1.05, Math.PI * 1.62);
    context.stroke();
    context.globalAlpha = 1;
  }

  const metadata = {
    version: 4,
    technique: "segmented-vector-portrait",
    mode: PORTRAIT_MODES.TOON,
    autoFaceZoom: true,
    faceFillRatio: faceHeightPixels / outputSize,
    sourceFaceHeightPixels: face.height * sourceCanvas.height,
    headAspect: (headBounds.width * sourceCanvas.width) / Math.max(1, headBounds.height * sourceCanvas.height),
    faceAspect: (face.width * sourceCanvas.width) / Math.max(1, face.height * sourceCanvas.height),
    hasHairMask: headBounds.foundHair,
  };
  metadata.coverage = opaqueBounds(canvas).coverage;
  canvas.slingtoonPortrait = metadata;
  return { image: canvas, metadata, headBounds };
}

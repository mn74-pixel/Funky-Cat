// Turning a photograph into expressions without turning it into a cartoon.
//
// The head stays the player's own photograph. A grid of triangles is laid over
// the portrait and its nodes are nudged by the face landmarks the game already
// measures locally: brows lift, eyes narrow, mouth corners travel. Each triangle
// of the photo is then drawn through its own affine transform, so the pixels are
// the person's pixels — only rearranged.
//
// Everything is baked once, when the photo is accepted. Measured at 512 px:
// about 10 ms per expression, so the whole set costs roughly a tenth of a second
// that the player never sees, and the game itself pays nothing per frame — it
// picks an already-finished image.
//
// Two things were learned the hard way while prototyping this, and both are
// load-bearing:
//   * A triangulation grown from the landmarks left uncovered wedges. A regular
//     grid covers the frame by construction and cannot tear.
//   * Without pinning the head outline to zero movement, an expression inflates
//     the whole skull and the hair with it — a funhouse mirror, not a face.

export const MIMIC_GRID = 18;
// How far a landmark's pull reaches, in portrait pixels. Wider smears the whole
// head; narrower creases the photo at the seams.
export const MIMIC_RADIUS = 58;
export const DEFAULT_MIMIC_STRENGTH = 1;
export const MAX_MIMIC_STRENGTH = 2;

// MediaPipe's canonical face mesh indices for the features an expression uses.
const POINTS = Object.freeze({
  browLeftOuter: 70, browLeftMid: 105, browLeftInner: 107,
  browRightOuter: 300, browRightMid: 334, browRightInner: 336,
  eyeLeftOuter: 33, eyeLeftTop: 159, eyeLeftBottom: 145, eyeLeftInner: 133,
  eyeRightOuter: 263, eyeRightTop: 386, eyeRightBottom: 374, eyeRightInner: 362,
  mouthLeft: 61, mouthRight: 291, mouthTop: 13, mouthBottom: 14,
  mouthUpper: 0, mouthLower: 17,
  noseTip: 4, chin: 152,
  cheekLeft: 205, cheekRight: 425,
});

// The face oval: pinned to zero so the silhouette and hair never move.
const OVAL = Object.freeze([
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379,
  378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127,
  162, 21, 54, 103, 67, 109,
]);

// Offsets are in units of face height, so the same expression reads the same on
// a big portrait and a small one. Positive y is down.
//
// The amplitudes here look enormous next to a real human face, and that is the
// point. The head is drawn 96 px wide in the world — on a phone closer to 40 —
// so the mouth is a handful of pixels across. A polite 3 px brow lift measured
// 1.5 units of average change at that size: a placebo. Everything below was
// tuned by rendering at the size the player actually sees.
//
// Each expression carries three layers, because geometry alone cannot carry a
// face this small:
//   shift — landmarks pull the photo's own pixels around (the mimicry),
//   pose  — the whole head squashes, stretches or tilts (reads as silhouette),
//   the mouth interior darkens on its own, derived from how far the jaw drops.
const EXPRESSIONS = Object.freeze({
  neutral: { shift: {}, pose: null },
  nervous: {
    shift: {
      browLeftInner: [0, -0.07], browRightInner: [0, -0.07],
      browLeftMid: [0, -0.03], browRightMid: [0, -0.03],
      mouthLeft: [-0.035, 0.04], mouthRight: [0.035, 0.04],
      mouthLower: [0, 0.03], mouthTop: [0, 0.012],
    },
    pose: { rotate: -1.5, sx: 1.01 },
  },
  airborne: {
    shift: {
      browLeftOuter: [0, -0.075], browRightOuter: [0, -0.075],
      browLeftMid: [0, -0.09], browRightMid: [0, -0.09],
      browLeftInner: [0, -0.07], browRightInner: [0, -0.07],
      eyeLeftTop: [0, -0.035], eyeRightTop: [0, -0.035],
      mouthTop: [0, -0.03], mouthBottom: [0, 0.085],
      mouthLeft: [-0.02, 0], mouthRight: [0.02, 0],
    },
    pose: { sy: 1.06, sx: 0.96 },
  },
  panic: {
    shift: {
      browLeftMid: [0, -0.14], browRightMid: [0, -0.14],
      browLeftInner: [0.01, -0.13], browRightInner: [-0.01, -0.13],
      browLeftOuter: [0, -0.1], browRightOuter: [0, -0.1],
      eyeLeftTop: [0, -0.045], eyeRightTop: [0, -0.045],
      eyeLeftBottom: [0, 0.02], eyeRightBottom: [0, 0.02],
      mouthTop: [0, -0.045], mouthBottom: [0, 0.15],
      mouthLeft: [-0.04, 0.03], mouthRight: [0.04, 0.03],
      chin: [0, 0.02],
    },
    pose: { sy: 1.08, sx: 0.94 },
  },
  impact: {
    shift: {
      browLeftMid: [0, -0.12], browRightMid: [0, -0.12],
      eyeLeftTop: [0, -0.05], eyeRightTop: [0, -0.05],
      mouthTop: [0, -0.035], mouthBottom: [0, 0.13],
      mouthLeft: [-0.05, 0], mouthRight: [0.05, 0],
      cheekLeft: [-0.03, 0.01], cheekRight: [0.03, 0.01],
      chin: [0, 0.03],
    },
    pose: { sy: 0.9, sx: 1.11 },
  },
  suspicious: {
    shift: {
      browLeftOuter: [0, 0.055], browLeftInner: [0, -0.06],
      browRightOuter: [0, 0.055], browRightInner: [0, -0.06],
      eyeLeftTop: [0, 0.04], eyeRightTop: [0, 0.01],
      mouthLeft: [-0.05, -0.02], mouthRight: [0.012, 0.03],
      noseTip: [0.012, 0],
    },
    pose: { rotate: 4 },
  },
  serene: {
    // Spokój też musi coś robić. Sama mimika dawała 1 px przy głowie 96 px,
    // więc głowa odchyla się do tyłu — cicho, ale widać.
    shift: {
      browLeftMid: [0, 0.03], browRightMid: [0, 0.03],
      eyeLeftTop: [0, 0.055], eyeRightTop: [0, 0.055],
      eyeLeftBottom: [0, -0.015], eyeRightBottom: [0, -0.015],
      mouthLeft: [-0.04, -0.04], mouthRight: [0.04, -0.04],
      cheekLeft: [0, -0.025], cheekRight: [0, -0.025],
    },
    pose: { rotate: -2.6, sy: 0.985 },
  },
  bracing: {
    shift: {
      browLeftMid: [0.02, 0.08], browRightMid: [-0.02, 0.08],
      browLeftInner: [0.03, 0.095], browRightInner: [-0.03, 0.095],
      eyeLeftTop: [0, 0.062], eyeRightTop: [0, 0.062],
      eyeLeftBottom: [0, -0.03], eyeRightBottom: [0, -0.03],
      mouthLeft: [-0.075, 0], mouthRight: [0.075, 0],
      mouthTop: [0, 0.02], mouthBottom: [0, -0.02],
    },
    pose: { sy: 0.95, sx: 1.05 },
  },
  hopeful: {
    shift: {
      browLeftMid: [0, -0.1], browRightMid: [0, -0.1],
      browLeftOuter: [0, -0.07], browRightOuter: [0, -0.07],
      eyeLeftTop: [0, -0.035], eyeRightTop: [0, -0.035],
      mouthLeft: [-0.05, -0.05], mouthRight: [0.05, -0.05],
      mouthTop: [0, -0.02], mouthBottom: [0, 0.055], mouthLower: [0, 0.03],
      cheekLeft: [0, -0.045], cheekRight: [0, -0.045],
    },
    pose: { sy: 1.03 },
  },
  dizzy: {
    shift: {
      browLeftOuter: [0, -0.055], browRightOuter: [0, 0.055],
      browLeftInner: [0, 0.03], browRightInner: [0, -0.03],
      eyeLeftTop: [0, 0.035], eyeRightTop: [0, -0.04],
      mouthLeft: [-0.03, -0.05], mouthRight: [0.03, 0.055],
      mouthBottom: [0, 0.04], noseTip: [0.03, 0],
    },
    pose: { rotate: -6, skew: 0.06 },
  },
  victory: {
    // A closed smile vanished at 96 px. A laugh does not: the mouth opens, so
    // the shading has something to fill, and the eyes squeeze shut.
    shift: {
      mouthLeft: [-0.09, -0.07], mouthRight: [0.09, -0.07],
      mouthTop: [0, -0.03], mouthBottom: [0, 0.075], mouthLower: [0, 0.03],
      browLeftMid: [0, -0.06], browRightMid: [0, -0.06],
      cheekLeft: [0.015, -0.075], cheekRight: [-0.015, -0.075],
      eyeLeftBottom: [0, -0.055], eyeRightBottom: [0, -0.055],
      eyeLeftTop: [0, 0.02], eyeRightTop: [0, 0.02],
    },
    pose: { sy: 1.06, sx: 1.02 },
  },
  defeat: {
    shift: {
      browLeftOuter: [0.012, 0.075], browRightOuter: [-0.012, 0.075],
      browLeftInner: [0.025, 0.09], browRightInner: [-0.025, 0.09],
      eyeLeftTop: [0, 0.04], eyeRightTop: [0, 0.04],
      mouthLeft: [-0.03, 0.075], mouthRight: [0.03, 0.075],
      mouthTop: [0, 0.05], mouthLower: [0, 0.02], chin: [0, 0.035],
    },
    pose: { sy: 0.94, sx: 1.04, dy: 0.02 },
  },
});

export const MIMIC_EXPRESSIONS = Object.freeze(Object.keys(EXPRESSIONS));

export function buildMimicMesh(size = 512, grid = MIMIC_GRID) {
  const nodes = [];
  for (let row = 0; row <= grid; row += 1) {
    for (let column = 0; column <= grid; column += 1) {
      nodes.push({ x: (column / grid) * size, y: (row / grid) * size });
    }
  }
  const triangles = [];
  const at = (row, column) => row * (grid + 1) + column;
  for (let row = 0; row < grid; row += 1) {
    for (let column = 0; column < grid; column += 1) {
      triangles.push([at(row, column), at(row, column + 1), at(row + 1, column)]);
      triangles.push([at(row, column + 1), at(row + 1, column + 1), at(row + 1, column)]);
    }
  }
  return { nodes, triangles };
}

// Portrait-space anchors: the movable feature points, plus the face oval pinned
// at zero. Landmarks the detector did not return are simply absent.
export function mimicAnchors(landmarks, map) {
  const anchors = [];
  for (const [name, index] of Object.entries(POINTS)) {
    const point = landmarks[index];
    if (point) anchors.push({ name, ...map(point) });
  }
  for (const index of OVAL) {
    const point = landmarks[index];
    if (point) anchors.push({ name: null, pinned: true, ...map(point) });
  }
  return anchors;
}

// A node moves by the weighted average of the pulls around it. Average, not sum:
// a node between two landmarks would otherwise travel twice as far as either.
export function displaceNodes(nodes, anchors, expression, faceHeight, strength = DEFAULT_MIMIC_STRENGTH, radius = MIMIC_RADIUS) {
  const shifts = EXPRESSIONS[expression]?.shift ?? {};
  const active = anchors.filter((anchor) => anchor.pinned || shifts[anchor.name]);
  if (!active.length) return nodes;
  const spread = 2 * radius * radius;
  return nodes.map((node) => {
    let dx = 0, dy = 0, total = 0;
    for (const anchor of active) {
      const move = anchor.pinned ? null : shifts[anchor.name];
      const distance = (node.x - anchor.x) ** 2 + (node.y - anchor.y) ** 2;
      const weight = Math.exp(-distance / spread);
      if (weight < 1e-4) continue;
      if (move) {
        dx += move[0] * faceHeight * strength * weight;
        dy += move[1] * faceHeight * strength * weight;
      }
      total += weight;
    }
    return total > 1e-3 ? { x: node.x + dx / total, y: node.y + dy / total } : node;
  });
}

// Each triangle is grown a hair before clipping: neighbouring clips leave a
// hairline of background between them otherwise, and the face looks cracked.
export function warpTriangle(context, image, source, destination, grow = 1.05) {
  const cx = (destination[0].x + destination[1].x + destination[2].x) / 3;
  const cy = (destination[0].y + destination[1].y + destination[2].y) / 3;
  const grown = destination.map((point) => ({ x: cx + (point.x - cx) * grow, y: cy + (point.y - cy) * grow }));
  const denominator = (source[1].x - source[0].x) * (source[2].y - source[0].y)
    - (source[2].x - source[0].x) * (source[1].y - source[0].y);
  if (Math.abs(denominator) < 1e-6) return false;
  context.save();
  context.beginPath();
  context.moveTo(grown[0].x, grown[0].y);
  context.lineTo(grown[1].x, grown[1].y);
  context.lineTo(grown[2].x, grown[2].y);
  context.closePath();
  context.clip();
  const a = ((destination[1].x - destination[0].x) * (source[2].y - source[0].y)
    - (destination[2].x - destination[0].x) * (source[1].y - source[0].y)) / denominator;
  const b = ((destination[1].y - destination[0].y) * (source[2].y - source[0].y)
    - (destination[2].y - destination[0].y) * (source[1].y - source[0].y)) / denominator;
  const c = ((destination[2].x - destination[0].x) * (source[1].x - source[0].x)
    - (destination[1].x - destination[0].x) * (source[2].x - source[0].x)) / denominator;
  const d = ((destination[2].y - destination[0].y) * (source[1].x - source[0].x)
    - (destination[1].y - destination[0].y) * (source[2].x - source[0].x)) / denominator;
  context.setTransform(a, b, c, d,
    destination[0].x - a * source[0].x - c * source[0].y,
    destination[0].y - b * source[0].x - d * source[0].y);
  context.drawImage(image, 0, 0);
  context.restore();
  return true;
}

// Squash and stretch pivots on the chin, the way an animator would do it: the
// head flattens down onto its own neck instead of floating away from it.
export function headCentre(anchors, fallback) {
  const pinned = anchors.filter((anchor) => anchor.pinned);
  if (!pinned.length) return { x: fallback / 2, y: fallback / 2 };
  let x = 0, bottom = -Infinity;
  for (const anchor of pinned) { x += anchor.x; bottom = Math.max(bottom, anchor.y); }
  return { x: x / pinned.length, y: bottom };
}

// The rectangle the photo actually occupies, and how much of the frame it fills.
// Scanned once per photo, never per expression: the pixel scan cost more than
// every warp put together.
export function opaqueBounds(portrait) {
  const { width, height } = portrait;
  const data = portrait.getContext("2d").getImageData(0, 0, width, height).data;
  let left = width, right = -1, top = height, bottom = -1, filled = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] <= 8) continue;
      filled += 1;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  const coverage = filled / (width * height);
  return right < 0
    ? { left: 0, top: 0, right: width - 1, bottom: height - 1, coverage: 0 }
    : { left, top, right, bottom, coverage };
}

// The warp moves the photo's edges too, so the frame check has to allow for it.
//
// A warped point is its own position plus a blend of the displacements of the
// cell corners around it, so sliding the photo's box by the extreme
// displacements of the cells that cover it bounds the result exactly. Two
// looser rules were tried first and both cost real squash: padding by the
// largest displacement anywhere (a brow lifted 40 px shrank the pose as if the
// chin had moved), and taking the box of the displaced nodes themselves (which
// snaps outward by a whole cell).
export function warpedBounds(bounds, nodes, destination, size, grid = MIMIC_GRID) {
  const step = size / grid;
  const clamp = (value) => Math.max(0, Math.min(grid - 1, value));
  const firstRow = clamp(Math.floor(bounds.top / step));
  const lastRow = clamp(Math.ceil(bounds.bottom / step) - 1);
  const firstColumn = clamp(Math.floor(bounds.left / step));
  const lastColumn = clamp(Math.ceil(bounds.right / step) - 1);
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      let dxMin = Infinity, dxMax = -Infinity, dyMin = Infinity, dyMax = -Infinity;
      for (const index of [
        row * (grid + 1) + column, row * (grid + 1) + column + 1,
        (row + 1) * (grid + 1) + column, (row + 1) * (grid + 1) + column + 1,
      ]) {
        const moved = destination[index];
        if (!moved) continue;
        const dx = moved.x - nodes[index].x;
        const dy = moved.y - nodes[index].y;
        if (dx < dxMin) dxMin = dx;
        if (dx > dxMax) dxMax = dx;
        if (dy < dyMin) dyMin = dy;
        if (dy > dyMax) dyMax = dy;
      }
      if (dxMin === Infinity) continue;
      const cellLeft = Math.max(bounds.left, column * step);
      const cellRight = Math.min(bounds.right, (column + 1) * step);
      const cellTop = Math.max(bounds.top, row * step);
      const cellBottom = Math.min(bounds.bottom, (row + 1) * step);
      if (cellLeft + dxMin < left) left = cellLeft + dxMin;
      if (cellRight + dxMax > right) right = cellRight + dxMax;
      if (cellTop + dyMin < top) top = cellTop + dyMin;
      if (cellBottom + dyMax > bottom) bottom = cellBottom + dyMax;
    }
  }
  return left === Infinity ? bounds : { left, right, top, bottom };
}

export function poseMatrix(pose, centre, faceHeight, strength) {
  if (!pose || strength <= 0) return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const sx = 1 + ((pose.sx ?? 1) - 1) * strength;
  const sy = 1 + ((pose.sy ?? 1) - 1) * strength;
  const rotate = ((pose.rotate ?? 0) * strength * Math.PI) / 180;
  const skew = (pose.skew ?? 0) * strength;
  const dy = (pose.dy ?? 0) * strength * faceHeight;
  const cos = Math.cos(rotate), sin = Math.sin(rotate);
  // translate(cx, cy + dy) · rotate · [sx 0 skew sy] · translate(-cx, -cy)
  const a = cos * sx, b = sin * sx;
  const c = cos * skew - sin * sy, d = sin * skew + cos * sy;
  return {
    a, b, c, d,
    e: centre.x - a * centre.x - c * centre.y,
    f: centre.y + dy - b * centre.x - d * centre.y,
  };
}

export function applyMatrix(m, point) {
  return { x: m.a * point.x + m.c * point.y + m.e, y: m.b * point.x + m.d * point.y + m.f };
}

// Two pixels of air, so a rounded edge cannot land on the border and read as a
// straight cut across the hair — but never more air than the photo already has.
// A head cropped tight to the frame would otherwise fail the check on its own
// neutral pose and lose its mimicry entirely.
const MARGIN = 2;

export function frameLimits(bounds, width, height) {
  return {
    left: Math.min(MARGIN, bounds.left),
    top: Math.min(MARGIN, bounds.top),
    right: Math.max(width - 1 - MARGIN, bounds.right),
    bottom: Math.max(height - 1 - MARGIN, bounds.bottom),
  };
}

// How much of the pose survives without pushing the photo off the canvas.
export function poseFit(pose, centre, bounds, width, height, faceHeight, strength) {
  const frame = frameLimits(bounds, width, height);
  const fits = (factor) => {
    const m = poseMatrix(pose, centre, faceHeight, strength * factor);
    for (const corner of [[bounds.left, bounds.top], [bounds.right, bounds.top],
      [bounds.left, bounds.bottom], [bounds.right, bounds.bottom]]) {
      const { x, y } = applyMatrix(m, { x: corner[0], y: corner[1] });
      if (x < frame.left || y < frame.top || x > frame.right || y > frame.bottom) return false;
    }
    return true;
  };
  if (fits(1)) return 1;
  let low = 0, high = 1;
  for (let i = 0; i < 12; i += 1) {
    const mid = (low + high) / 2;
    if (fits(mid)) low = mid; else high = mid;
  }
  return low;
}

// A warp can move the lips apart but it cannot invent the dark behind them — it
// stretches cheek over the gap instead, which is why an open mouth read as
// nothing at all. This shades the opening the jaw made, clipped to the head
// (source-atop) so it can never spill onto the background.
export function shadeMouth(surface, anchors, expression, faceHeight, strength, matrix) {
  const shifts = EXPRESSIONS[expression]?.shift ?? {};
  const drop = ((shifts.mouthBottom?.[1] ?? 0) - (shifts.mouthTop?.[1] ?? 0)) * strength;
  if (drop <= 0.04) return surface;
  const named = (name) => anchors.find((anchor) => anchor.name === name);
  const parts = ["mouthTop", "mouthBottom", "mouthLeft", "mouthRight"].map((name) => {
    const anchor = named(name);
    if (!anchor) return null;
    return applyMatrix(matrix, {
      x: anchor.x + (shifts[name]?.[0] ?? 0) * faceHeight * strength,
      y: anchor.y + (shifts[name]?.[1] ?? 0) * faceHeight * strength,
    });
  });
  if (parts.some((part) => !part)) return surface;
  const [top, bottom, left, right] = parts;
  const cx = (top.x + bottom.x + left.x + right.x) / 4;
  const cy = (top.y + bottom.y) / 2;
  const radiusY = Math.max(2, Math.hypot(bottom.x - top.x, bottom.y - top.y) / 2);
  const radiusX = Math.max(2, Math.hypot(right.x - left.x, right.y - left.y) / 2.6);
  const outer = Math.max(radiusX, radiusY);
  const context = surface.getContext("2d");
  const gradient = context.createRadialGradient(cx, cy, 0, cx, cy, outer);
  const depth = Math.min(0.82, 0.3 + drop * 3.4);
  gradient.addColorStop(0, `rgba(22, 12, 16, ${depth})`);
  gradient.addColorStop(0.62, `rgba(28, 15, 20, ${depth * 0.62})`);
  gradient.addColorStop(1, "rgba(30, 16, 22, 0)");
  context.save();
  context.globalCompositeOperation = "source-atop";
  context.translate(cx, cy);
  context.scale(radiusX / outer, radiusY / outer);
  context.translate(-cx, -cy);
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(cx, cy, outer, 0, Math.PI * 2);
  context.fill();
  context.restore();
  return surface;
}

export function warpPortrait(portrait, mesh, destination, createSurface) {
  const surface = createSurface(portrait.width, portrait.height);
  const context = surface.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  for (const [a, b, c] of mesh.triangles) {
    warpTriangle(context, portrait,
      [mesh.nodes[a], mesh.nodes[b], mesh.nodes[c]],
      [destination[a], destination[b], destination[c]]);
  }
  return surface;
}

// The whole set, baked once. `neutral` is the untouched photo, so the head the
// player recognises is never a warp of itself.
//
// The pose is folded into the mesh rather than drawn as a second pass: both are
// affine, so composing them is exact, and it halved the bake — a second 512 px
// canvas per expression cost more than the warp itself.
// The geometry of one expression: where every mesh node ends up once the warp
// and the pose are composed, plus the matrix the pose contributed. Kept apart
// from the drawing so the movement can be measured without a raster canvas.
export function expressionGeometry(mesh, anchors, expression, faceHeight, bounds, size, strength = DEFAULT_MIMIC_STRENGTH, centre = null) {
  const pose = EXPRESSIONS[expression]?.pose ?? null;
  const pivot = centre ?? headCentre(anchors, size);
  const displaced = displaceNodes(mesh.nodes, anchors, expression, faceHeight, strength);
  const fit = pose
    ? poseFit(pose, pivot, warpedBounds(bounds, mesh.nodes, displaced, size), size, size, faceHeight, strength)
    : 0;
  const matrix = poseMatrix(pose, pivot, faceHeight, strength * fit);
  const destination = pose && fit > 0 ? displaced.map((node) => applyMatrix(matrix, node)) : displaced;
  return { destination, matrix, fit };
}

// How far the photo travels at the size the game actually draws the head. This
// is the number that decides whether an expression is a face or a placebo.
export function expressionTravel(mesh, geometry, size, headSize) {
  let most = 0;
  for (let i = 0; i < mesh.nodes.length; i += 1) {
    most = Math.max(most, Math.hypot(
      geometry.destination[i].x - mesh.nodes[i].x,
      geometry.destination[i].y - mesh.nodes[i].y,
    ));
  }
  return (most * headSize) / size;
}

// The whole set, baked once. `neutral` is the untouched photo, so the head the
// player recognises is never a warp of itself.
//
// The pose is folded into the mesh rather than drawn as a second pass: both are
// affine, so composing them is exact, and it took the bake from 640 ms to 60 —
// a second 512 px canvas per expression cost ten times the warp itself.
export function buildExpressionSheet(portrait, anchors, faceHeight, createSurface, strength = DEFAULT_MIMIC_STRENGTH, knownBounds = null) {
  const sheet = { neutral: portrait };
  if (!anchors?.length || !(faceHeight > 0) || strength <= 0) return sheet;
  const mesh = buildMimicMesh(portrait.width);
  const centre = headCentre(anchors, portrait.width);
  const bounds = knownBounds ?? opaqueBounds(portrait);
  for (const expression of MIMIC_EXPRESSIONS) {
    if (expression === "neutral") continue;
    const geometry = expressionGeometry(mesh, anchors, expression, faceHeight, bounds, portrait.width, strength, centre);
    const surface = warpPortrait(portrait, mesh, geometry.destination, createSurface);
    shadeMouth(surface, anchors, expression, faceHeight, strength, geometry.matrix);
    sheet[expression] = surface;
  }
  return sheet;
}

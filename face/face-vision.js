const VISION_MODULE_URL = new URL("../vendor/mediapipe/vision_bundle.mjs", import.meta.url).href;
const WASM_ROOT_URL = new URL("../vendor/mediapipe/wasm", import.meta.url).href;
const FACE_MODEL_URL = new URL("../models/face_landmarker.task", import.meta.url).href;
const SEGMENTATION_MODEL_URL = new URL("../models/selfie_multiclass_256x256.tflite", import.meta.url).href;

const copyConnections = (connections = []) => connections.map(({ start, end }) => ({ start, end }));

export class FaceVisionError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "FaceVisionError";
    this.code = code;
  }
}

/**
 * Local-only face analysis for a single still image.
 *
 * CPU is intentional. The MediaPipe multiclass mask can return shuffled
 * categories with the GPU delegate on iOS Safari. A still photo does not need
 * the extra throughput, while deterministic hair/skin labels are essential.
 */
export class FaceVision {
  constructor() {
    this.faceLandmarker = null;
    this.imageSegmenter = null;
    this.contours = null;
    this.readyPromise = null;
  }

  async ensureReady(onProgress = () => {}) {
    if (this.faceLandmarker && this.imageSegmenter) return;
    if (!this.readyPromise) {
      this.readyPromise = this.createTasks(onProgress).catch((error) => {
        this.readyPromise = null;
        throw error;
      });
    }
    return this.readyPromise;
  }

  async createTasks(onProgress) {
    try {
      onProgress("Uruchamiam lokalny model twarzy…");
      const vision = await import(VISION_MODULE_URL);
      const fileset = await vision.FilesetResolver.forVisionTasks(WASM_ROOT_URL);

      onProgress("Wczytuję mapę 478 punktów twarzy…");
      this.faceLandmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: FACE_MODEL_URL,
          delegate: "CPU",
        },
        runningMode: "IMAGE",
        numFaces: 1,
        minFaceDetectionConfidence: 0.55,
        minFacePresenceConfidence: 0.55,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      });

      onProgress("Wczytuję lokalne wycinanie włosów i skóry…");
      this.imageSegmenter = await vision.ImageSegmenter.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: SEGMENTATION_MODEL_URL,
          delegate: "CPU",
        },
        runningMode: "IMAGE",
        outputCategoryMask: true,
        outputConfidenceMasks: false,
      });

      this.contours = {
        faceOval: copyConnections(vision.FaceLandmarker.FACE_LANDMARKS_FACE_OVAL),
        lips: copyConnections(vision.FaceLandmarker.FACE_LANDMARKS_LIPS),
        leftEye: copyConnections(vision.FaceLandmarker.FACE_LANDMARKS_LEFT_EYE),
        rightEye: copyConnections(vision.FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE),
        leftEyebrow: copyConnections(vision.FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW),
        rightEyebrow: copyConnections(vision.FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW),
        leftIris: copyConnections(vision.FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS),
        rightIris: copyConnections(vision.FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS),
      };
    } catch (error) {
      this.close();
      throw new FaceVisionError(
        "model-load",
        "Nie udało się uruchomić lokalnego wykrywania twarzy. Odśwież stronę i spróbuj ponownie.",
        error,
      );
    }
  }

  async analyze(image, onProgress = () => {}) {
    await this.ensureReady(onProgress);

    try {
      onProgress("Szukam naturalnego konturu twarzy…");
      const faceResult = this.faceLandmarker.detect(image);
      const landmarks = faceResult.faceLandmarks?.[0];
      if (!landmarks?.length) {
        throw new FaceVisionError(
          "no-face",
          "Nie widzę jednej wyraźnej twarzy. Wybierz zdjęcie z przodu, w dobrym świetle i bez zasłoniętej brody.",
        );
      }

      onProgress("Oddzielam głowę i włosy od tła…");
      const segmentResult = this.imageSegmenter.segment(image);
      const categoryMask = segmentResult.categoryMask;
      if (!categoryMask) {
        segmentResult.close();
        throw new FaceVisionError("no-mask", "Nie udało się oddzielić głowy od tła. Wybierz inne zdjęcie.");
      }

      const mask = {
        width: categoryMask.width,
        height: categoryMask.height,
        categories: new Uint8Array(categoryMask.getAsUint8Array()),
      };
      segmentResult.close();

      return {
        landmarks: landmarks.map(({ x, y, z = 0 }) => ({ x, y, z })),
        mask,
        contours: this.contours,
        labels: ["background", "hair", "body-skin", "face-skin", "clothes", "accessories"],
      };
    } catch (error) {
      if (error instanceof FaceVisionError) throw error;
      throw new FaceVisionError(
        "analysis",
        "Analiza twarzy nie powiodła się. Spróbuj zdjęcia z twarzą skierowaną do aparatu.",
        error,
      );
    }
  }

  close() {
    try { this.faceLandmarker?.close(); } catch {}
    try { this.imageSegmenter?.close(); } catch {}
    this.faceLandmarker = null;
    this.imageSegmenter = null;
    this.contours = null;
  }
}


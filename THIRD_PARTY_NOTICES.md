# Third-party notices

The selfie feature (FAN CAM and the share card) re-uses the face kit from
SlingToon (`face/face-vision.js`, `face/portrait.js`, `face/face-mimic.js`).

## MediaPipe Tasks Vision

- Package: `@mediapipe/tasks-vision` 1.0.1
- Publisher: Google / MediaPipe Authors
- License declared by the package: Apache License 2.0
- Project: <https://github.com/google-ai-edge/mediapipe>
- License copy: `vendor/mediapipe/LICENSE.txt`

Only the browser bundle and its WebAssembly runtime are vendored. Funky Cat
loads them from the same GitHub Pages origin, and only after the player chooses
to add a selfie. The photo is processed on the device and is never uploaded.

## MediaPipe model assets

Stored unmodified in `models/` so inference runs in the browser.

### Face Landmarker

- Source: <https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task>
- SHA-256: `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`

### Selfie Multiclass Image Segmenter

- Source: <https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite>
- SHA-256: `c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0`

Review the current MediaPipe model terms before commercial distribution
(for example in the App Store).

// Copies the on-device OCR engine and English model into public/ocr/ so the app
// serves them itself (no CDN, works inside the mobile apps). Runs before dev and build.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mod = (p) => join(root, "node_modules", p);
const out = join(root, "public", "ocr");
mkdirSync(out, { recursive: true });

const files = {
  "worker.min.js": mod("tesseract.js/dist/worker.min.js"),
  // LSTM-only engine builds; the worker picks one by the device's WebAssembly SIMD support.
  "tesseract-core-lstm.wasm.js": mod("tesseract.js-core/tesseract-core-lstm.wasm.js"),
  "tesseract-core-simd-lstm.wasm.js": mod("tesseract.js-core/tesseract-core-simd-lstm.wasm.js"),
  "tesseract-core-relaxedsimd-lstm.wasm.js": mod("tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js"),
  // The compact integer model (2.9 MB) rather than the 10.9 MB float one.
  "eng.traineddata.gz": mod("@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz"),
};
for (const [name, from] of Object.entries(files)) copyFileSync(from, join(out, name));
console.log(`ocr-assets: copied ${Object.keys(files).length} files to public/ocr/`);

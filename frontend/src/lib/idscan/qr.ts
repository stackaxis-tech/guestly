import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import { imageData, toCanvas } from "./image";

// Serve the decoder from our own build, not the library's default CDN.
let prepared = false;
function prepare() {
  if (prepared) return;
  prepared = true;
  prepareZXingModule({
    overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasmUrl : prefix + path) },
    fireImmediately: false,
  });
}

/**
 * Finds QR codes on the device and returns the longest text (an Aadhaar QR is
 * by far the densest code on the card), or null. `fast` is for live camera
 * frames, where the next frame is a better retry than trying harder.
 */
export async function decodeQR(src: Blob | HTMLCanvasElement, fast = false): Promise<string | null> {
  prepare();
  // Full phone resolution keeps the dense Secure QR's modules sharp; 3000px caps memory.
  const canvas = src instanceof HTMLCanvasElement && fast ? src : await toCanvas(src, 3000);
  const results = await readBarcodes(imageData(canvas), {
    formats: ["QRCode"],
    tryHarder: !fast,
    tryRotate: !fast,
    tryInvert: false,
    tryDownscale: true,
    maxNumberOfSymbols: 4,
  });
  const texts = results.filter((r) => r.isValid && r.text).map((r) => r.text);
  return texts.sort((a, b) => b.length - a.length)[0] ?? null;
}

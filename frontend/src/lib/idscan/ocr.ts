import { createWorker, OEM, PSM, type Worker } from "tesseract.js";

/*
 * On-device text recognition (Tesseract compiled to WebAssembly). Images never
 * leave the device. The engine and English model (~7 MB) are served from our
 * own build under /ocr/ (copied by scripts/ocr-assets.mjs), downloaded on first
 * use and then cached by the browser.
 */

let worker: Promise<Worker> | null = null;
let ready = false;
let idle: ReturnType<typeof setTimeout> | undefined;
let queue: Promise<unknown> = Promise.resolve();

const assets = () => new URL(`${import.meta.env.BASE_URL}ocr/`, window.location.href).href;

function getWorker(): Promise<Worker> {
  worker ??= createWorker("eng", OEM.LSTM_ONLY, {
    workerPath: assets() + "worker.min.js",
    corePath: assets(),
    langPath: assets(),
    workerBlobURL: false,
    gzip: true,
  })
    .then((w) => {
      ready = true;
      return w;
    })
    .catch((err) => {
      worker = null;
      throw err;
    });
  return worker;
}

/** True once the engine is loaded; the first load can take a while on slow Wi-Fi. */
export const ocrReady = () => ready;

export { PSM };

/** Recognises text in a canvas. Calls run one at a time because they share settings. */
export function recognize(canvas: HTMLCanvasElement, opts: { psm?: PSM; whitelist?: string } = {}): Promise<string> {
  const job = queue.then(async () => {
    clearTimeout(idle);
    const w = await getWorker();
    await w.setParameters({ tessedit_pageseg_mode: opts.psm ?? PSM.AUTO, tessedit_char_whitelist: opts.whitelist ?? "" });
    const { data } = await w.recognize(canvas);
    return data.text;
  });
  queue = job.catch(() => undefined).finally(scheduleShutdown);
  return job;
}

// The engine holds ~100 MB; free it when check-in is done scanning.
function scheduleShutdown() {
  clearTimeout(idle);
  idle = setTimeout(() => {
    const w = worker;
    worker = null;
    ready = false;
    void w?.then((x) => x.terminate()).catch(() => undefined);
  }, 120_000);
}

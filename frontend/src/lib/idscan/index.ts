import { compressImage } from "../../components/CameraCapture";
import { ApiError } from "../api";
import { docTypeLabel, parseAadhaarText, scanAadhaar, type AadhaarDetails, type DocType } from "../stays";
import { bottom, rotate, toCanvas } from "./image";
import { parseIndianId, type IndianIdType } from "./indianIds";
import { parseMRZ } from "./mrz";
import { emptyScan, ScanError, type ScanResult } from "./types";

export { ScanError, type ScanResult } from "./types";

// The QR decoder and OCR engine load on first scan, keeping them out of the main bundle.
const loadQR = () => import("./qr");
const loadOCR = () => import("./ocr");

/** Document types that can auto-fill. */
export const canScan = (t: DocType) => t !== "other";

/** Sides worth reading: the passport MRZ and PAN details are all on the front. */
export const scanBothSides = (t: DocType) => t === "aadhaar" || t === "voter_id" || t === "driving_licence";

const fromAadhaar = (d: AadhaarDetails): ScanResult => ({
  ...emptyScan(),
  name: d.name,
  gender: (["female", "male", "other"].includes(d.gender) ? d.gender : "") as ScanResult["gender"],
  birthYear: d.birthYear,
  address: d.address,
  number: d.last4,
});

/**
 * Reads an ID photo and returns what it could fill in. Throws ScanError with a
 * message for staff when nothing usable was found.
 * onStatus reports slow steps, such as the first OCR download.
 */
export async function scanDocument(type: DocType, src: Blob | HTMLCanvasElement, propertyId: string, onStatus?: (msg: string) => void): Promise<ScanResult> {
  switch (type) {
    case "aadhaar":
      return scanAadhaarPhoto(src, propertyId);
    case "passport":
      return scanPassport(src, onStatus);
    case "pan":
    case "voter_id":
    case "driving_licence":
      return scanIndianId(type, src, onStatus);
    default:
      throw new ScanError("This ID type can't be read automatically. Please type the details.");
  }
}

/** The QR is decoded on the device and only its text is sent for parsing; the server reads the photo only as a fallback. */
async function scanAadhaarPhoto(src: Blob | HTMLCanvasElement, propertyId: string): Promise<ScanResult> {
  const text = await loadQR()
    .then((m) => m.decodeQR(src))
    .catch(() => null);
  try {
    return fromAadhaar(text ? await parseAadhaarText(propertyId, text) : await scanAadhaar(propertyId, await compressImage(src, 2400, 0.92)));
  } catch (err) {
    if (err instanceof ApiError && err.status === 422) throw new ScanError(err.message);
    throw err;
  }
}

const MRZ_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<";

async function warmUp(onStatus?: (msg: string) => void) {
  const ocr = await loadOCR();
  if (!ocr.ocrReady()) onStatus?.("Getting the reader ready (first time only, about 7 MB)…");
  return ocr;
}

async function scanPassport(src: Blob | HTMLCanvasElement, onStatus?: (msg: string) => void): Promise<ScanResult> {
  const { recognize, PSM } = await warmUp(onStatus);
  const page = await toCanvas(src, 2000);
  // The MRZ sits at the bottom of the photo page. Try upright first, then the
  // other ways a phone photo can be turned.
  for (const turned of [page, rotate(page, 90), rotate(page, 270), rotate(page, 180)]) {
    const text = await recognize(bottom(turned, 0.4), { psm: PSM.SINGLE_BLOCK, whitelist: MRZ_CHARS });
    const r = parseMRZ(text);
    if (r) return r;
    onStatus?.("Still reading… hold on");
  }
  throw new ScanError(
    "Couldn't read the passport. Photograph the photo page flat, in good light, with the two lines of <<< at the bottom in view, or type the details.",
  );
}

async function scanIndianId(type: IndianIdType, src: Blob | HTMLCanvasElement, onStatus?: (msg: string) => void): Promise<ScanResult> {
  const { recognize } = await warmUp(onStatus);
  const card = await toCanvas(src, 2000);
  for (const turned of [card, rotate(card, 90), rotate(card, 270)]) {
    const r = parseIndianId(type, await recognize(turned));
    if (r) return r;
    onStatus?.("Still reading… hold on");
  }
  throw new ScanError(`Couldn't read the ${docTypeLabel[type]}. Retake the photo flat, filling the frame, without glare, or type the details.`);
}

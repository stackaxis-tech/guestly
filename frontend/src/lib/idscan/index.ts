import { compressImage } from "../../components/CameraCapture";
import { docTypeLabel, parseAadhaarText, scanAadhaar, type AadhaarDetails, type DocType } from "../stays";
import { bottom, rotate, toCanvas } from "./image";
import { parseIndianId, type IndianIdType } from "./indianIds";
import { parseMRZ, parsePassportText } from "./mrz";
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
      return scanAadhaarPhoto(src, propertyId, onStatus);
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

/** The QR is decoded first (on device or server); if unreadable or absent, falls back to OCR on the card text. */
async function scanAadhaarPhoto(src: Blob | HTMLCanvasElement, propertyId: string, onStatus?: (msg: string) => void): Promise<ScanResult> {
  const text = await loadQR()
    .then((m) => m.decodeQR(src))
    .catch(() => null);
  if (text) {
    try {
      const details = await parseAadhaarText(propertyId, text);
      return fromAadhaar(details);
    } catch {
      // Fall through to server QR decode or OCR
    }
  }

  try {
    const compressed = await compressImage(src, 2400, 0.92);
    const details = await scanAadhaar(propertyId, compressed);
    return fromAadhaar(details);
  } catch {
    // If QR code reading fails, fallback to on-device OCR on the Aadhaar card
    onStatus?.("Reading Aadhaar card details…");
  }

  // Fallback: OCR reading of Aadhaar card front/back
  return scanIndianId("aadhaar", src, onStatus);
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
  
  // Try reading MRZ at bottom 45% and bottom 65% across all orientations
  for (const turned of [page, rotate(page, 90), rotate(page, 180), rotate(page, 270)]) {
    for (const fraction of [0.45, 0.65]) {
      const text = await recognize(bottom(turned, fraction), { psm: PSM.SINGLE_BLOCK, whitelist: MRZ_CHARS });
      const r = parseMRZ(text);
      if (r) return r;
    }
    onStatus?.("Still reading passport… hold on");
  }

  // Fallback: full-page text recognition if MRZ is cropped or checksum is unreadable
  for (const turned of [page, rotate(page, 90), rotate(page, 270)]) {
    const fullText = await recognize(turned);
    const r = parsePassportText(fullText);
    if (r && (r.number || r.name)) return r;
  }

  throw new ScanError(
    "Couldn't read the passport. Photograph the photo page flat, in good light, with the two lines of <<< at the bottom in view, or type the details.",
  );
}

async function scanIndianId(type: IndianIdType, src: Blob | HTMLCanvasElement, onStatus?: (msg: string) => void): Promise<ScanResult> {
  const { recognize } = await warmUp(onStatus);
  const card = await toCanvas(src, 2000);
  for (const turned of [card, rotate(card, 90), rotate(card, 180), rotate(card, 270)]) {
    const r = parseIndianId(type, await recognize(turned));
    if (r) return r;
    onStatus?.("Still reading… hold on");
  }
  throw new ScanError(`Couldn't read the ${docTypeLabel[type]}. Retake the photo flat, filling the frame, without glare, or type the details.`);
}

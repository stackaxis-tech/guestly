/** Details read from an ID on the device. Empty strings / null mean "not read". */
export type ScanResult = {
  name: string;
  gender: "" | "female" | "male" | "other";
  birthYear: number | null;
  address: string;
  /** ISO 3166 alpha-2 from a passport, "" for Indian IDs. */
  nationality: string;
  /** The ID number. Aadhaar only ever gives the last four digits. */
  number: string;
  /** Passport expiry, YYYY-MM-DD. */
  expiry: string;
};

export const emptyScan = (): ScanResult => ({ name: "", gender: "", birthYear: null, address: "", nationality: "", number: "", expiry: "" });

/** A scan that ran but found nothing usable; the message is shown to staff. */
export class ScanError extends Error {}

// OCR often swaps look-alike characters. These map a character to what it must
// be when the position is known to hold a digit or a letter.
const TO_DIGIT: Record<string, string> = { O: "0", Q: "0", D: "0", U: "0", I: "1", L: "1", J: "1", T: "7", Z: "2", S: "5", B: "8", G: "6", A: "4" };
const TO_LETTER: Record<string, string> = { "0": "O", "1": "I", "2": "Z", "4": "A", "5": "S", "6": "G", "7": "T", "8": "B" };

export const asDigits = (s: string) => s.replace(/./g, (c) => TO_DIGIT[c] ?? c);
export const asLetters = (s: string) => s.replace(/./g, (c) => TO_LETTER[c] ?? c);

/** "RAHUL  KUMAR" → "Rahul Kumar". */
export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

/** A 2-digit year as a birth year: never in the future. */
export function birthYearFrom2(yy: number, now = new Date()): number {
  const y = 2000 + yy;
  return y > now.getFullYear() ? y - 100 : y;
}

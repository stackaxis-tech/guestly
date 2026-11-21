import { asDigits, asLetters, emptyScan, titleCase, type ScanResult } from "./types";

/*
 * Pulls details out of OCR text from Indian PAN, Voter ID (EPIC) and driving
 * licence cards. OCR is noisy, so every value must pass a format check, and a
 * field is left empty rather than guessed. Staff confirm everything.
 */

export type IndianIdType = "pan" | "voter_id" | "driving_licence" | "aadhaar";

const PAN = /^[A-Z]{3}[ABCFGHJLPT][A-Z][0-9]{4}[A-Z]$/;
const EPIC = /^[A-Z]{3}[0-9]{7}$/;
const STATES = new Set(
  "AN AP AR AS BR CG CH DD DL DN GA GJ HP HR JH JK KA KL LA LD MH ML MN MP MZ NL OD OR PB PY RJ SK TN TR TS UK UP WB".split(" "),
);

/** Characters changed by a look-alike repair; more than a couple means it's not an ID number. */
const changes = (a: string, b: string) => [...a].filter((c, i) => c !== b[i]).length;

/** Joins up to three neighbouring tokens, since OCR often splits an ID number. */
function windows(text: string): string[] {
  const tokens = text.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    let joined = "";
    for (let j = i; j < Math.min(i + 3, tokens.length); j++) out.push((joined += tokens[j]));
  }
  return out;
}

export function findPAN(text: string): string {
  for (const w of windows(text)) {
    if (w.length !== 10) continue;
    const c = asLetters(w.slice(0, 5)) + asDigits(w.slice(5, 9)) + asLetters(w.slice(9));
    if (PAN.test(c) && changes(w.slice(0, 5) + w.slice(9), c.slice(0, 5) + c.slice(9)) <= 1 && changes(w.slice(5, 9), c.slice(5, 9)) <= 2) return c;
  }
  return "";
}

export function findEPIC(text: string): string {
  for (const w of windows(text)) {
    if (w.length !== 10) continue;
    const c = asLetters(w.slice(0, 3)) + asDigits(w.slice(3));
    if (EPIC.test(c) && changes(w.slice(0, 3), c.slice(0, 3)) <= 1 && changes(w.slice(3), c.slice(3)) <= 2) return c;
  }
  return "";
}

/** Driving licence: state, RTO, issue year, 4-7 digit serial, e.g. KL07 20150001234 or DL-0420110012345. */
export function findDL(text: string): string {
  // Labeled DL number: e.g. "DL No: KL07 20150001234" or "Licence No: DL-0420110012345"
  const labelled = /(?:DL|Licen[cs]e|D\.L\.)\s*(?:No|Number|#)?\s*[:.\-]?\s*([A-Z0-9/\- ]{8,25})/i.exec(text);
  if (labelled) {
    const raw = labelled[1]!.toUpperCase().replace(/[\s\-./]/g, "");
    const state = asLetters(raw.slice(0, 2));
    if (STATES.has(state) && raw.length >= 10 && raw.length <= 18) {
      return state + asDigits(raw.slice(2));
    }
  }

  // Standard format with RTO, Year, and 4-7 digit serial
  const re = /([A-Z0-9]{2})[\s\-./]*([0-9OILSZB]{1,3})[\s\-./]*([0-9OILSZB]{4})[\s\-./]*([0-9OILSZB]{4,7})(?![0-9])/g;
  for (const line of text.toUpperCase().split(/\r?\n/)) {
    for (const m of line.matchAll(re)) {
      const state = asLetters(m[1]!);
      const year = Number(asDigits(m[3]!));
      if (!STATES.has(state) || year < 1950 || year > new Date().getFullYear()) continue;
      return state + asDigits(m[2]! + m[3]! + m[4]!);
    }
  }

  // Format with RTO, serial, and Year at end: e.g. "DL-01/1234/2012"
  const reOld = /([A-Z]{2})[\s\-./]*([0-9]{1,3})[\s\-./]*([0-9]{3,7})[\s\-./]*((?:19|20)\d{2})\b/g;
  for (const line of text.toUpperCase().split(/\r?\n/)) {
    for (const m of line.matchAll(reOld)) {
      const state = asLetters(m[1]!);
      if (!STATES.has(state)) continue;
      return state + asDigits(m[2]! + m[4]! + m[3]!);
    }
  }
  return "";
}

const DATE = /(\d{2})\s*[/\-.]\s*(\d{2})\s*[/\-.]\s*((?:19|20)\d{2})/;

/** Year of birth: the date on a DOB line, else the earliest date (licences also show issue and expiry dates). */
export function findBirthYear(lines: string[]): number | null {
  const now = new Date().getFullYear();
  const valid = (m: RegExpExecArray | null) => {
    if (!m) return null;
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && y >= 1900 && y <= now ? y : null;
  };
  for (const l of lines) if (/(dob|d\.o\.b|birth)/i.test(l)) {
    const y = valid(DATE.exec(asDigits(l.replace(/^.*?(dob|d\.o\.b|birth)/i, ""))));
    if (y) return y;
  }
  const years = lines.map((l) => valid(DATE.exec(l))).filter((y): y is number => y !== null);
  return years.length ? Math.min(...years) : null;
}

export function findGender(text: string): ScanResult["gender"] {
  if (/\bfemale\b/i.test(text)) return "female";
  if (/\bmale\b/i.test(text)) return "male";
  if (/\btransgender\b/i.test(text)) return "other";
  const m = /\b(?:sex|gender)\s*[:/.\-]?\s*([MF])\b/i.exec(text);
  return m ? (m[1]!.toUpperCase() === "F" ? "female" : "male") : "";
}

const NOT_A_NAME =
  /\b(name|india|govt|government|department|income|tax|election|commission|card|driving|licen[cs]e|union|transport|date|birth|address|signature|permanent|account|number|identity|elector|father|husband|mother|valid|issue|form|state|male|female|sex|gender)\b/i;
const RELATION = /(father|husband|mother|guardian|relation|\b[sdw]\s*\/\s*o\b)/i;

/** A person's name or "" if the text doesn't look like one. */
export function cleanName(raw: string): string {
  let s = raw.replace(/\b(mr|ms|mrs|shri|sh|smt|dr)\.?\s+/i, "");
  s = s.replace(/[^A-Za-z.'\s]/g, " ").replace(/\s+/g, " ").trim().replace(/^[.'\s]+|[.'\s]+$/g, "");
  const words = s.split(" ");
  if (s.length < 3 || s.length > 60 || NOT_A_NAME.test(s) || words.some((w) => w.replace(/[.']/g, "").length === 0)) return "";
  // Mostly one-letter words means OCR noise, not a name ("A K Sharma" is fine).
  if (words.filter((w) => w.length >= 2).length === 0) return "";
  return titleCase(s);
}

/** Extracts Aadhaar card details from OCR text (card front/back or e-Aadhaar). */
export function findAadhaar(text: string): { number: string; name: string; birthYear: number | null; gender: ScanResult["gender"]; address: string } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let last4 = "";

  // 12-digit Aadhaar number grouped in 4 4 4 e.g. "1234 5678 9012" or masked "XXXX XXXX 1234"
  for (const line of lines) {
    const m = /\b(?:[X\d]{4}[\s\-]+[X\d]{4}[\s\-]+(\d{4})|(\d{4})[\s\-]+(\d{4})[\s\-]+(\d{4}))\b/.exec(line);
    if (m) {
      last4 = m[1] ?? m[4] ?? "";
      break;
    }
  }
  if (!last4) {
    const m12 = /\b\d{8}(\d{4})\b/.exec(text.replace(/[\s\-]/g, ""));
    if (m12) last4 = m12[1]!;
  }

  // Birth Year / DOB
  let birthYear: number | null = null;
  const dobMatch = /(?:DOB|D\.O\.B|Birth|जन्म)\s*[:\s/.\-]*(\d{2})[/-](\d{2})[/-]((?:19|20)\d{2})/i.exec(text);
  const yobMatch = /(?:Year of Birth|जन्म वर्ष)\s*[:\s/.\-]*((?:19|20)\d{2})/i.exec(text);
  if (dobMatch) {
    birthYear = Number(dobMatch[3]);
  } else if (yobMatch) {
    birthYear = Number(yobMatch[1]);
  } else {
    birthYear = findBirthYear(lines);
  }

  // Gender
  const gender = findGender(text);

  // Address (if back of card is scanned)
  const address = findAddress(lines);
  const isBackSide = lines.some((l) => /\baddress\b/i.test(l)) && !dobMatch && !yobMatch;

  // Name: on an Aadhaar front, the English name is typically 1 or 2 lines above the DOB line
  let name = findLabelledName(lines);
  if (!name && !isBackSide) {
    const dobIdx = lines.findIndex((l) => /(?:DOB|D\.O\.B|Birth|जन्म)/i.test(l));
    if (dobIdx > 0) {
      for (let i = dobIdx - 1; i >= Math.max(0, dobIdx - 3); i--) {
        const candidate = cleanName(lines[i]!);
        if (candidate && !/government|india|authority|unique|identification|enrollment|help|resident/i.test(candidate)) {
          name = candidate;
          break;
        }
      }
    }
  }
  if (!name && !isBackSide) {
    for (const line of lines) {
      if (/government|india|authority|unique|identification|mera|aadhaar|help|resident/i.test(line)) continue;
      if (/\b[1-9]\d{5}\b/.test(line)) continue;
      const n = cleanName(line);
      if (n && n.split(" ").length >= 2) {
        name = n;
        break;
      }
    }
  }

  return { number: last4, name, birthYear, gender, address };
}

/** The value of a "Name" label: after the label on the same line, else the next line. */
export function findLabelledName(lines: string[]): string {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (!/\bname\b/i.test(l) || RELATION.test(l)) continue;
    const after = cleanName(l.replace(/^.*\bname\b\s*[:.\-/]*\s*/i, ""));
    if (after) return after;
    const next = lines[i + 1];
    if (next && !RELATION.test(next)) {
      const n = cleanName(next);
      if (n) return n;
    }
  }
  return "";
}

/**
 * When no "Name" label was read (older PAN cards print none, and OCR often
 * drops the small label on newer ones), the name is the first plain uppercase
 * line after the header. The number may come before it; the DOB comes after.
 */
function unlabelledPANName(lines: string[]): string {
  const header = lines.findIndex((l) => /income\s*tax|department/i.test(l));
  for (const l of lines.slice(header + 1)) {
    if (DATE.test(l)) break; // past the names
    if (/\d/.test(l) || RELATION.test(l)) continue;
    if (!/^[A-Z][A-Z .']+$/.test(l.trim())) continue;
    const n = cleanName(l);
    if (n) return n;
  }
  return "";
}

/** Address after an "Address" label, only when it ends with a PIN code. */
export function findAddress(lines: string[]): string {
  const start = lines.findIndex((l) => /\baddress\b/i.test(l));
  if (start < 0) return "";
  const parts = [lines[start]!.replace(/^.*\baddress\b\s*[:.\-]*\s*/i, "")];
  for (const l of /\b[1-9]\d{5}\b/.test(parts[0]!) ? [] : lines.slice(start + 1, start + 6)) {
    if (/(date|electoral|registration|signature|valid|issue|blood|facsimile|authority)/i.test(l)) break;
    parts.push(l);
    if (/\b[1-9]\d{5}\b/.test(l)) break;
  }
  const text = parts.join(", ").replace(/[^A-Za-z0-9,./\-#\s]/g, " ").replace(/\s+/g, " ").replace(/(,\s*)+/g, ", ").trim().replace(/^,|,$/g, "").trim();
  return /\b[1-9]\d{5}\b/.test(text) ? text : "";
}

/** Reads what it can. Returns null if not even a name, number, or birth year was found. */
export function parseIndianId(type: IndianIdType, text: string): ScanResult | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const r = emptyScan();

  if (type === "aadhaar") {
    const a = findAadhaar(text);
    if (!a.number && !a.name && !a.birthYear && !a.address) return null;
    r.number = a.number;
    r.name = a.name;
    r.birthYear = a.birthYear;
    r.gender = a.gender;
    r.address = a.address;
    return r;
  }

  r.number = type === "pan" ? findPAN(text) : type === "voter_id" ? findEPIC(text) : findDL(text);
  r.name = findLabelledName(lines) || (type === "pan" ? unlabelledPANName(lines) : "");
  r.birthYear = findBirthYear(lines);
  if (type !== "pan") {
    r.gender = findGender(text);
    r.address = findAddress(lines);
  }

  // PAN requires the PAN number to avoid false positives on random text
  if (type === "pan" && !r.number) return null;

  const hasUsefulDetails = !!(r.number || (r.name && r.birthYear) || (r.name && r.address));
  if (!hasUsefulDetails) return null;
  return r;
}

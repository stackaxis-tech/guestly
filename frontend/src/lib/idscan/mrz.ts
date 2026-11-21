import { nationalityFromICAO } from "./countries";
import { asDigits, asLetters, birthYearFrom2, emptyScan, titleCase, type ScanResult } from "./types";

/*
 * Passport machine-readable zone (ICAO 9303, TD3): two lines of 44 characters.
 *   P<INDSHARMA<<RAHUL<KUMAR<<<<<<<<<<<<<<<<<<<<
 *   J8369854<4IND9001158M3201012<<<<<<<<<<<<<<<6
 * Line 2: number(9) check, nationality(3), birth YYMMDD check, sex, expiry YYMMDD check, …
 * Check digits let us reject misreads instead of filling in wrong details.
 */

const LEN = 44;

function charValue(c: string): number {
  if (c >= "0" && c <= "9") return c.charCodeAt(0) - 48;
  if (c >= "A" && c <= "Z") return c.charCodeAt(0) - 55;
  return 0; // "<"
}

export function checkDigit(s: string): number {
  const w = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum += charValue(s[i]!) * w[i % 3]!;
  return sum % 10;
}

/** Normalises one OCR line to MRZ characters. */
export function cleanLine(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/«/g, "<<")
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9<]/g, "<");
}

const validDate = (yymmdd: string) => {
  if (!/^\d{6}$/.test(yymmdd)) return false;
  const m = Number(yymmdd.slice(2, 4));
  const d = Number(yymmdd.slice(4, 6));
  return m >= 1 && m <= 12 && d >= 1 && d <= 31;
};

// What OCR may have meant, closest look-alike first (OCR often reads J as 1).
const LOOKALIKES: Record<string, string[]> = {
  "0": ["O", "D", "Q"], O: ["0", "D", "Q"], D: ["0", "O"], Q: ["0", "O"],
  "1": ["I", "J", "L", "T"], I: ["1", "J", "L"], J: ["1", "I"], L: ["1", "I"], T: ["1", "7"], "7": ["T"],
  "5": ["S"], S: ["5"], "8": ["B"], B: ["8"], "2": ["Z"], Z: ["2"], "6": ["G"], G: ["6"],
};

/**
 * The passport number, repaired for look-alike characters so the check digit
 * matches. The check digit alone can't tell some repairs apart, so the closest
 * repair wins only if it's the single best; a tie leaves the number empty.
 */
function documentNumber(raw: string, check: number, nationality: string): string {
  // Indian passports: one letter then seven digits.
  const shape = nationality === "IND" ? /^[A-Z][0-9]{7}<$/ : /^[A-Z0-9<]{9}$/;
  const spots = [...raw].map((c, i) => (LOOKALIKES[c] ? i : -1)).filter((i) => i >= 0).slice(0, 6);
  let best = "";
  let bestCost = Infinity;
  let tied = false;
  const walk = (k: number, chars: string[], cost: number) => {
    if (cost > bestCost) return;
    if (k === spots.length) {
      const candidate = chars.join("");
      if (!shape.test(candidate) || checkDigit(candidate) !== check) return;
      if (cost < bestCost) [best, bestCost, tied] = [candidate, cost, false];
      else if (candidate !== best) tied = true;
      return;
    }
    const pos = spots[k]!;
    const original = raw[pos]!;
    [original, ...LOOKALIKES[original]!].forEach((c, rank) => {
      chars[pos] = c;
      walk(k + 1, chars, cost + rank);
    });
    chars[pos] = original;
  };
  walk(0, [...raw], 0);
  return best && !tied ? best.replace(/<+$/, "") : "";
}

type Line2 = { number: string; nationality: string; birth: string; sex: string; expiry: string };

function parseLine2(line: string): Line2 | null {
  // OCR can add or drop a character; try every 44-character window and pad short lines.
  const padded = line.length < LEN ? line.padEnd(LEN, "<") : line;
  for (let start = 0; start + LEN <= padded.length; start++) {
    const l = padded.slice(start, start + LEN);
    const birth = asDigits(l.slice(13, 19));
    const birthCheck = Number(asDigits(l[19]!));
    const expiry = asDigits(l.slice(21, 27));
    const expiryCheck = Number(asDigits(l[27]!));
    if (!validDate(birth) || !validDate(expiry)) continue;
    if (checkDigit(birth) !== birthCheck || checkDigit(expiry) !== expiryCheck) continue;
    const nationality = asLetters(l.slice(10, 13));
    const docCheck = Number(asDigits(l[9]!));
    return {
      number: Number.isNaN(docCheck) ? "" : documentNumber(l.slice(0, 9), docCheck, nationality),
      nationality,
      birth,
      sex: asLetters(l[20]!),
      expiry,
    };
  }
  return null;
}

/** Name from line 1: "P<IND" + SURNAME<<GIVEN<NAMES<<<. */
function parseName(line: string): string {
  let names = line.padEnd(LEN, "<").slice(5, LEN);
  // OCR reads long "<<<<" tails as K, C or E; drop a tail of those that includes a "<".
  names = names.replace(/[<KCE]{4,}$/, (m) => (m.includes("<") ? "" : m)).replace(/<+$/, "");
  names = asLetters(names).replace(/[^A-Z<]/g, "");
  const [surname = "", ...given] = names.split("<<");
  const full = `${given.join(" ")} ${surname}`.replace(/</g, " ");
  return /[A-Z]{2}/.test(full) ? titleCase(full) : "";
}

const GENDER: Record<string, ScanResult["gender"]> = { M: "male", F: "female", X: "other" };

/** Reads a passport MRZ from OCR text. Returns null unless the dates' check digits match. */
export function parseMRZ(text: string): ScanResult | null {
  const lines = text.split(/\r?\n/).map(cleanLine).filter((l) => l.length >= 30);
  for (let i = 0; i < lines.length; i++) {
    const l2 = parseLine2(lines[i]!);
    if (!l2) continue;
    const r = emptyScan();
    const l1 = lines[i - 1];
    if (l1 && /^P/.test(l1)) r.name = parseName(l1);
    r.number = l2.number;
    r.nationality = nationalityFromICAO(l2.nationality);
    r.birthYear = birthYearFrom2(Number(l2.birth.slice(0, 2)));
    r.gender = GENDER[l2.sex] ?? "";
    r.expiry = `20${l2.expiry.slice(0, 2)}-${l2.expiry.slice(2, 4)}-${l2.expiry.slice(4, 6)}`;
    return r;
  }
  return null;
}

/** Fallback passport text parser when MRZ is obscured or cropped. */
export function parsePassportText(text: string): ScanResult | null {
  const r = emptyScan();

  // Standard Indian / International Passport Number: 1 uppercase letter + 7 digits
  const passMatch = /\b([A-PR-WYZ][1-9]\d{7})\b/i.exec(text) ||
                    /(?:Passport\s*No|Passport\s*Number)\s*[:.\-]?\s*([A-Z0-9]{8,9})/i.exec(text);
  if (passMatch) {
    r.number = passMatch[1]!.toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  // Name from Given Name / Surname
  const surnameMatch = /Surname\s*[:.\-]?\s*([A-Za-z ]+)/i.exec(text);
  const givenMatch = /Given\s*Name[s]?\s*[:.\-]?\s*([A-Za-z ]+)/i.exec(text);
  if (givenMatch || surnameMatch) {
    const given = givenMatch ? givenMatch[1]!.trim() : "";
    const surname = surnameMatch ? surnameMatch[1]!.trim() : "";
    const full = `${given} ${surname}`.trim();
    if (full.length >= 3) r.name = titleCase(full);
  } else {
    const nameMatch = /(?:Name|Full\s*Name)\s*[:.\-]?\s*([A-Za-z ]+)/i.exec(text);
    if (nameMatch) {
      const clean = nameMatch[1]!.replace(/[^A-Za-z ]/g, "").trim();
      if (clean.length >= 3) r.name = titleCase(clean);
    }
  }

  // Date of birth
  const dobMatch = /(?:Date\s*of\s*Birth|DOB)\s*[:.\-]?\s*(\d{2})[/-](\d{2})[/-]((?:19|20)\d{2})/i.exec(text);
  if (dobMatch) {
    r.birthYear = Number(dobMatch[3]);
  }

  // Sex
  const sexMatch = /(?:Sex|Gender)\s*[:.\-]?\s*([MF])/i.exec(text);
  if (sexMatch) {
    r.gender = sexMatch[1]!.toUpperCase() === "F" ? "female" : "male";
  }

  // Nationality
  if (/IND|INDIAN|INDIA/i.test(text)) {
    r.nationality = "IN";
  }

  // Expiry date
  const expMatch = /(?:Date\s*of\s*Expiry|Expiry\s*Date|Valid\s*Until)\s*[:.\-]?\s*(\d{2})[/-](\d{2})[/-]((?:19|20)\d{2})/i.exec(text);
  if (expMatch) {
    r.expiry = `${expMatch[3]}-${expMatch[2]}-${expMatch[1]}`;
  }

  if (r.number || (r.name && r.birthYear)) return r;
  return null;
}

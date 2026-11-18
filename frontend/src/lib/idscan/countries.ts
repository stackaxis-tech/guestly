// ICAO 9303 three-letter codes for the countries in the nationality list
// (COUNTRIES in lib/stays.ts; keep the two in step). Germany is "D" in
// passports, padded to "D<<". Kept import-free so the parsers test in Node.
const ISO3: Record<string, string> = {
  IND: "IN", USA: "US", GBR: "GB", ARE: "AE", SAU: "SA", QAT: "QA", OMN: "OM", KWT: "KW", BHR: "BH",
  D: "DE", DEU: "DE", FRA: "FR", ITA: "IT", ESP: "ES", NLD: "NL", RUS: "RU", ISR: "IL", AUS: "AU", NZL: "NZ",
  CAN: "CA", SGP: "SG", MYS: "MY", JPN: "JP", CHN: "CN", KOR: "KR", LKA: "LK", MDV: "MV", NPL: "NP", BGD: "BD",
};

/** Maps a passport nationality code to the nationality list, "OT" (Other) if it isn't listed. */
export function nationalityFromICAO(code: string): string {
  return ISO3[code.replace(/</g, "")] ?? "OT";
}

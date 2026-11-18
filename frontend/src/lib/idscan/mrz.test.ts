import { describe, expect, it } from "vitest";
import { checkDigit, parseMRZ } from "./mrz";

// Made-up people and numbers only.
function line2(num: string, nat: string, dob: string, sex: string, exp: string) {
  const n = num.padEnd(9, "<");
  const personal = "<".repeat(14);
  const body = n + checkDigit(n) + nat + dob + checkDigit(dob) + sex + exp + checkDigit(exp) + personal + checkDigit(personal);
  const composite = n + checkDigit(n) + dob + checkDigit(dob) + exp + checkDigit(exp) + personal + checkDigit(personal);
  return body + checkDigit(composite);
}
const line1 = (nat: string, names: string) => `P<${nat}${names}`.padEnd(44, "<");

describe("parseMRZ", () => {
  it("reads a clean Indian passport", () => {
    const l2 = line2("J8369854", "IND", "900115", "M", "320101");
    expect(l2).toHaveLength(44);
    const r = parseMRZ(`REPUBLIC OF INDIA\n${line1("IND", "SHARMA<<RAHUL<KUMAR")}\n${l2}\n`);
    expect(r).toMatchObject({ name: "Rahul Kumar Sharma", number: "J8369854", nationality: "IN", birthYear: 1990, gender: "male", expiry: "2032-01-01" });
  });

  it("fixes typical OCR misreads using the check digits", () => {
    const l2 = line2("J8369854", "IND", "900115", "F", "320101")
      .replace("J8369854", "J83698S4") // 5 read as S
      .replace("900115", "9OO115"); // 0 read as O
    const l1 = "P<INDSHARMA<<RAHUL<KUMAR<<<KKKK<K<<KKKK<<KKK";
    const r = parseMRZ(`${l1.replace(/</g, " <").slice(0, 60)}\n x${l2}`); // stray spaces + an extra leading character
    expect(r).toMatchObject({ number: "J8369854", birthYear: 1990, gender: "female", nationality: "IN" });
    expect(r?.name).toBe("Rahul Kumar Sharma");
  });

  it("repairs a leading J read as 1, as Tesseract did on a test photo", () => {
    // Real OCR output from a rendered photo page: J → 1, and the filler run cut short.
    const r = parseMRZ("P<INDSHARMA<<RAHUL<KUMAR<<<<<<<<<<<<<<\n18369854<4IND9001158M3201015<<<<<<<<<<<<<<08\n");
    expect(r).toMatchObject({ name: "Rahul Kumar Sharma", number: "J8369854", birthYear: 1990 });
  });

  it("reads foreign passports and maps the nationality", () => {
    const us = parseMRZ(`${line1("USA", "SMITH<<JANE<ANN")}\n${line2("X1234567", "USA", "851231", "F", "300615")}`);
    expect(us).toMatchObject({ name: "Jane Ann Smith", nationality: "US", birthYear: 1985, gender: "female" });
    const de = parseMRZ(`${line1("D<<", "MULLER<<ANNA")}\n${line2("C01X00T47", "D<<", "020304", "<", "290101")}`);
    expect(de).toMatchObject({ name: "Anna Muller", nationality: "DE", birthYear: 2002, gender: "" });
    const other = parseMRZ(line2("AB1234567", "BRA", "700101", "M", "280101"));
    expect(other).toMatchObject({ nationality: "OT", name: "" });
  });

  it("rejects text whose check digits don't match", () => {
    const l2 = line2("J8369854", "IND", "900115", "M", "320101");
    const broken = l2.slice(0, 13) + "900116" + l2.slice(19); // birth date changed, check digit not
    expect(parseMRZ(`${line1("IND", "SHARMA<<RAHUL")}\n${broken}`)).toBeNull();
    expect(parseMRZ("REPUBLIC OF INDIA\nPASSPORT\n")).toBeNull();
  });

  it("leaves the number empty when it can't be verified", () => {
    const l2 = line2("J8369854", "IND", "900115", "M", "320101");
    const r = parseMRZ(l2.slice(0, 2) + "7" + l2.slice(3)); // 8 → 7 has no look-alike fix
    expect(r?.number).toBe("");
    expect(r?.birthYear).toBe(1990);
  });
});

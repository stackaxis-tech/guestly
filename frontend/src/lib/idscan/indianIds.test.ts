import { describe, expect, it } from "vitest";
import { cleanName, findDL, findEPIC, findPAN, parseIndianId } from "./indianIds";

// Made-up people and numbers only. The text mimics English OCR of bilingual
// cards: Hindi comes out as junk, and look-alike characters get swapped.

describe("PAN", () => {
  it("reads the current card layout", () => {
    const text = `amar fawn INCOME TAX DEPARTMENT
Wa WIR GOVT. OF INDIA
Permanent Account Number Card
ABCPE1234F
ATH / Name
RAHUL KUMAR SHARMA
fet aT ATH / Father's Name
SURESH KUMAR SHARMA
SFA Ft aTY / Date of Birth
15/08/1990`;
    expect(parseIndianId("pan", text)).toMatchObject({ number: "ABCPE1234F", name: "Rahul Kumar Sharma", birthYear: 1990, gender: "", address: "" });
  });

  it("reads the older unlabelled layout", () => {
    const text = `INCOME TAX DEPARTMENT GOVT. OF INDIA
RAHUL KUMAR SHARMA
SURESH KUMAR SHARMA
15/08/1990
Permanent Account Number
ABCPE1234F
Signature`;
    expect(parseIndianId("pan", text)).toMatchObject({ number: "ABCPE1234F", name: "Rahul Kumar Sharma", birthYear: 1990 });
  });

  it("finds the name when OCR drops the small Name label", () => {
    // Real OCR output from a rendered card.
    const text = "INCOME TAX DEPARTMENT GOVT. OF INDIA\nPermanent Account Number Card\n\nABCPE1234F\nRAHUL KUMAR SHARMA\n\nFather's Name\n\nSURESH KUMAR SHARMA\n\nDate of Birth\n\n15/08/1990\n";
    expect(parseIndianId("pan", text)).toMatchObject({ number: "ABCPE1234F", name: "Rahul Kumar Sharma", birthYear: 1990 });
  });

  it("repairs a split number with look-alike characters", () => {
    expect(findPAN("PAN: ABCPE I234F")).toBe("ABCPE1234F");
    expect(findPAN("A8CPE 1234F")).toBe("ABCPE1234F");
    expect(findPAN("ABCDE1234F")).toBe(""); // D isn't a valid holder type
  });
});

describe("Voter ID", () => {
  it("reads the front and the back", () => {
    const front = `ELECTION COMMISSION OF INDIA
IDENTITY CARD
ABC1234567
Elector's Name : Priya Nair
Father's Name : Mohan Nair
Sex : Female
Date of Birth : 01/02/1985`;
    expect(parseIndianId("voter_id", front)).toMatchObject({ number: "ABC1234567", name: "Priya Nair", gender: "female", birthYear: 1985 });

    const back = `ABC 1234567
Address : 12A Marine Road, Fort Kochi,
Ernakulam, Kerala 682001
Date : 01/01/2015
Electoral Registration Officer`;
    expect(parseIndianId("voter_id", back)).toMatchObject({ number: "ABC1234567", address: "12A Marine Road, Fort Kochi, Ernakulam, Kerala 682001" });
  });

  it("fixes O/0 swaps in the number", () => {
    expect(findEPIC("ABCI234S67")).toBe("ABC1234567");
    expect(findEPIC("A812345678")).toBe(""); // two letters repaired: too many to trust
    expect(findEPIC("9847012345")).toBe(""); // a phone number
  });
});

describe("Driving licence", () => {
  it("reads a smart-card licence", () => {
    const text = `Indian Union Driving Licence
Issued by Government of Kerala
KL07 20150001234
Name : ANIL THOMAS
S/D/W of : THOMAS JOSEPH
DOB : 12-03-1988
Issue Date : 05-06-2015
Valid Till : 11-03-2038
Address : House No 5, MG Road, Kochi, Kerala 682016`;
    expect(parseIndianId("driving_licence", text)).toMatchObject({
      number: "KL0720150001234",
      name: "Anil Thomas",
      birthYear: 1988,
      address: "House No 5, MG Road, Kochi, Kerala 682016",
    });
  });

  it("uses the earliest date when DOB isn't labelled, and fixes the number", () => {
    const text = `KLO7 2O15OOO1234\nANIL THOMAS\n05-06-2015\n12-03-1988\n11-03-2038`;
    expect(parseIndianId("driving_licence", text)).toMatchObject({ number: "KL0720150001234", birthYear: 1988, name: "" });
  });

  it("ignores dates and unknown state codes", () => {
    expect(findDL("DOB 12-03-1988 Issue 05-06-2015")).toBe("");
    expect(findDL("XY07 20150001234")).toBe("");
    expect(findDL("MH-12 2011 0012345")).toBe("MH1220110012345");
  });
});

describe("cleanName", () => {
  it("rejects noise and labels", () => {
    expect(cleanName(": ANIL  THOMAS.")).toBe("Anil Thomas");
    expect(cleanName("4|| ;; ~")).toBe("");
    expect(cleanName("Date of Birth")).toBe("");
    expect(cleanName("A K")).toBe("");
    expect(cleanName("A K SHARMA")).toBe("A K Sharma");
  });

  it("returns null without an ID number", () => {
    expect(parseIndianId("pan", "Name\nRAHUL KUMAR SHARMA")).toBeNull();
  });
});

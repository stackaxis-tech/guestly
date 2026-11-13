package stay

import (
	"testing"
	"time"

	"github.com/guestly/backend/internal/property"
	"github.com/guestly/backend/internal/secure"
)

func TestRoomRate(t *testing.T) {
	cfg := TaxConfig{Registered: true, RoomThreshold: 750000, RoomLowBP: 500, RoomHighBP: 1800}
	if got := cfg.RoomRateBP(350000); got != 500 {
		t.Errorf("₹3,500 → %d, want 500", got)
	}
	if got := cfg.RoomRateBP(750000); got != 500 {
		t.Errorf("₹7,500 (threshold inclusive) → %d, want 500", got)
	}
	if got := cfg.RoomRateBP(750100); got != 1800 {
		t.Errorf("₹7,501 → %d, want 1800", got)
	}
	if got := (TaxConfig{}).RoomRateBP(350000); got != 0 {
		t.Errorf("unregistered → %d, want 0", got)
	}
}

func TestBill(t *testing.T) {
	room := MakeLine("Room 101 × 2 nights", 2, 350000, 500) // ₹7,000 + 5%
	if room.Taxable != 700000 || room.CGST != 17500 || room.SGST != 17500 || room.Total != 735000 {
		t.Fatalf("room line = %+v", room)
	}
	odd := MakeLine("Tea", 1, 333, 500) // ₹3.33 → 2.5% = 8.325p → 8p each half
	if odd.CGST != odd.SGST || odd.CGST != 8 {
		t.Fatalf("odd line = %+v", odd)
	}
	b := Summarize([]Line{room, odd}, 500000, 2, false)
	if b.Total != 735000+333+16 || b.Balance != b.Total-500000 {
		t.Fatalf("bill = %+v", b)
	}
}

func TestNights(t *testing.T) {
	ist := time.FixedZone("IST", 19800)
	at := func(s string) time.Time {
		v, err := time.ParseInLocation("2006-01-02 15:04", s, ist)
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	cases := []struct {
		in, out string
		want    int
	}{
		{"2026-11-03 14:00", "2026-11-04 11:00", 1},
		{"2026-11-03 14:00", "2026-11-05 11:00", 2},
		{"2026-11-03 14:00", "2026-11-03 20:00", 1}, // same-day stay is still one night
		{"2026-11-03 23:50", "2026-11-04 00:10", 1},
	}
	for _, c := range cases {
		if got := Nights(at(c.in), at(c.out), ist); got != c.want {
			t.Errorf("%s → %s = %d, want %d", c.in, c.out, got, c.want)
		}
	}
}

func TestNormalizePhone(t *testing.T) {
	for in, want := range map[string]string{
		"98470 12345":     "+919847012345",
		"098470-12345":    "+919847012345",
		"+91 98470 12345": "+919847012345",
		"919847012345":    "+919847012345",
		"+44 7911 123456": "+447911123456",
		"12345":           "",
		"4847012345":      "", // Indian mobiles start 6-9
		"":                "",
	} {
		if got := NormalizePhone(in); got != want {
			t.Errorf("NormalizePhone(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestAadhaar(t *testing.T) {
	// 234123412346 is a commonly used Verhoeff-valid test number.
	if !ValidAadhaar("234123412346") {
		t.Error("valid test number rejected")
	}
	for _, bad := range []string{"234123412345", "123412341234", "23412341234", "abcdabcdabcd"} {
		if ValidAadhaar(bad) {
			t.Errorf("%s accepted", bad)
		}
	}
}

func TestSecureRoundTrip(t *testing.T) {
	box, err := secure.New("", true)
	if err != nil {
		t.Fatal(err)
	}
	sealed := box.SealString("P1234567")
	if string(sealed) == "P1234567" {
		t.Fatal("not encrypted")
	}
	if got, _ := box.OpenString(sealed); got != "P1234567" {
		t.Fatalf("round trip = %q", got)
	}
	sealed[len(sealed)-1] ^= 1
	if _, err := box.OpenString(sealed); err == nil {
		t.Fatal("tampering not detected")
	}
	if _, err := secure.New("", false); err == nil {
		t.Fatal("production without DATA_KEY should fail")
	}
}

func TestRender(t *testing.T) {
	body := "Hi {guest_name}!\n\nRoom: {room}\nWi-Fi: {wifi_name}\nPassword: {wifi_password}\n\nCall {hotel_phone}"
	got := Render(body, map[string]string{"guest_name": "Priya", "room": "203", "hotel_phone": "+91 1", "wifi_name": "", "wifi_password": ""})
	want := "Hi Priya!\n\nRoom: 203\n\nCall +91 1"
	if got != want {
		t.Errorf("Render =\n%q\nwant\n%q", got, want)
	}
	if got := Render("Keep {unknown} as is", nil); got != "Keep {unknown} as is" {
		t.Errorf("unknown var: %q", got)
	}
}

func TestRupeeText(t *testing.T) {
	for in, want := range map[int64]string{0: "₹0", 89900: "₹899", 12345600: "₹1,23,456", 735005: "₹7,350.05", 100000000: "₹10,00,000"} {
		if got := rupeeText(in); got != want {
			t.Errorf("rupeeText(%d) = %s, want %s", in, got, want)
		}
	}
}

func TestReservationValidate(t *testing.T) {
	today := time.Date(2026, 11, 9, 0, 0, 0, 0, time.UTC)
	good := func() reservationInput {
		return reservationInput{GuestName: "  Test   Guest ", GuestPhone: "98470 55555", CheckIn: "2026-11-10", CheckOut: "2026-11-12", Adults: 2, NightlyRate: 350000}
	}
	in := good()
	if f := in.validate(today); len(f) != 0 {
		t.Fatalf("valid booking rejected: %v", f)
	}
	if in.GuestName != "Test Guest" || in.GuestPhone != "+919847055555" {
		t.Fatalf("not normalized: %+v", in)
	}
	cases := []struct {
		field string
		edit  func(*reservationInput)
	}{
		{"checkIn", func(r *reservationInput) { r.CheckIn = "2026-11-08" }},
		{"checkOut", func(r *reservationInput) { r.CheckOut = r.CheckIn }},
		{"checkOut", func(r *reservationInput) { r.CheckOut = "2027-06-30" }},
		{"guestPhone", func(r *reservationInput) { r.GuestPhone = "123" }},
		{"guestName", func(r *reservationInput) { r.GuestName = " " }},
		{"adults", func(r *reservationInput) { r.Adults = 0 }},
		{"advanceMode", func(r *reservationInput) { r.AdvanceAmount = 100 }},
	}
	for _, c := range cases {
		in := good()
		c.edit(&in)
		if f := in.validate(today); f[c.field] == "" {
			t.Errorf("expected %s error, got %v", c.field, f)
		}
	}
}

func TestStayRange(t *testing.T) {
	ist := time.FixedZone("IST", 19800)
	a := time.Date(2026, 11, 9, 14, 0, 0, 0, ist)
	if from, to := stayRange(a, a.Add(2*time.Hour)); from != "2026-11-09" || to != "2026-11-10" {
		t.Errorf("same-day stay = %s..%s", from, to)
	}
	if from, to := stayRange(a, a.AddDate(0, 0, 2)); from != "2026-11-09" || to != "2026-11-11" {
		t.Errorf("two nights = %s..%s", from, to)
	}
}

func TestMakeLineSampleBill(t *testing.T) {
	// ₹2,566.67 room at 2.5% + 2.5% → 64.17 each side, ₹2,695.01 in all.
	l := MakeLine("Room", 1, 256667, 500)
	if l.CGST != 6417 || l.SGST != 6417 || l.Total != 269501 {
		t.Fatalf("line = %+v", l)
	}
}

func TestRupeesInWords(t *testing.T) {
	for in, want := range map[int64]string{
		0:          "RUPEES ZERO ONLY",
		269500:     "RUPEES TWO THOUSAND SIX HUNDRED NINETY-FIVE ONLY",
		269501:     "RUPEES TWO THOUSAND SIX HUNDRED NINETY-FIVE AND ONE PAISE ONLY",
		10000000:   "RUPEES ONE LAKH ONLY",
		1234567800: "RUPEES ONE CRORE TWENTY-THREE LAKH FORTY-FIVE THOUSAND SIX HUNDRED SEVENTY-EIGHT ONLY",
		1900:       "RUPEES NINETEEN ONLY",
		10050:      "RUPEES ONE HUNDRED AND FIFTY PAISE ONLY",
	} {
		if got := rupeesInWords(in); got != want {
			t.Errorf("rupeesInWords(%d) = %q, want %q", in, got, want)
		}
	}
}

func TestFinancialYearAndNumber(t *testing.T) {
	ist := time.FixedZone("IST", 19800)
	for in, want := range map[time.Time]string{
		time.Date(2026, 3, 31, 23, 0, 0, 0, ist):  "25-26",
		time.Date(2026, 4, 1, 0, 30, 0, 0, ist):   "26-27",
		time.Date(2026, 11, 13, 10, 0, 0, 0, ist): "26-27",
		time.Date(2027, 3, 31, 12, 0, 0, 0, ist):  "26-27",
	} {
		if got := financialYear(in); got != want {
			t.Errorf("financialYear(%v) = %s, want %s", in, got, want)
		}
	}
	if n := invoiceNumber("INV", "26-27", 7); n != "INV/26-27/0007" || len(n) > 16 {
		t.Errorf("number = %s", n)
	}
}

func TestSAC(t *testing.T) {
	for in, want := range map[string]string{"Breakfast": "996331", "Extra bed": "996311", "Laundry": "9997", "Airport pickup": "9964", "Spa": "9963"} {
		if got := sacFor(in); got != want {
			t.Errorf("sacFor(%q) = %s, want %s", in, got, want)
		}
	}
}

func TestBuildInvoiceDoc(t *testing.T) {
	prop := property.Property{Name: "Lakeview", Address: "NH Bypass", City: "Kochi", State: "Kerala", Pincode: "682040", GSTIN: "32AAHCA8583E1ZO"}
	prop.FrontDesk.GSTRegistered = true
	prop.FrontDesk.LegalName = "Lakeview Builders Pvt Ltd"
	room := MakeLine("Room 208 · Deluxe · 1 night", 1, 256667, 500)
	tea := MakeLine("Tea", 2, 5000, 500)
	out := time.Date(2026, 10, 28, 10, 46, 0, 0, time.UTC)
	d := StayDetail{
		FoodPlan: "EP",
		BillTo:   BillTo{Name: "Agoda Company Pte Ltd", GSTIN: "32AAHCA8583E1ZO"},
		Bill:     Summarize([]Line{room, tea}, 0, 1, false),
	}
	d.Guest.Name = "Budhan Murali"
	d.RoomNumber = "208"
	d.CheckedOutAt = &out
	doc := buildInvoiceDoc(d, prop)
	if doc.Title != "TAX INVOICE" || doc.Seller.LegalName != "Lakeview Builders Pvt Ltd" || doc.Seller.StateCode != "32" {
		t.Errorf("header = %+v", doc)
	}
	if doc.BillTo.Name != "Agoda Company Pte Ltd" || doc.GuestName != "Budhan Murali" {
		t.Errorf("bill-to = %+v", doc.BillTo)
	}
	if len(doc.Lines) != 2 || doc.Lines[0].SAC != "996311" || len(doc.TaxSummary) != 1 {
		t.Fatalf("lines = %+v summary = %+v", doc.Lines, doc.TaxSummary)
	}
	if doc.Total != doc.Taxable+doc.CGST+doc.SGST || doc.TaxSummary[0].Taxable != doc.Taxable {
		t.Errorf("totals don't add up: %+v", doc)
	}
	// Not registered: no tax, and it says Bill of Supply.
	prop.FrontDesk.GSTRegistered = false
	if got := buildInvoiceDoc(d, prop); got.Title != "BILL OF SUPPLY" || got.Seller.GSTIN != "" {
		t.Errorf("unregistered = %+v", got.Seller)
	}
}

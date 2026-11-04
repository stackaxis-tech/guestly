package stay

import (
	"testing"
	"time"

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

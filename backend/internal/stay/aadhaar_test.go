package stay

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"image"
	"image/draw"
	"image/jpeg"
	"math/big"
	"math/rand"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/makiuchi-d/gozxing"
	"github.com/makiuchi-d/gozxing/qrcode"

	"github.com/guestly/backend/internal/httpx"
)

// All fixtures use made-up people and numbers.
func secureQR(t *testing.T, version string, photo []byte) string {
	t.Helper()
	fields := []string{"3", "234620261109101010123", "Test Person", "15-08-1990", "F", "C/O Sample Parent",
		"Ernakulam", "Near Temple", "12A", "Fort Kochi", "682001", "Fort Kochi", "Kerala", "Marine Road", "Kochi", "Kochi"}
	if version != "" {
		fields = append([]string{version}, fields...)
	}
	var raw bytes.Buffer
	raw.WriteString(strings.Join(fields, "\xff"))
	raw.WriteByte(0xFF)
	raw.Write(photo)
	var gz bytes.Buffer
	zw, _ := gzip.NewWriterLevel(&gz, gzip.BestCompression)
	zw.Write(raw.Bytes())
	zw.Close()
	return new(big.Int).SetBytes(gz.Bytes()).String()
}

func checkSecure(t *testing.T, d AadhaarDetails) {
	t.Helper()
	if d.Name != "Test Person" || d.Gender != "female" || d.Last4 != "2346" || d.BirthYear == nil || *d.BirthYear != 1990 {
		t.Fatalf("details = %+v", d)
	}
	want := "12A, Marine Road, Near Temple, Fort Kochi, Kochi, Ernakulam, Kerala, 682001"
	if d.Address != want {
		t.Fatalf("address = %q, want %q", d.Address, want)
	}
}

func TestParseSecureQR(t *testing.T) {
	for _, v := range []string{"", "V2", "V5"} {
		d, err := ParseAadhaarQR(secureQR(t, v, []byte{0xFF, 0x01, 0xFF, 0x02}))
		if err != nil {
			t.Fatalf("version %q: %v", v, err)
		}
		checkSecure(t, d)
	}
}

func TestParseOldXML(t *testing.T) {
	full := "234123412346"
	q := `<?xml version="1.0" encoding="UTF-8"?><PrintLetterBarcodeData uid="` + full + `" name="Old Format" gender="MALE" yob="1985" house="4" street="Main St" vtc="Aluva" dist="Ernakulam" state="Kerala" pc="683101"/>`
	d, err := ParseAadhaarQR(q)
	if err != nil {
		t.Fatal(err)
	}
	if d.Name != "Old Format" || d.Gender != "male" || d.Last4 != "2346" || d.BirthYear == nil || *d.BirthYear != 1985 {
		t.Fatalf("details = %+v", d)
	}
	b, _ := json.Marshal(d)
	if strings.Contains(string(b), full) || strings.Contains(string(b), "23412341") {
		t.Fatalf("full Aadhaar number leaked: %s", b)
	}
}

func TestParseRejectsOtherContent(t *testing.T) {
	for _, s := range []string{"", "https://example.com", "12345", "<a/>", "<root", new(big.Int).SetBytes([]byte("not gzip data")).String()} {
		if d, err := ParseAadhaarQR(s); err == nil {
			t.Errorf("%q parsed as %+v", s, d)
		}
	}
}

// Real QRs differ in their leading fields. Each layout must still put the name,
// DOB and gender in the right place, and never shift the DOB into the name.
func TestParseSecureQRLayoutVariants(t *testing.T) {
	addr := []string{"C/O Sample Parent", "Ernakulam", "Near Temple", "12A", "Fort Kochi", "682001", "Fort Kochi", "Kerala", "Marine Road", "Kochi", "Kochi"}
	build := func(lead ...string) []string {
		return append(append(lead, "Test Person", "15/08/1990", "FEMALE"), addr...)
	}
	for name, f := range map[string][]string{
		"no indicator":         build("234620261109101010123"),
		"indicator":            build("3", "234620261109101010123"),
		"version + indicator":  build("V2", "3", "234620261109101010123"),
		"unknown extra field":  build("v3", "X", "3", "234620261109101010123"),
		"V2 with mobile last4": append(build("V2", "3", "234620261109101010123"), "1234"),
	} {
		d, err := secureFields(f)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		checkSecure(t, d)
	}

	// Unknown address layout: keep the person, drop the address instead of jumbling it.
	f := append(build("3", "234620261109101010123")[:7], "Kerala", "not-a-pin")
	d, err := secureFields(f)
	if err != nil || d.Name != "Test Person" || d.Address != "" {
		t.Fatalf("partial layout: %+v, %v", d, err)
	}

	// No recognisable DOB + gender pair: refuse rather than guess.
	if _, err := secureFields([]string{"3", "2346", "15-08-1990", "Test Person", "F"}); err == nil {
		t.Fatal("expected an error when the name position can't be confirmed")
	}
}

func renderQR(t *testing.T, text string, size int) image.Image {
	t.Helper()
	m, err := qrcode.NewQRCodeWriter().Encode(text, gozxing.BarcodeFormat_QR_CODE, size, size, nil)
	if err != nil {
		t.Fatal(err)
	}
	return m
}

// onCard pastes the QR on a larger pale background and re-encodes it as JPEG, like a photo.
func onCard(t *testing.T, qr image.Image, quality int) image.Image {
	t.Helper()
	b := qr.Bounds()
	bg := image.NewRGBA(image.Rect(0, 0, b.Dx()*2, b.Dy()+200))
	draw.Draw(bg, bg.Bounds(), image.NewUniform(image.White), image.Point{}, draw.Src)
	draw.Draw(bg, b.Add(image.Pt(b.Dx()/2, 100)), qr, b.Min, draw.Src)
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, bg, &jpeg.Options{Quality: quality}); err != nil {
		t.Fatal(err)
	}
	out, _, err := image.Decode(&buf)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestDecodeQRFromPhotoLikeImages(t *testing.T) {
	// Random bytes don't compress, so this makes a QR as dense as a real Secure QR.
	photo := make([]byte, 1800)
	rand.New(rand.NewSource(1)).Read(photo)
	text := secureQR(t, "V2", photo)
	t.Logf("QR holds %d digits", len(text))
	for _, c := range []struct {
		name    string
		size    int
		quality int
		rotate  bool
	}{
		{"sharp", 1400, 92, false},
		{"lower quality", 1400, 70, false},
		{"rotated", 1400, 92, true},
	} {
		t.Run(c.name, func(t *testing.T) {
			img := onCard(t, renderQR(t, text, c.size), c.quality)
			if c.rotate {
				img = rotate90(img)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			got, err := DecodeQR(ctx, img)
			if err != nil {
				t.Fatal(err)
			}
			d, err := ParseAadhaarQR(got)
			if err != nil {
				t.Fatal(err)
			}
			checkSecure(t, d)
		})
	}
}

func TestDecodeQRNoCode(t *testing.T) {
	blank := image.NewGray(image.Rect(0, 0, 400, 300))
	if _, err := DecodeQR(context.Background(), blank); err == nil {
		t.Fatal("expected no QR found")
	}
}

func TestParseAadhaarEndpoint(t *testing.T) {
	h := &Handler{}
	post := func(body string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		r := httptest.NewRequest("POST", "/", strings.NewReader(body))
		if err := h.ParseAadhaar(w, r); err != nil {
			httpx.WriteError(w, r, err)
		}
		return w
	}

	text := secureQR(t, "V2", []byte{0x01})
	w := post(`{"text":"` + text + `"}`)
	if w.Code != 200 {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
	var d AadhaarDetails
	if err := json.Unmarshal(w.Body.Bytes(), &d); err != nil {
		t.Fatal(err)
	}
	checkSecure(t, d)

	for _, body := range []string{`{"text":"https://example.com"}`, `{"text":""}`, `{"text":"` + strings.Repeat("1", maxQRText+1) + `"}`} {
		if w := post(body); w.Code != 422 {
			t.Errorf("%.40s…: status %d, want 422", body, w.Code)
		}
	}
}

func TestPANNumber(t *testing.T) {
	for n, ok := range map[string]bool{"ABCPE1234F": true, "abcpe 1234f": true, "ABCDE1234F": false, "ABCP1234F": false, "": true} {
		f := map[string]string{}
		d := documentInput{Type: "pan", Number: n, FrontUploadID: "x"}
		d.normalize(f, "", "IN")
		if got := f["number"] == ""; got != ok {
			t.Errorf("%q: valid=%v, want %v (%v)", n, got, ok, f)
		}
	}
}

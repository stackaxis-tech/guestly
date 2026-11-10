package stay

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/xml"
	"errors"
	"image"
	"image/color"
	_ "image/jpeg" // decoders for image.Decode
	_ "image/png"
	"io"
	"math/big"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/makiuchi-d/gozxing"
	"github.com/makiuchi-d/gozxing/qrcode"

	"github.com/guestly/backend/internal/httpx"
	"github.com/guestly/backend/internal/storage"
)

// AadhaarDetails is what check-in can auto-fill from an Aadhaar QR code.
// It never carries more than the last four digits of the Aadhaar number, and
// the details are read from the QR, not verified against UIDAI.
type AadhaarDetails struct {
	Name      string `json:"name"`
	Gender    string `json:"gender"` // female | male | other | ""
	BirthYear *int   `json:"birthYear"`
	Address   string `json:"address"`
	Last4     string `json:"last4"`
}

var (
	errNotAadhaarQR = errors.New("not an Aadhaar QR code")
	digitsOnly      = regexp.MustCompile(`^[0-9]+$`)
	yearRe          = regexp.MustCompile(`(?:^|[^0-9])((?:19|20)[0-9]{2})(?:[^0-9]|$)`)
)

// ParseAadhaarQR understands both the Secure QR (a long decimal number holding
// gzipped, 0xFF-delimited fields) and the older XML QR printed on earlier cards.
func ParseAadhaarQR(text string) (AadhaarDetails, error) {
	text = strings.TrimSpace(text)
	switch {
	case digitsOnly.MatchString(text):
		return parseSecureQR(text)
	case strings.HasPrefix(text, "<"):
		return parseXMLQR(text)
	}
	return AadhaarDetails{}, errNotAadhaarQR
}

func parseSecureQR(digits string) (AadhaarDetails, error) {
	n, ok := new(big.Int).SetString(digits, 10)
	if !ok {
		return AadhaarDetails{}, errNotAadhaarQR
	}
	zr, err := gzip.NewReader(bytes.NewReader(n.Bytes()))
	if err != nil {
		return AadhaarDetails{}, errNotAadhaarQR
	}
	// The limit guards against decompression bombs; the text fields come first.
	data, err := io.ReadAll(io.LimitReader(zr, 1<<20))
	if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) {
		return AadhaarDetails{}, errNotAadhaarQR
	}
	// Only the leading fields are text; what follows is binary and may contain 0xFF.
	parts := bytes.SplitN(data, []byte{0xFF}, 20)
	f := make([]string, len(parts))
	for i, p := range parts {
		f[i] = strings.TrimSpace(string(p))
	}
	// Newer QRs start with a version field such as "V2".
	if len(f) > 0 && len(f[0]) >= 2 && f[0][0] == 'V' && digitsOnly.MatchString(f[0][1:]) {
		f = f[1:]
	}
	const (
		refID = 1
		name  = 2
		dob   = 3
		sex   = 4
		dist  = 6
		lm    = 7
		house = 8
		loc   = 9
		pin   = 10
		po    = 11
		state = 12
		st    = 13
		sub   = 14
		vtc   = 15
	)
	if len(f) <= vtc || f[name] == "" {
		return AadhaarDetails{}, errNotAadhaarQR
	}
	d := AadhaarDetails{
		Name:      f[name],
		Gender:    normalizeGender(f[sex]),
		BirthYear: birthYear(f[dob]),
		Address:   joinAddress(f[house], f[st], f[lm], f[loc], f[vtc], f[po], f[sub], f[dist], f[state], f[pin]),
	}
	// The reference ID begins with the last four digits of the Aadhaar number.
	if r := f[refID]; len(r) >= 4 && digitsOnly.MatchString(r[:4]) {
		d.Last4 = r[:4]
	}
	return d, nil
}

func parseXMLQR(text string) (AadhaarDetails, error) {
	dec := xml.NewDecoder(strings.NewReader(text))
	for {
		tok, err := dec.Token()
		if err != nil {
			return AadhaarDetails{}, errNotAadhaarQR
		}
		el, ok := tok.(xml.StartElement)
		if !ok {
			continue
		}
		a := map[string]string{}
		for _, at := range el.Attr {
			a[at.Name.Local] = strings.TrimSpace(at.Value)
		}
		first := func(keys ...string) string {
			for _, k := range keys {
				if a[k] != "" {
					return a[k]
				}
			}
			return ""
		}
		name, uid := first("name", "n"), nonDigits.ReplaceAllString(first("uid", "u"), "")
		if name == "" {
			return AadhaarDetails{}, errNotAadhaarQR
		}
		yob := first("yob", "y")
		if yob == "" {
			yob = first("dob", "d")
		}
		addr := first("a")
		if addr == "" {
			addr = joinAddress(a["house"], a["street"], a["lm"], a["loc"], a["vtc"], a["po"], a["subdist"], a["dist"], a["state"], a["pc"])
		}
		// Older QRs hold the full number. Only the last four digits ever leave this function.
		return AadhaarDetails{Name: name, Gender: normalizeGender(first("gender", "g")), BirthYear: birthYear(yob), Address: addr, Last4: last4(uid)}, nil
	}
}

func normalizeGender(g string) string {
	switch strings.ToUpper(strings.TrimSpace(g)) {
	case "F", "FEMALE":
		return "female"
	case "M", "MALE":
		return "male"
	case "T", "O", "OTHER", "TRANSGENDER":
		return "other"
	}
	return ""
}

func birthYear(s string) *int {
	m := yearRe.FindStringSubmatch(s)
	if m == nil {
		return nil
	}
	y, _ := strconv.Atoi(m[1])
	if y > time.Now().Year() {
		return nil
	}
	return &y
}

// joinAddress combines address parts, skipping blanks and repeats (a town often
// appears as locality, post office and district).
func joinAddress(parts ...string) string {
	var out []string
	seen := map[string]bool{}
	for _, p := range parts {
		p = strings.Join(strings.Fields(p), " ")
		if k := strings.ToLower(p); p != "" && !seen[k] {
			seen[k] = true
			out = append(out, p)
		}
	}
	return strings.Join(out, ", ")
}

// DecodeQR finds a QR code in a photo. Phone photos vary a lot, so it tries
// several binarizers, a boosted-contrast copy, a smaller copy and rotations,
// stopping at the first success or when ctx ends.
func DecodeQR(ctx context.Context, img image.Image) (string, error) {
	hints := map[gozxing.DecodeHintType]interface{}{gozxing.DecodeHintType_TRY_HARDER: true}
	reader := qrcode.NewQRCodeReader()
	attempt := func(im image.Image) (string, bool) {
		src := gozxing.NewLuminanceSourceFromImage(im)
		for _, b := range []gozxing.Binarizer{gozxing.NewHybridBinarizer(src), gozxing.NewGlobalHistgramBinarizer(src)} {
			if ctx.Err() != nil {
				return "", false
			}
			bmp, err := gozxing.NewBinaryBitmap(b)
			if err != nil {
				continue
			}
			if res, err := reader.Decode(bmp, hints); err == nil {
				return res.GetText(), true
			}
			reader.Reset()
		}
		return "", false
	}
	variants := []func() image.Image{
		func() image.Image { return img },
		func() image.Image { return stretchContrast(img) },
		func() image.Image { return downscale(img, 1200) },
		func() image.Image { return rotate90(img) },
		func() image.Image { return stretchContrast(rotate90(img)) },
	}
	for _, v := range variants {
		if ctx.Err() != nil {
			break
		}
		if text, ok := attempt(v()); ok {
			return text, nil
		}
	}
	return "", errors.New("no QR code found")
}

func stretchContrast(img image.Image) image.Image {
	b := img.Bounds()
	var hist [256]int
	gray := image.NewGray(b)
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			v := color.GrayModel.Convert(img.At(x, y)).(color.Gray).Y
			gray.SetGray(x, y, color.Gray{Y: v})
			hist[v]++
		}
	}
	// Ignore the darkest and brightest 2% so glare doesn't set the range.
	total, cut := b.Dx()*b.Dy(), b.Dx()*b.Dy()/50
	lo, hi, sum := 0, 255, 0
	for i := 0; i < 256; i++ {
		if sum += hist[i]; sum > cut {
			lo = i
			break
		}
	}
	sum = 0
	for i := 255; i >= 0; i-- {
		if sum += hist[i]; sum > cut {
			hi = i
			break
		}
	}
	if hi <= lo || total == 0 {
		return gray
	}
	for i, v := range gray.Pix {
		n := (int(v) - lo) * 255 / (hi - lo)
		gray.Pix[i] = uint8(max(0, min(255, n)))
	}
	return gray
}

func downscale(img image.Image, maxEdge int) image.Image {
	b := img.Bounds()
	edge := max(b.Dx(), b.Dy())
	if edge <= maxEdge {
		return img
	}
	w, h := b.Dx()*maxEdge/edge, b.Dy()*maxEdge/edge
	out := image.NewGray(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			out.Set(x, y, img.At(b.Min.X+x*edge/maxEdge, b.Min.Y+y*edge/maxEdge))
		}
	}
	return out
}

func rotate90(img image.Image) image.Image {
	b := img.Bounds()
	out := image.NewGray(image.Rect(0, 0, b.Dy(), b.Dx()))
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			out.Set(b.Max.Y-1-y, x-b.Min.X, img.At(x, y))
		}
	}
	return out
}

const maxScanImage = 5 << 20 // 5 MB

// ScanAadhaar reads an Aadhaar QR from a photo. The image is handled in memory
// only: it is never stored, and neither it nor the result is logged.
func (h *Handler) ScanAadhaar(w http.ResponseWriter, r *http.Request) error {
	data, _, err := storage.ReadImageMax(r, "file", maxScanImage)
	if err != nil {
		return err
	}
	notFound := &httpx.Error{Status: http.StatusUnprocessableEntity, Code: "qr_not_found",
		Message: "Couldn't read the Aadhaar QR code. Retake the photo with the QR in focus, or type the details."}
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return notFound
	}
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	text, err := DecodeQR(ctx, img)
	if err != nil {
		return notFound
	}
	d, err := ParseAadhaarQR(text)
	if err != nil {
		return notFound
	}
	httpx.JSON(w, http.StatusOK, d)
	return nil
}

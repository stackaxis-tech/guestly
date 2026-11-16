package auth

import (
	"testing"
)

func TestNormalizeIndianPhone(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"9876543210", "9876543210"},
		{"+919876543210", "9876543210"},
		{"+91 98765 43210", "9876543210"},
		{"919876543210", "9876543210"},
	}

	for _, tc := range tests {
		if got := normalizeIndianPhone(tc.input); got != tc.want {
			t.Errorf("normalizeIndianPhone(%q) = %q, want %q", tc.input, got, tc.want)
		}
	}
}

func TestPhoneRegex(t *testing.T) {
	valid := []string{
		"9876543210",
		"+919876543210",
		"8123456789",
		"7123456789",
		"6123456789",
	}
	invalid := []string{
		"5123456789",
		"123456",
		"abcd123456",
		"+911234567890",
		"98765432100", // 11 digits
	}

	for _, s := range valid {
		if !phoneRe.MatchString(s) {
			t.Errorf("expected valid: %s", s)
		}
	}
	for _, s := range invalid {
		if phoneRe.MatchString(s) {
			t.Errorf("expected invalid: %s", s)
		}
	}
}

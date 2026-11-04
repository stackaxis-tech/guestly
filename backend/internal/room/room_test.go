package room

import "testing"

func TestCanTransition(t *testing.T) {
	cases := []struct {
		from, to Status
		want     bool
	}{
		{StatusCleaning, StatusReady, true},
		{StatusReady, StatusCleaning, true},
		{StatusReady, StatusMaintenance, true},
		{StatusMaintenance, StatusReady, true},
		{StatusReady, StatusOccupied, false},    // only via check-in
		{StatusOccupied, StatusCleaning, false}, // only via checkout
		{StatusCleaning, StatusOccupied, false},
	}
	for _, c := range cases {
		if got := CanTransition(c.from, c.to); got != c.want {
			t.Errorf("CanTransition(%s, %s) = %v, want %v", c.from, c.to, got, c.want)
		}
	}
}

package ticket

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

type vectorFile struct {
	Secret      string `json:"secret"`
	Now         int64  `json:"now"`
	SkewSeconds int64  `json:"skewSeconds"`
	Valid       []struct {
		Name   string `json:"name"`
		Token  string `json:"token"`
		Claims Claims `json:"claims"`
	} `json:"valid"`
	Invalid []struct {
		Name  string `json:"name"`
		Token string `json:"token"`
		Error string `json:"error"`
	} `json:"invalid"`
}

func loadVectors(t *testing.T) (vectorFile, *Verifier) {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "sdk", "testdata", "ticket-vectors.json"))
	if err != nil {
		t.Fatal(err)
	}
	var vf vectorFile
	if err := json.Unmarshal(data, &vf); err != nil {
		t.Fatal(err)
	}
	v, err := NewVerifier([]byte(vf.Secret))
	if err != nil {
		t.Fatal(err)
	}
	return vf, v.WithClock(func() time.Time { return time.Unix(vf.Now, 0) })
}

var errorsByName = map[string]error{
	"malformed": ErrMalformed,
	"signature": ErrSignature,
	"expired":   ErrExpired,
	"claims":    ErrClaims,
}

func TestVectors(t *testing.T) {
	vf, v := loadVectors(t)
	if time.Duration(vf.SkewSeconds)*time.Second != ClockSkew {
		t.Fatalf("vectors use %ds of skew, verifier uses %s", vf.SkewSeconds, ClockSkew)
	}
	for _, tc := range vf.Valid {
		t.Run("valid/"+tc.Name, func(t *testing.T) {
			got, err := v.Verify(tc.Token)
			if err != nil {
				t.Fatalf("Verify: %v", err)
			}
			if got != tc.Claims {
				t.Fatalf("claims = %+v, want %+v", got, tc.Claims)
			}
		})
	}
	for _, tc := range vf.Invalid {
		t.Run("invalid/"+tc.Name, func(t *testing.T) {
			want, ok := errorsByName[tc.Error]
			if !ok {
				t.Fatalf("unknown error kind %q in vectors", tc.Error)
			}
			if _, err := v.Verify(tc.Token); !errors.Is(err, want) {
				t.Fatalf("err = %v, want %v", err, want)
			}
		})
	}
}

// Sign must reproduce the independent generator's tokens byte for byte.
func TestSignMatchesVectors(t *testing.T) {
	vf, _ := loadVectors(t)
	for _, tc := range vf.Valid[:3] {
		got, err := Sign([]byte(vf.Secret), tc.Claims)
		if err != nil {
			t.Fatal(err)
		}
		if got != tc.Token {
			t.Errorf("%s: Sign = %s, want %s", tc.Name, got, tc.Token)
		}
	}
}

func TestOneByteChangesFail(t *testing.T) {
	vf, v := loadVectors(t)
	token := vf.Valid[0].Token
	for i := len(Prefix); i < len(token); i++ {
		if token[i] == '.' {
			continue
		}
		b := []byte(token)
		if b[i] == 'A' {
			b[i] = 'B'
		} else {
			b[i] = 'A'
		}
		if _, err := v.Verify(string(b)); err == nil {
			t.Fatalf("changing byte %d was accepted", i)
		}
	}
}

func TestNewVerifierRejectsShortSecret(t *testing.T) {
	if _, err := NewVerifier(make([]byte, MinSecretBytes-1)); err == nil {
		t.Fatal("short secret accepted")
	}
}

func TestServiceKeyMatches(t *testing.T) {
	cases := []struct {
		configured, presented string
		want                  bool
	}{
		{"service-key", "service-key", true},
		{"service-key", "service-kez", false},
		{"service-key", "service-key-longer", false},
		{"service-key", "", false},
		{"", "", false},
	}
	for _, tc := range cases {
		if got := ServiceKeyMatches(tc.configured, tc.presented); got != tc.want {
			t.Errorf("ServiceKeyMatches(%q, %q) = %v, want %v", tc.configured, tc.presented, got, tc.want)
		}
	}
}

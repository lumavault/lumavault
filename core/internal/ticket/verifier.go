package ticket

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// Strict decoding rejects non-zero trailing bits, so every token has exactly one valid spelling.
var b64 = base64.RawURLEncoding.Strict()

// Verifier checks tickets signed with one secret.
type Verifier struct {
	secret []byte
	now    func() time.Time
}

// NewVerifier returns a Verifier, refusing secrets shorter than MinSecretBytes.
func NewVerifier(secret []byte) (*Verifier, error) {
	if len(secret) < MinSecretBytes {
		return nil, fmt.Errorf("ticket: secret must be at least %d bytes, got %d", MinSecretBytes, len(secret))
	}
	return &Verifier{secret: append([]byte(nil), secret...), now: time.Now}, nil
}

// WithClock returns a copy of v that reads the time from now. For tests.
func (v *Verifier) WithClock(now func() time.Time) *Verifier {
	cp := *v
	cp.now = now
	return &cp
}

// Verify checks the signature, then the claims, then the expiry, and returns the claims.
// The signature is checked before the payload is decoded, so unsigned input is never parsed.
func (v *Verifier) Verify(token string) (Claims, error) {
	rest, ok := strings.CutPrefix(token, Prefix)
	if !ok {
		return Claims{}, fmt.Errorf("%w: missing %s prefix", ErrMalformed, Prefix)
	}
	body, sigText, ok := strings.Cut(rest, ".")
	if !ok || strings.Contains(sigText, ".") {
		return Claims{}, fmt.Errorf("%w: want prefix, payload, and signature", ErrMalformed)
	}
	sig, err := b64.DecodeString(sigText)
	if err != nil {
		return Claims{}, fmt.Errorf("%w: signature is not base64url", ErrMalformed)
	}
	if !hmac.Equal(sig, sign(v.secret, body)) {
		return Claims{}, ErrSignature
	}
	raw, err := b64.DecodeString(body)
	if err != nil {
		return Claims{}, fmt.Errorf("%w: payload is not base64url", ErrMalformed)
	}
	var c Claims
	if err := json.Unmarshal(raw, &c); err != nil {
		return Claims{}, fmt.Errorf("%w: payload is not JSON: %v", ErrMalformed, err)
	}
	if err := c.validate(); err != nil {
		return Claims{}, err
	}
	if v.now().After(time.Unix(c.Exp, 0).Add(ClockSkew)) {
		return Claims{}, ErrExpired
	}
	return c, nil
}

// Sign mints a ticket. The Gateway never mints; this exists for tests and tools.
func Sign(secret []byte, c Claims) (string, error) {
	raw, err := json.Marshal(c)
	if err != nil {
		return "", err
	}
	body := b64.EncodeToString(raw)
	return Prefix + body + "." + b64.EncodeToString(sign(secret, body)), nil
}

func sign(secret []byte, body string) []byte {
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(Prefix + body))
	return mac.Sum(nil)
}

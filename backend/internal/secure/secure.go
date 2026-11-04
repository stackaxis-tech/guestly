// Package secure encrypts sensitive guest data (ID numbers and images) at rest
// with AES-256-GCM. The key comes from DATA_KEY and never touches the database.
package secure

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
)

type Box struct{ aead cipher.AEAD }

// New builds a Box from a 64-char hex key (32 bytes). In development an empty
// key derives one from a fixed phrase so the app runs out of the box.
func New(hexKey string, dev bool) (*Box, error) {
	var key []byte
	switch {
	case hexKey != "":
		k, err := hex.DecodeString(hexKey)
		if err != nil || len(k) != 32 {
			return nil, errors.New("DATA_KEY must be 64 hex characters (32 bytes)")
		}
		key = k
	case dev:
		k := sha256.Sum256([]byte("guestly-dev-data-key-not-for-production"))
		key = k[:]
	default:
		return nil, errors.New("DATA_KEY is required")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &Box{aead: aead}, nil
}

// Seal encrypts plaintext; output is nonce || ciphertext.
func (b *Box) Seal(plain []byte) []byte {
	nonce := make([]byte, b.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		panic(fmt.Sprintf("crypto/rand failed: %v", err))
	}
	return b.aead.Seal(nonce, nonce, plain, nil)
}

func (b *Box) Open(sealed []byte) ([]byte, error) {
	n := b.aead.NonceSize()
	if len(sealed) < n {
		return nil, errors.New("ciphertext too short")
	}
	return b.aead.Open(nil, sealed[:n], sealed[n:], nil)
}

// SealString is a convenience for short secrets like ID numbers; "" stays nil.
func (b *Box) SealString(s string) []byte {
	if s == "" {
		return nil
	}
	return b.Seal([]byte(s))
}

func (b *Box) OpenString(sealed []byte) (string, error) {
	if len(sealed) == 0 {
		return "", nil
	}
	p, err := b.Open(sealed)
	return string(p), err
}

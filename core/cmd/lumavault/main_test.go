package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	lumavaultv1 "github.com/lumavault/lumavault/core/gen/go/lumavault/v1"
	"github.com/lumavault/lumavault/core/gen/go/lumavault/v1/lumavaultv1connect"
	"github.com/lumavault/lumavault/core/internal/chunkstore"
	"github.com/lumavault/lumavault/core/internal/metadata"
)

var listeningLine = regexp.MustCompile(`msg=listening addr=(\S+)`)

// startServer runs the server in the background and returns its base URL. Cleanup cancels
// the context and requires run to return nil.
func startServer(t *testing.T, args ...string) string {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	pr, pw := io.Pipe()
	done := make(chan error, 1)
	go func() {
		err := run(ctx, args, pw)
		pw.Close()
		done <- err
	}()

	addrCh := make(chan string, 1)
	go func() {
		sc := bufio.NewScanner(pr)
		for sc.Scan() {
			if m := listeningLine.FindStringSubmatch(sc.Text()); m != nil {
				select {
				case addrCh <- m[1]:
				default:
				}
			}
		}
	}()

	t.Cleanup(func() {
		cancel()
		select {
		case err := <-done:
			if err != nil {
				t.Errorf("run returned %v after cancel", err)
			}
		case <-time.After(15 * time.Second):
			t.Error("run did not return after cancel")
		}
	})

	select {
	case addr := <-addrCh:
		return "http://" + addr
	case err := <-done:
		t.Fatalf("run exited before listening: %v", err)
	case <-time.After(10 * time.Second):
		t.Fatal("server never logged its listen address")
	}
	return ""
}

func sha(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func chunkFile(dataDir, hash string) string {
	return filepath.Join(dataDir, chunkStoreSubdir, "chunks", hash[:2], hash[2:4], hash)
}

func TestRunLifecycle(t *testing.T) {
	dataDir := t.TempDir()
	base := startServer(t, "-addr", "127.0.0.1:0", "-data-dir", dataDir, "-gc-interval", "0")
	ctx := context.Background()

	res, err := http.Get(base + "/healthz")
	if err != nil || res.StatusCode != http.StatusOK {
		t.Fatalf("healthz: %v %v", res, err)
	}
	res.Body.Close()

	// Plaintext HTTP/2 (h2c) client speaking binary gRPC.
	h2c := new(http.Protocols)
	h2c.SetUnencryptedHTTP2(true)
	grpcHTTP := &http.Client{Transport: &http.Transport{Protocols: h2c}}
	client := lumavaultv1connect.NewStorageServiceClient(
		connect.NewClient(connecthttp.NewTransport(grpcHTTP, base, connecthttp.WithGRPC())))

	data := bytes.Repeat([]byte("lumavault"), 300)
	parts := [][]byte{data[:1000], data[1000:2000], data[2000:]}
	var hashes []string
	for _, p := range parts {
		hashes = append(hashes, sha(p))
	}

	has, err := client.HasChunks(ctx, &lumavaultv1.HasChunksRequest{ChunkHashes: hashes})
	if err != nil || len(has.GetMissingChunkHashes()) != 3 {
		t.Fatalf("HasChunks over gRPC: %v %v", has, err)
	}
	for i, p := range parts {
		req, _ := http.NewRequest(http.MethodPut, base+"/v1/chunks/"+hashes[i], bytes.NewReader(p))
		res, err := http.DefaultClient.Do(req)
		if err != nil || res.StatusCode != http.StatusCreated {
			t.Fatalf("PUT chunk %d: %v %v", i, res, err)
		}
		res.Body.Close()
	}

	committed, err := client.CommitObject(ctx, &lumavaultv1.CommitObjectRequest{
		Namespace:      lumavaultv1.Namespace_NAMESPACE_PHOTOS,
		Filename:       "a.bin",
		SizeBytes:      uint64(len(data)),
		ChunkSizeBytes: 1000,
		Sha256Digest:   sha(data),
		ChunkHashes:    hashes,
	})
	if err != nil {
		t.Fatalf("CommitObject: %v", err)
	}
	id := committed.GetObject().GetId()

	res, err = http.Get(base + "/v1/stream/" + id)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusOK || !bytes.Equal(body, data) {
		t.Fatalf("stream: status %d, %d bytes", res.StatusCode, len(body))
	}

	if _, err := client.DeleteObject(ctx, &lumavaultv1.DeleteObjectRequest{ObjectId: id}); err != nil {
		t.Fatalf("DeleteObject: %v", err)
	}

	for _, dir := range []string{
		filepath.Join(dataDir, chunkStoreSubdir, "chunks"),
		filepath.Join(dataDir, chunkStoreSubdir, "tmp"),
		filepath.Join(dataDir, metadataSubdir, "objects"),
	} {
		if _, err := os.Stat(dir); err != nil {
			t.Errorf("expected store directory %s: %v", dir, err)
		}
	}
}

func TestRunGarbageCollectsUnreferencedChunks(t *testing.T) {
	dataDir := t.TempDir()
	ctx := context.Background()

	// Seed the stores directly so the test controls chunk ages without racing uploads.
	cs, err := chunkstore.NewLocalChunkStore(filepath.Join(dataDir, chunkStoreSubdir))
	if err != nil {
		t.Fatal(err)
	}
	ms, err := metadata.NewLocalMetadataStore(filepath.Join(dataDir, metadataSubdir))
	if err != nil {
		t.Fatal(err)
	}
	orphan, kept := []byte("orphan chunk"), []byte("referenced chunk")
	for _, b := range [][]byte{orphan, kept} {
		if _, err := cs.PutChunk(ctx, sha(b), bytes.NewReader(b)); err != nil {
			t.Fatal(err)
		}
	}
	if _, _, err := ms.CommitObject(ctx, &lumavaultv1.CommitObjectRequest{
		Namespace:      lumavaultv1.Namespace_NAMESPACE_GAMES,
		SizeBytes:      uint64(len(kept)),
		ChunkSizeBytes: uint32(len(kept)),
		Sha256Digest:   sha(kept),
		ChunkHashes:    []string{sha(kept)},
	}); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-48 * time.Hour)
	for _, b := range [][]byte{orphan, kept} {
		if err := os.Chtimes(chunkFile(dataDir, sha(b)), old, old); err != nil {
			t.Fatal(err)
		}
	}

	startServer(t, "-addr", "127.0.0.1:0", "-data-dir", dataDir, "-gc-interval", "20ms", "-gc-grace-period", "24h")

	deadline := time.Now().Add(5 * time.Second)
	for {
		if _, err := os.Stat(chunkFile(dataDir, sha(orphan))); os.IsNotExist(err) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("GC never removed the unreferenced chunk")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if _, err := os.Stat(chunkFile(dataDir, sha(kept))); err != nil {
		t.Fatalf("GC removed a referenced chunk: %v", err)
	}
}

func TestRunEnvFallback(t *testing.T) {
	t.Setenv(envAddr, "127.0.0.1:0")
	t.Setenv(envDataDir, t.TempDir())
	t.Setenv(envGCInterval, "0")
	base := startServer(t)
	res, err := http.Get(base + "/healthz")
	if err != nil || res.StatusCode != http.StatusOK {
		t.Fatalf("healthz: %v %v", res, err)
	}
	res.Body.Close()
}

func TestRunConfigErrors(t *testing.T) {
	dataDir := t.TempDir()
	cases := map[string][]string{
		"unknown flag":          {"-bogus"},
		"negative gc interval":  {"-gc-interval", "-1s"},
		"negative grace period": {"-gc-grace-period", "-1s"},
		"bad duration":          {"-gc-interval", "soon"},
		"empty addr":            {"-addr", ""},
		"empty data dir":        {"-data-dir", ""},
		"extra argument":        {"serve"},
		"unlistenable addr":     {"-addr", "256.0.0.1:0", "-data-dir", dataDir},
	}
	for name, args := range cases {
		t.Run(name, func(t *testing.T) {
			if err := run(context.Background(), args, io.Discard); err == nil {
				t.Fatalf("run(%q) returned nil, want error", args)
			}
		})
	}

	t.Run("bad env duration", func(t *testing.T) {
		t.Setenv(envGCGracePeriod, "forever")
		if err := run(context.Background(), nil, io.Discard); err == nil {
			t.Fatal("want error for bad env duration")
		}
	})
}

func TestTicketConfig(t *testing.T) {
	longSecret := strings.Repeat("s", 32)
	bad := map[string][2]string{
		"short secret":       {"too-short", "key"},
		"secret without key": {longSecret, ""},
		"key without secret": {"", "key"},
	}
	for name, env := range bad {
		t.Run(name, func(t *testing.T) {
			t.Setenv(envTicketSecret, env[0])
			t.Setenv(envServiceKey, env[1])
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			err := run(ctx, []string{"-addr", "127.0.0.1:0", "-data-dir", t.TempDir(), "-gc-interval", "0"}, io.Discard)
			if err == nil {
				t.Fatalf("run accepted secret %q and key %q", env[0], env[1])
			}
			if !strings.Contains(err.Error(), envTicketSecret) {
				t.Errorf("error %q should mention %s", err, envTicketSecret)
			}
		})
	}

	t.Run("checks on", func(t *testing.T) {
		t.Setenv(envTicketSecret, longSecret)
		t.Setenv(envServiceKey, "key")
		t.Setenv(envAddr, "127.0.0.1:0")
		t.Setenv(envDataDir, t.TempDir())
		t.Setenv(envGCInterval, "0")
		base := startServer(t)
		req, _ := http.NewRequest(http.MethodPut, base+"/v1/chunks/"+sha([]byte("x")), strings.NewReader("x"))
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != http.StatusUnauthorized {
			t.Fatalf("PUT without a ticket: status %d, want 401", res.StatusCode)
		}
	})
}

BUF ?= $(shell command -v buf 2>/dev/null || echo $(shell go env GOPATH)/bin/buf)
PNPM ?= pnpm

# Regenerate stubs whenever any proto or buf config changes. The stamp lives in gen/, which
# make clean removes along with the stubs.
PROTO_SRCS := $(shell find proto -name '*.proto')
PROTO_STAMP := gen/.proto-stamp

# pnpm writes this file on every successful install.
JS_DEPS := node_modules/.modules.yaml
JS_MANIFESTS := package.json pnpm-workspace.yaml pnpm-lock.yaml \
	$(wildcard sdk/web/package.json packages/*/package.json apps/*/package.json apps/*/web/package.json)

# Workspace packages import the SDK from its build output, so build it first.
SDK_BUILD := sdk/web/dist/index.js
SDK_SRCS := $(shell find sdk/web/src -name '*.ts' -not -name '*.test.ts' 2>/dev/null)

.PHONY: proto build test lint run dev clean e2e \
	lint-go lint-js lint-swift test-go test-js test-swift

proto:
	$(BUF) lint
	$(BUF) generate
	$(BUF) generate --template buf.gen.go.yaml --path proto/lumavault/v1
	@mkdir -p gen && touch $(PROTO_STAMP)

$(PROTO_STAMP): $(PROTO_SRCS) buf.yaml buf.gen.yaml buf.gen.go.yaml
	$(BUF) generate
	$(BUF) generate --template buf.gen.go.yaml --path proto/lumavault/v1
	@mkdir -p gen && touch $@

$(JS_DEPS): $(JS_MANIFESTS)
	$(PNPM) install --frozen-lockfile
	@touch $@

$(SDK_BUILD): $(PROTO_STAMP) $(JS_DEPS) $(SDK_SRCS) sdk/web/tsconfig.json sdk/web/tsconfig.build.json
	$(PNPM) --filter @lumavault/sdk run build

build: $(PROTO_STAMP) $(SDK_BUILD)
	@mkdir -p bin
	go build -o bin/lumavault ./cmd/lumavault
	$(PNPM) -r --if-present run build
	swift build

lint: lint-go lint-js lint-swift

lint-go: $(PROTO_STAMP)
	$(BUF) lint
	go vet ./...

lint-js: $(SDK_BUILD)
	$(PNPM) -r --if-present run typecheck

lint-swift: $(PROTO_STAMP)
	swift build

test: test-go test-js test-swift

test-go: $(PROTO_STAMP)
	go test -race ./...

test-js: $(SDK_BUILD)
	$(PNPM) -r --if-present run test

test-swift: $(PROTO_STAMP)
	swift test

# Portal end-to-end tests: real API, fresh lv_e2e database on TEST_DATABASE_URL's server, Chromium.
e2e: $(SDK_BUILD)
	$(PNPM) --filter @lumavault/portal exec playwright test

run: $(PROTO_STAMP)
	go run ./cmd/lumavault

# The Gateway, the API, and the Portal. Start Postgres and Mailpit first with docker compose up -d.
dev:
	./scripts/dev.sh

clean:
	rm -rf bin/ gen/ sdk/web/src/gen/ sdk/web/dist/ sdk/swift/Sources/LumaVaultSDK/Gen/

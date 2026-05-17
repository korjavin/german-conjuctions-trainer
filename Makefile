# Build pipeline for the German Conjunctions Trainer.
#
# Two binaries live under cmd/:
#   - server: the HTTP server (cgo + sqlite — Docker handles its build)
#   - cli:    the `gct` admin/agent CLI; uses pure-Go std + oauth2
#
# Most local dev uses `make test` plus `make build-cli`. The server is built
# inside Docker for prod, so `make build-server` is provided mainly so devs
# can sanity-check it from a host.

VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
COMMIT  ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo unknown)

CLI_PKG  := ./cmd/cli
SRV_PKG  := ./cmd/server

# ldflags inject the build metadata into main.version / main.commit so
# `gct version` reports the same string CI built from.
CLI_LDFLAGS := -X 'main.version=$(VERSION)' -X 'main.commit=$(COMMIT)'

.PHONY: all build build-cli build-server test vet tidy clean help

all: build

help:
	@echo "Targets:"
	@echo "  build-cli      Build the gct CLI to ./gct"
	@echo "  build-server   Build the HTTP server to ./server (requires CGO + sqlite headers)"
	@echo "  build          Both binaries"
	@echo "  test           Run the full Go test suite"
	@echo "  vet            Run go vet on all packages"
	@echo "  tidy           Run go mod tidy"
	@echo "  clean          Remove built binaries"

build: build-cli build-server

build-cli:
	go build -ldflags "$(CLI_LDFLAGS)" -o gct $(CLI_PKG)

build-server:
	CGO_ENABLED=1 go build -o server $(SRV_PKG)

test:
	go test ./...

vet:
	go vet ./...

tidy:
	go mod tidy

clean:
	rm -f gct server cli

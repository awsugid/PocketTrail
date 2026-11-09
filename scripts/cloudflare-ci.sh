#!/bin/sh
# Cloudflare Builds runs as an unprivileged user; toolchains live under HOME.
set -eu

mode=${1:-}
case "$mode" in
    build|deploy) ;;
    *) echo "Usage: sh scripts/cloudflare-ci.sh build|deploy" >&2; exit 2 ;;
esac
case "$(uname -s):$(uname -m)" in
    Linux:x86_64) arch=x86_64 ;;
    Linux:aarch64) arch=arm64 ;;
    *) echo "Cloudflare CI requires Linux x86_64 or arm64." >&2; exit 1 ;;
esac

sdk_name="wasi-sdk-25.0-${arch}-linux"
sdk="$HOME/toolchains/$sdk_name"
if [ "$mode" = build ]; then
    if [ ! -x "$sdk/bin/clang" ]; then
        mkdir -p "$HOME/toolchains"
        download=$(mktemp -d)
        trap 'rm -rf "$download"' EXIT HUP INT TERM
        curl --proto '=https' --tlsv1.2 -fLsS \
            "https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-25/$sdk_name.tar.gz" \
            -o "$download/sdk.tar.gz"
        tar -xzf "$download/sdk.tar.gz" -C "$HOME/toolchains"
    fi
    if [ ! -f "$HOME/.cargo/env" ]; then
        download=${download:-$(mktemp -d)}
        trap 'rm -rf "$download"' EXIT HUP INT TERM
        curl --proto '=https' --tlsv1.2 -fLsS https://sh.rustup.rs -o "$download/rustup.sh"
        sh "$download/rustup.sh" -y --profile minimal --default-toolchain stable
    fi
fi

# Build and deploy run in separate shells. Both need Rust and the WASM C compiler.
. "$HOME/.cargo/env"
export CC_wasm32_unknown_unknown="$sdk/bin/clang"
"$CC_wasm32_unknown_unknown" --version

if [ "$mode" = build ]; then
    rustup default stable
    rustup target add wasm32-unknown-unknown
    cargo install worker-build --version 0.8.7 --locked
    npm test
    npm run build
else
    # Production operation: migrations must succeed before Worker publication.
    npm run deploy
fi

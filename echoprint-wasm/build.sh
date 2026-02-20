#!/usr/bin/env bash
# Build echoprint-codegen to WebAssembly using Emscripten.
# Output: ../echoprint.js + ../echoprint.wasm (served statically alongside index.html)
#
# Requirements:
#   - Emscripten (emcc): https://emscripten.org/docs/getting_started/downloads.html
#   - Boost headers: brew install boost  OR  apt install libboost-dev
#   - git, curl/wget

set -e
cd "$(dirname "$0")"

# ── Check emcc ────────────────────────────────────────────────────────────────
if ! command -v emcc &>/dev/null; then
  echo "error: emcc not found — install Emscripten: https://emscripten.org/docs/getting_started/downloads.html"
  exit 1
fi

# ── Locate Boost headers ──────────────────────────────────────────────────────
BOOST_INCLUDE=""
for candidate in \
    /usr/include \
    /usr/local/include \
    /opt/homebrew/include \
    $(brew --prefix 2>/dev/null)/include; do
  if [ -d "$candidate/boost/numeric/ublas" ]; then
    BOOST_INCLUDE="$candidate"
    break
  fi
done

if [ -z "$BOOST_INCLUDE" ]; then
  echo "Boost not found — downloading headers (this is header-only, no compilation needed)..."
  BOOST_VER="1_84_0"
  BOOST_URL="https://boostorg.jfrog.io/artifactory/main/release/1.84.0/source/boost_${BOOST_VER}.tar.gz"
  if [ ! -d "boost_${BOOST_VER}" ]; then
    curl -L "$BOOST_URL" | tar xz boost_${BOOST_VER}/boost/
  fi
  BOOST_INCLUDE="$PWD/boost_${BOOST_VER}"
fi

echo "Using Boost headers: $BOOST_INCLUDE"

# ── Clone echoprint-codegen ───────────────────────────────────────────────────
if [ ! -d "echoprint-codegen" ]; then
  echo "Cloning echoprint-codegen..."
  git clone https://github.com/echonest/echoprint-codegen.git
fi

SRC="echoprint-codegen/src"

# ── Resolve source file extensions (.cpp or .cxx) ────────────────────────────
src_file() {
  local f="$SRC/$1"
  if   [ -f "${f}.cpp" ]; then echo "${f}.cpp"
  elif [ -f "${f}.cxx" ]; then echo "${f}.cxx"
  else echo "error: cannot find $1.cpp or $1.cxx in $SRC" >&2; exit 1; fi
}

SRCS=(
  "$(src_file Codegen)"
  "$(src_file Fingerprint)"
  "$(src_file SubbandAnalysis)"
  "$(src_file Whitening)"
  "$(src_file Base64)"
  "$(src_file MatrixUtility)"
  "$(src_file AudioBufferInput)"
  "$(src_file AudioStreamInput)"
)

# ── Compile ───────────────────────────────────────────────────────────────────
echo "Compiling to WebAssembly..."

emcc \
  "${SRCS[@]}" \
  wrapper.cpp \
  -I "$SRC" \
  -I "$BOOST_INCLUDE" \
  -s USE_ZLIB=1 \
  --bind \
  -s MODULARIZE=1 \
  -s EXPORT_NAME="createEchoprint" \
  -s EXPORT_ES6=1 \
  -s ENVIRONMENT=web \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s EXPORTED_RUNTIME_METHODS='["HEAPF32"]' \
  -s EXPORTED_FUNCTIONS='["_malloc","_free"]' \
  -std=c++17 \
  -O2 \
  -o ../echoprint.js

echo "Done: echoprint.js + echoprint.wasm"

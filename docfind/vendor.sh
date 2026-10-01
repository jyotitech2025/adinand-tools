#!/usr/bin/env bash
# Fetch the third-party libraries the DocFind tools load, at the exact versions docfindapp.com
# serves, verify them, and lay them out under ./vendor/ (gitignored) with the same paths the site
# uses (/vendor/...). Nothing here is committed to this repository; see ../THIRD_PARTY.md.
#
# Pins and hashes come from the site's own record, docfind-ios site/vendor/README.md
# (also served at https://docfindapp.com/vendor/README.md). Every tarball is checked against its
# npm integrity string; every file the README gives a sha256 for is checked against it.
#
# Needs: curl, tar, openssl, gzip, and shasum or sha256sum. Exits non-zero on any mismatch.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/vendor"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
die() { echo "vendor.sh: $*" >&2; exit 1; }

check_sha() { # file expected
  local got; got="$(sha256 "$1")"
  [ "$got" = "$2" ] || die "sha256 mismatch for $1: got $got, expected $2"
  echo "  sha256 ok  ${1#"$WORK"/}"
}

fetch_npm() { # name version integrity
  local tgz="$WORK/$1-$2.tgz"
  curl -sSfL -o "$tgz" "https://registry.npmjs.org/$1/-/$1-$2.tgz"
  local got="sha512-$(openssl dgst -sha512 -binary "$tgz" | openssl base64 -A)"
  [ "$got" = "$3" ] || die "integrity mismatch for $1@$2: got $got"
  echo "  integrity ok  $1@$2"
  mkdir -p "$WORK/$1" && tar xzf "$tgz" -C "$WORK/$1"
}

put() { # source dest-relative-to-vendor
  mkdir -p "$(dirname "$OUT/$2")" && cp "$1" "$OUT/$2"
}

echo "fetching"
fetch_npm pdfjs-dist 6.3.289 'sha512-ZHjSVpDa3D6izMq8/04lvkhkATUmL9px6ChPaXc1k6nU2Mrhlg1/7F0bdUqCwUjw3NsPTfPZsMDUU6ZIcRaeQw=='
fetch_npm tesseract.js 7.0.0 'sha512-exPBkd+z+wM1BuMkx/Bjv43OeLBxhL5kKWsz/9JY+DXcXdiBjiAch0V49QR3oAJqCaL5qURE0vx9Eo+G5YE7mA=='
fetch_npm tesseract.js-core 7.0.0 'sha512-WnNH518NzmbSq9zgTPeoF8c+xmilS8rFIl1YKbk/ptuuc7p6cLNELNuPAzcmsYw450ca6bLa8j3t0VAtq435Vw=='

# tessdata_fast: eng.traineddata last changed in commit 923915d (2017-09-14); LICENSE was added
# later, last changed in 27cfc71 (2019-06-13). Both pinned by commit, not by branch.
TD=https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast
mkdir -p "$WORK/tessdata"
curl -sSfL -o "$WORK/tessdata/eng.traineddata" "$TD/923915d4ced2a7235221788285785a29c4a42d4a/eng.traineddata"
curl -sSfL -o "$WORK/tessdata/LICENSE" "$TD/27cfc71a8874cce2483679eea010e391bb38c2ae/LICENSE"

echo "verifying"
P="$WORK/pdfjs-dist/package"; T="$WORK/tesseract.js/package"; C="$WORK/tesseract.js-core/package"
check_sha "$P/legacy/build/pdf.min.mjs"        f401927e692efc7735e0cd528c490d0dd31b7f0972c122b7040df805be45cce4
check_sha "$P/legacy/build/pdf.worker.min.mjs" a33cfe728c584fdba4fcc1fd54bcdc2f9f2f13889ddbb5b2bd1d0f8cbe49b84e
check_sha "$T/dist/tesseract.esm.min.js"       64871d76c75609fd5413b88a8171e2ef40deedd77d5875ba23df104b2d05eb29
check_sha "$T/dist/worker.min.js"              576b7df7e3393e137e51849357c9adb53fe7ac1bb69bfa06cf3d61520f182c6d
check_sha "$C/tesseract-core-lstm.wasm.js"            eef5f8b2f8e20e150680b20adaec4a60babafee3adbe8a94583c81fee46e8680
check_sha "$C/tesseract-core-simd-lstm.wasm.js"       c58b46a4c796c0b8afccf77591d5b875b6896b45d402bbce8caa6f5362447b38
check_sha "$C/tesseract-core-relaxedsimd-lstm.wasm.js" 861a536cf9ef8e63cb644d57bab39c388f37f7d6b6f60024b741c5f6b39a59b3
check_sha "$WORK/tessdata/eng.traineddata"     7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2
# Not recorded in the site's README; this is the sha256 of the copy docfindapp.com serves (1 October 2026).
check_sha "$WORK/tessdata/LICENSE"             cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30
# The site gzips the model with `gzip -9 -n` (no name, no timestamp). Reproduced byte-for-byte with
# macOS's /usr/bin/gzip; a different gzip implementation may compress differently, and then this
# check fails rather than serving bytes that differ from the site's.
gzip -9 -n -c "$WORK/tessdata/eng.traineddata" > "$WORK/tessdata/eng.traineddata.gz"
check_sha "$WORK/tessdata/eng.traineddata.gz"  f1c22599ed6fd3eb821d87fdb43e09f98b61179a4abe38c43cfca2cdcb9f5ec2

echo "laying out $OUT"
rm -rf "$OUT/pdfjs-6.3.289" "$OUT/tesseract.js-7.0.0" "$OUT/tesseract.js-core-7.0.0" "$OUT/tessdata_fast-923915d"

# pdf.js: the legacy build, cmaps/, standard_fonts/, the image decoders in wasm/ and their
# licences. Deliberately NOT taken (see the site README): wasm/quickjs-eval.*, iccs/, *.map,
# pdf.sandbox.* (the JavaScript-in-PDF sandbox).
put "$P/LICENSE" pdfjs-6.3.289/LICENSE
put "$P/legacy/build/pdf.min.mjs" pdfjs-6.3.289/pdf.min.mjs
put "$P/legacy/build/pdf.worker.min.mjs" pdfjs-6.3.289/pdf.worker.min.mjs
for f in "$P"/cmaps/*; do put "$f" "pdfjs-6.3.289/cmaps/$(basename "$f")"; done
for f in "$P"/standard_fonts/*; do put "$f" "pdfjs-6.3.289/standard_fonts/$(basename "$f")"; done
for f in jbig2.wasm openjpeg.wasm qcms_bg.wasm jbig2_nowasm_fallback.js openjpeg_nowasm_fallback.js \
         LICENSE_JBIG2 LICENSE_OPENJPEG LICENSE_QCMS LICENSE_PDFJS_JBIG2 LICENSE_PDFJS_OPENJPEG LICENSE_PDFJS_QCMS; do
  put "$P/wasm/$f" "pdfjs-6.3.289/wasm/$f"
done

# tesseract.js: the ESM build, the worker, their bundled third-party notices, the licence.
put "$T/LICENSE.md" tesseract.js-7.0.0/LICENSE.md
for f in tesseract.esm.min.js worker.min.js tesseract.min.js.LICENSE.txt worker.min.js.LICENSE.txt; do
  put "$T/dist/$f" "tesseract.js-7.0.0/$f"
done

# tesseract.js-core: the three LSTM-only cores (one per browser feature tier) and the licence.
put "$C/LICENSE" tesseract.js-core-7.0.0/LICENSE
for f in tesseract-core-lstm.wasm.js tesseract-core-simd-lstm.wasm.js tesseract-core-relaxedsimd-lstm.wasm.js; do
  put "$C/$f" "tesseract.js-core-7.0.0/$f"
done

# tessdata_fast: the gzipped English model and the licence.
put "$WORK/tessdata/eng.traineddata.gz" tessdata_fast-923915d/eng.traineddata.gz
put "$WORK/tessdata/LICENSE" tessdata_fast-923915d/LICENSE

n="$(find "$OUT" -type f | wc -l | tr -d ' ')"
echo "vendor.sh: $n files under vendor/"
[ "$n" -eq 210 ] || die "expected 210 files, laid out $n"

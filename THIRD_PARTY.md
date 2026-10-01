# Third-party code

Everything committed to this repository is first-party code under the MIT licence in [LICENSE](LICENSE).

The DocFind tools also load four third-party components. They are **not** committed here: `docfind/vendor.sh` downloads them at the pinned versions below, checks every hash, and lays them out under `docfind/vendor/` (which git ignores). Each keeps its own licence; none of them is relicensed by this repository. The pins and hashes are the ones docfindapp.com records for the copies it serves (https://docfindapp.com/vendor/README.md).

| Component | Version | Source | Licence |
|---|---|---|---|
| pdf.js (`pdfjs-dist`, legacy build) | 6.3.289 | `https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-6.3.289.tgz` | Apache-2.0 (`vendor/pdfjs-6.3.289/LICENSE`) |
| pdf.js image decoders (`wasm/`): JBIG2, OpenJPEG, QCMS | with pdf.js 6.3.289 | same tarball | JBIG2: PDFium BSD-style; OpenJPEG: BSD-2-Clause; QCMS: MIT; the pdf.js wrappers: Apache-2.0 / BSD-2-Clause / MIT (`wasm/LICENSE_*`) |
| pdf.js standard fonts: `Foxit*.pfb` | with pdf.js 6.3.289 | same tarball | PDFium BSD-style (`standard_fonts/LICENSE_FOXIT`) |
| pdf.js standard fonts: `LiberationSans-*.ttf` | with pdf.js 6.3.289 | same tarball | **GPL-2.0 with a font-embedding exception** (Red Hat licence text in `standard_fonts/LICENSE_LIBERATION`) |
| tesseract.js | 7.0.0 | `https://registry.npmjs.org/tesseract.js/-/tesseract.js-7.0.0.tgz` | Apache-2.0 (`LICENSE.md`); bundled notices for buffer (MIT), ieee754 (BSD-3-Clause), regenerator-runtime (MIT), zlib.js (MIT) in the two `*.LICENSE.txt` files |
| tesseract.js-core | 7.0.0 | `https://registry.npmjs.org/tesseract.js-core/-/tesseract.js-core-7.0.0.tgz` | Apache-2.0 (`LICENSE`) |
| tessdata_fast `eng.traineddata` | commit `923915d4ced2a7235221788285785a29c4a42d4a` | `https://github.com/tesseract-ocr/tessdata_fast` (gzipped with `gzip -9 -n`) | Apache-2.0 (`LICENSE`, from commit `27cfc71a8874cce2483679eea010e391bb38c2ae`) |

## Pins checked by `vendor.sh`

| What | Check |
|---|---|
| `pdfjs-dist-6.3.289.tgz` | `sha512-ZHjSVpDa3D6izMq8/04lvkhkATUmL9px6ChPaXc1k6nU2Mrhlg1/7F0bdUqCwUjw3NsPTfPZsMDUU6ZIcRaeQw==` |
| `tesseract.js-7.0.0.tgz` | `sha512-exPBkd+z+wM1BuMkx/Bjv43OeLBxhL5kKWsz/9JY+DXcXdiBjiAch0V49QR3oAJqCaL5qURE0vx9Eo+G5YE7mA==` |
| `tesseract.js-core-7.0.0.tgz` | `sha512-WnNH518NzmbSq9zgTPeoF8c+xmilS8rFIl1YKbk/ptuuc7p6cLNELNuPAzcmsYw450ca6bLa8j3t0VAtq435Vw==` |
| `pdf.min.mjs` | sha256 `f401927e692efc7735e0cd528c490d0dd31b7f0972c122b7040df805be45cce4` |
| `pdf.worker.min.mjs` | sha256 `a33cfe728c584fdba4fcc1fd54bcdc2f9f2f13889ddbb5b2bd1d0f8cbe49b84e` |
| `tesseract.esm.min.js` | sha256 `64871d76c75609fd5413b88a8171e2ef40deedd77d5875ba23df104b2d05eb29` |
| `worker.min.js` | sha256 `576b7df7e3393e137e51849357c9adb53fe7ac1bb69bfa06cf3d61520f182c6d` |
| `tesseract-core-lstm.wasm.js` | sha256 `eef5f8b2f8e20e150680b20adaec4a60babafee3adbe8a94583c81fee46e8680` |
| `tesseract-core-simd-lstm.wasm.js` | sha256 `c58b46a4c796c0b8afccf77591d5b875b6896b45d402bbce8caa6f5362447b38` |
| `tesseract-core-relaxedsimd-lstm.wasm.js` | sha256 `861a536cf9ef8e63cb644d57bab39c388f37f7d6b6f60024b741c5f6b39a59b3` |
| `eng.traineddata` | sha256 `7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2` |
| `eng.traineddata.gz` | sha256 `f1c22599ed6fd3eb821d87fdb43e09f98b61179a4abe38c43cfca2cdcb9f5ec2` |
| tessdata_fast `LICENSE` | sha256 `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30` |

Deliberately not fetched, as on the website: pdf.js's JavaScript-in-PDF sandbox (`pdf.sandbox.*`, `wasm/quickjs-eval.*`), `iccs/`, source maps, and the tesseract.js-core builds that carry the legacy engine.

Licence identities were read on 26 September 2026 from the npm registry, the GitHub licence API, and the licence files shipped in each package.

The SubSense page is built with Astro (MIT); Astro itself is not part of this repository.

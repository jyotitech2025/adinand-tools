# DocFind — free PDF tools

Three browser tools from the makers of DocFind, an app for iPhone and Android that searches inside many PDFs at once. Live at https://docfindapp.com/tools/.

| Tool | Live page | File |
|---|---|---|
| Search text across multiple PDFs | https://docfindapp.com/tools/search-multiple-pdfs | `tools/search-multiple-pdfs.html` |
| Extract the text from a PDF | https://docfindapp.com/tools/extract-text-from-pdf | `tools/extract-text-from-pdf.html` |
| Is your PDF searchable? | https://docfindapp.com/tools/is-your-pdf-searchable | `tools/is-your-pdf-searchable.html` |

## Your files stay in your browser

Each page carries a Content-Security-Policy with `connect-src 'self'`, so the browser itself refuses any request to another origin. The libraries are served from the same origin, never a CDN.

## Run it locally

The files keep the website's paths (`/style.css`, `/tools/…`, `/vendor/…`), so serve this folder as the web root:

    ./vendor.sh                 # downloads pdf.js and tesseract.js at the pinned versions and checks their hashes
    python3 -m http.server 8000 # then open http://localhost:8000/tools/search-multiple-pdfs.html

## Tests

    ./vendor.sh                 # the tests read the libraries under vendor/
    npm ci                      # installs tesseract.js 7.0.0, used only by prove-ocr.mjs
    node tools/prove-pdf-tools.mjs
    node --require ./tools/no-network.cjs tools/prove-ocr.mjs
    node tools/prove-folder-memory.mjs
    node tools/prove-export.mjs

## Source

Mirrored from https://docfindapp.com/tools/ on 1 October 2026. The website is the source of truth; if the two differ, the website wins. DocFind app: https://docfindapp.com

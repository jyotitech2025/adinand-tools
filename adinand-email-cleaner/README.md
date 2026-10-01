# Adinand Email Cleaner — free Gmail tools

Four browser tools from the makers of Adinand Email Cleaner, an app for iPhone, iPad and Android that lists your Gmail by sender so you can send a sender's mail to Trash or unsubscribe in one tap. Live at https://adinandemail.com/tools/.

| Tool | Live page | File |
|---|---|---|
| Email hoarder calculator | https://adinandemail.com/tools/email-hoarder-calculator | `tools/email-hoarder-calculator.html` |
| Gmail cleanup query builder | https://adinandemail.com/tools/gmail-cleanup-query-builder | `tools/gmail-cleanup-query-builder.html` |
| Inbox time-cost calculator | https://adinandemail.com/tools/inbox-time-calculator | `tools/inbox-time-calculator.html` |
| Storage diagnoser | https://adinandemail.com/tools/storage-diagnoser | `tools/storage-diagnoser.html` |

## No libraries, no network calls

Each tool is one HTML file with its script inline. It loads no libraries and sends nothing anywhere; every number is worked out in the page. Nothing to install and no tests to run.

## Run it locally

The files keep the website's paths (`/styles.css`), so serve this folder as the web root:

    python3 -m http.server 8000 # then open http://localhost:8000/tools/email-hoarder-calculator.html

The header logo (`/assets/favicon-64.png` on the website) is not part of this repository, so it shows as a missing image locally.

## Source

Mirrored from https://adinandemail.com/tools/ on 1 October 2026. The website is the source of truth; if the two differ, the website wins. Adinand Email Cleaner app: https://adinandemail.com

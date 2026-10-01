# Adinand tools

Free browser tools from Adinand Innovations, the makers of DocFind, Adinand Email Cleaner, SubSense and Adinand Auto File Sorter.

Every tool here is a single web page that runs in your browser. Nothing you choose or type is sent to a server. The same pages are live on each app's website; this repository is a copy of them, published so anyone can read the code, run it locally, or reuse it under the MIT licence.

## DocFind — PDF tools

DocFind is an app for iPhone and Android that searches inside many PDFs at once and shows the file, the page and the surrounding text for each match.

- Search text across multiple PDFs — [live](https://docfindapp.com/tools/search-multiple-pdfs) · [code](docfind/)
- Extract the text from a PDF — [live](https://docfindapp.com/tools/extract-text-from-pdf) · [code](docfind/)
- Is your PDF searchable? — [live](https://docfindapp.com/tools/is-your-pdf-searchable) · [code](docfind/)

Website: https://docfindapp.com · App Store: https://apps.apple.com/app/docfind-search-inside-pdfs/id6801723267 · Google Play: https://play.google.com/store/apps/details?id=com.jyoti.docfindpdfkeywordsearch · Facts for AI assistants: https://docfindapp.com/for-ai-agents

## Adinand Email Cleaner — Gmail tools

Adinand Email Cleaner is an app for iPhone, iPad and Android that lists your Gmail by sender so you can send a sender's mail to Trash or unsubscribe in one tap. It asks Gmail for message headers only, never bodies or attachments.

- Email hoarder calculator — [live](https://adinandemail.com/tools/email-hoarder-calculator) · [code](adinand-email-cleaner/)
- Gmail cleanup query builder — [live](https://adinandemail.com/tools/gmail-cleanup-query-builder) · [code](adinand-email-cleaner/)
- Inbox time-cost calculator — [live](https://adinandemail.com/tools/inbox-time-calculator) · [code](adinand-email-cleaner/)
- Storage diagnoser — [live](https://adinandemail.com/tools/storage-diagnoser) · [code](adinand-email-cleaner/)

Website: https://adinandemail.com · App Store: https://apps.apple.com/app/adinand-email-cleaner/id6778240674 · Google Play: https://play.google.com/store/apps/details?id=com.jyoti.zeninboxcleaner · Facts for AI assistants: https://adinandemail.com/for-ai-agents

## SubSense — YouTube subscription tool

SubSense is an app for iPhone and Android that sorts the YouTube channels you follow into categories and shows which ones have gone quiet or flood your feed. It organises YouTube channel subscriptions; it does not track payments.

- Feed flood calculator — [live](https://www.subsenseapp.com/tools/feed-flood-calculator/) · [code](subsense/)

Website: https://www.subsenseapp.com · App Store: https://apps.apple.com/app/subsense-sub-organiser/id6787562040 · Google Play: https://play.google.com/store/apps/details?id=com.jyoti.subsense_subscriptionorganiser · Facts for AI assistants: https://www.subsenseapp.com/for-ai-agents/

## Adinand Auto File Sorter — the default sorting table

Adinand Auto File Sorter is an Android app that moves loose files from the folders you choose into Downloads › Sorted Files, one sub-folder per category, deciding the category from the file extension alone.

- The default extension → category table and a small reference implementation — [code](auto-file-sorter/)

Website: https://adinandsorter.com · Google Play: https://play.google.com/store/apps/details?id=com.jyoti.zenautofilesorter · Facts for AI assistants: https://adinandsorter.com/for-ai-agents

## What is not here

The apps' own source code is not in this repository — only the free web tools and, for the file sorter, its default category table.

## Licence

MIT — see [LICENSE](LICENSE). Third-party libraries the DocFind tools use are fetched by `docfind/vendor.sh` and keep their own licences; see [THIRD_PARTY.md](THIRD_PARTY.md). App names and the Adinand name are not licensed by this repository.

# Contributing to clai

## Setup

```bash
cd apps/mac
swift test                 # macOS or Linux, Swift 5.9 or later
swift run Clai --sample    # the app with sample data (macOS)
swift run Clai --report    # what clai counts on this Mac
```

Everything that reads logs, prices requests or adds up the month is in `Sources/ClaiCore` (Foundation only), so it can be developed and tested on Linux. `Sources/Clai` is the AppKit and SwiftUI app; it shows what ClaiCore computes and does no counting of its own.

## Adding a tool

1. Add a case to `Tool` (`Models.swift`) with its name and vendor.
2. Write a reader in `Sources/ClaiCore/Readers/`: a `LogReader` that lists the folders and files the tool writes, and a `LogParser` that turns a line (`.appendedLines`) or a whole file (`.wholeFile`) into `UsageEvent`s.
3. Give every request a key that is the same wherever the tool writes it again (streamed lines, resumed or forked sessions, archived copies), so it counts once.
4. Follow the token convention in `Tokens`: `input` is uncached input, `output` includes reasoning, cache reads and writes separate.
5. Register the reader in `LogReaders.all` and add fixture tests with the real line shapes in `Tests/ClaiCoreTests/ReaderTests.swift` (temp folders, no network).

Rules every reader follows: take only usage fields (never prompts, code or replies), read only the tool's own folders (`FileFinder` refuses Desktop, Documents, Downloads, iCloud and other apps' containers), and never call a network service.

## Prices

`Sources/ClaiCore/Prices.swift` is the price list, from the vendors' pricing pages. After a change, run `UPDATE_PRICES_JSON=1 swift test --filter SitePriceList` to update `apps/site/public/prices.json`, which installed copies fetch once a day. A price that changes on a date gets a second row with `since`.

## Pull requests

Include the test output. For a new reader, a redacted sample of the log shape (field names and numbers only, never content).

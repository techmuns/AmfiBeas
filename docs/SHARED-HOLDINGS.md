# Shared monthly holdings collection

AmfiBeas owns the AMC source readers. Both its dashboard and Sattva consume the
same retained snapshots under `public/amc-holdings`. Sattva does not download AMC
workbooks or execute this repository's scripts.

## Cadence and publication

`AMC monthly portfolio fetch` runs throughout the month with a 15-minute target,
and on merges changing the shared collector. GitHub scheduling and source response
times can extend this interval; this is not an instant-publication guarantee.
The existing monthly benchmark refresh stays separate from normal holdings runs.

Four isolated AMC readers run concurrently with a two-minute limit each. One
blocked source cannot prevent other sources from completing. Completed workbook
files are checkpointed, and the next run starts at the saved unfinished file.
All captured monthly buckets are retained. Fresh source reads do not turn a
missing workbook into a sale or delete older schemes.

The workflow commits the raw snapshots and manifest before rebuilding derived
views. A later builder/benchmark failure cannot strand already collected reports.
The existing deployment chain publishes the AmfiBeas dashboard after the run.
Incomplete coverage produces a failed health step after useful data is published.
Manual `commit=false` performs collection and local generation without publishing.
The `backfill` mode uses the same resumable collection, including historical files
where the adapter supports them; it does not claim a complete industry archive.

## Public consumer contract

`coverage.json` has schema version 1, capture state, generation time, target month,
AMFI directory status, per-AMC source checks, and the exact byte size and SHA-256
of every available `<slug>.json` snapshot. Consumers must load all these files
from one repository commit and verify the inventory and checksums before import.
Unsupported versions, missing declared files and mismatched hashes fail closed.
An unavailable AMC can have no file; every source remains represented in coverage.

Source checks distinguish complete checks, partial attempts and unavailable sources.
Validation failures preserve the previous complete-check time. Re-reading this
manifest or committing files must never advance a source's successful-check time.
The legacy index is rebuilt from these same checks for existing consumers.
`coverage-checks.json` retains continuation URLs between scheduled runners.

The AMFI public portfolio directory is checked each run. New fund houses enter the
inventory, including those without a published download page. They remain visibly
unavailable until supported disclosures are verified. A failed directory read or
missing prior directory member prevents a claim of complete coverage.

## Source coverage

The shared readers include the reviewed direct routes for 360 ONE, Axis, LIC,
Quant, Mirae, Union, Sundaram, Angel One, Bandhan, Quantum, Abakkus and Old Bridge,
plus the existing first-party HTTP adapters for other fund houses. Public pages,
pagination, date labels, allowed file hosts and reporting months are verified.
Access refusals remain unavailable; the collector does not rotate identities or
solve challenges. Trendlyne is not a required source.

Mirae's current and preceding three months are traversed to restore comparison
baselines. Validated overseas-only, bullion and overnight statements can establish
no Indian holdings; unclassified positions cannot. Descriptive name changes use
an unambiguous prior identity, never fuzzy joining of plans or funds.

This source contract does not certify every historical upstream observation.
Current-month duplicate quantities, dates and ambiguous instruments mark coverage
partial. Downstream ownership calculations retain their own instrument checks.
Some AMC endpoints remain inaccessible, and some catalogue members have no monthly
download page. Coverage must remain partial until those gaps are resolved.

## Verification

`npm run test:holdings` covers public catalogue pagination, month rollover,
per-file resumption, refusals, exact identities, verified empty reports, source
isolation, process timeouts, source clocks, directory growth/failure and manifest
hashes. Run `npm run lint`, `npm run typecheck`, and `npm run build` before merging.
Live source tests write only to an isolated `AMFIBEAS_PATH`; they do not publish.


### Catalogue and workbook reconciliation

The collector reads the current official download catalogues for HDFC, Canara Robeco,
JioBlackRock, HSBC, Navi, Bajaj Finserv, AlphaGrep, Choice, Zerodha and IL&FS, alongside the existing
AMC adapters. Public website configuration is rediscovered when each source is
checked; private sessions and challenge bypasses are not used. Catalogue periods,
pagination, duplicate IDs, published totals and file-host allowlists are validated.
A refusal stops requests to that host for the pass; only transient network/server
errors receive bounded retries.

Per-file checkpoints now include `byMonth` and `fileFailures`. Current-month files
run before historical continuations. An interrupted history backfill does not
invalidate an independently completed current-month check. Legacy page/API
adapters propagate expected, completed and failed file counts. A valid subset
cannot hide a failed file, and filename dates never overwrite actual workbook dates.
The shared collector also rejects sheets containing Indian securities that the
parser could not read, including failures inside ZIP archives.

Scheme title parsing distinguishes real names from section headings and category
descriptions. Explicit cash-equity and arbitrage lots for the same instrument are
summed; same-section duplicates remain validation errors. Overseas-only reports
can establish zero Indian holdings only after checks of scheme identity, reporting
date, every holding row and total assets. IL&FS fortnightly sheets are excluded
only when matching month-end portfolios exist for every disclosed scheme.

`coverage.current` counts successfully checked, validated AMC reports, not a
claim of independently audited coverage of every active scheme in the industry.
Unavailable catalogues, unpublished reports, changed formats, unclassified
instruments and missing active-scheme inventory must remain visible gaps. An
external source's future publication time cannot be guaranteed.

Edelweiss, Tata and Bajaj Finserv use the public AdvisorKhoj catalogue for exact
published links, then fetch only the verified AMC file hosts. Bajaj's consolidated
workbook is served by its official media host even when the catalogue page is
unavailable. Index discovery does not substitute for access to or validation of
the actual reports.

ASK, Monarch and Lakshya now have first-party readers independent of missing AMFI
directory links. ASK and Monarch accept only published month-end monthly entries;
their fortnightly reports do not establish monthly completeness. Monarch's document
pagination must reconcile with its published total. Lakshya's public scheme list
supplies scheme IDs to its own reporting-month download endpoint, and every
returned workbook still passes the same date and instrument checks. A missing
file or unpublished monthly category remains unavailable, including at launch.

Failures retain a bounded `failure` object identifying HTTP status, transport
failure or catalogue validation. It excludes response bodies, headers and URL
queries. Source-file failures carry the same evidence in `fileFailures`. A later
successful check clears an older discovery failure without clearing retained history.
For changed source readers, pull-request CI records a read-only catalogue-access
diagnostic artifact from the hosted runner. This probe does not publish holdings,
dispatch a production job or certify that discovered workbooks are complete.

JM Overnight's numeric month-end date and disclosed CCIL repo/cash layout are
validated explicitly, including rejection of stale/fortnightly dates and unknown
or Indian securities. PR browser diagnostics use ordinary Chromium defaults and
retain a fixed August 2026 regression sample separately from current-month data.
An access refusal remains a refusal; these diagnostics do not alter production.

HDFC's reader enumerates the official monthly page rather than leaving its saved
holdings without an active reader. It checks the scheme filename against the
month-end label and excludes overlap summaries and other months. The report
itself must still pass workbook validation; merely listing files does not establish
coverage. Standard-browser CI diagnostics also check WhiteOak, HSBC and Union to
distinguish obsolete readers from hosted-source connectivity failures.

Public GET downloads may follow up to three redirects, validating every destination
against that AMC's approved HTTPS hosts before requesting it. Redirects never carry
request bodies or source-specific headers. Loops, unapproved destinations, longer
chains and access refusals remain failures. This covers official CMS-to-website
moves such as Tata's workbook links without treating a redirect as a valid workbook.

A successful HTTP header does not certify a downloaded workbook. Partial transfers,
timeouts and broken connections receive the same bounded transport retries even
after HTTP 200. Exhausted transfers retain their transport cause; oversized files
and access refusals are not retried, and interrupted bytes never enter the parser.

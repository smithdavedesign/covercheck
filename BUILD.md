# covercheck — build notes

## Plan

Milestone: **M3 — Demand test and log export** (MVP run, 3 of 3). M1 and M2 are built and their tests stay green.
Planned with gstack's plan-eng-review "Step 0: Scope Challenge", "1. Architecture review" and "3. Test review",
answered non-interactively. Every decision is written down here.

### Step 0 — Scope challenge

1. **What already solves part of it?**
   - CSV export: M2's append-only `checks` table already holds every saved check: vendor, `checked_on`, verdict, expiry
     and per-rule results with labels and reasons. The export is one association-scoped `SELECT` over it plus an encoder.
     Removed vendors' checks stay in the log, because M2 promised "the vendor's check history is kept".
   - Counts: verdicts already flow through `check()` in two routes (`/api/check`, `/api/vendors/:id/check`), and every
     upload goes through `/api/extract`. Counting means one upsert at those three points, with no new flow.
   - Auth: the dashboard's Bearer key (M2) covers the export. The cron route's fail-closed constant-time secret check moves
     into `lib/api.ts` and also guards the counts endpoint, so nothing is duplicated.
   - Landing page: the CTA goes to M1's `/check`, which is already the "upload a certificate" flow. The sample verdict
     on the landing page is the real `check()` output for a sample certificate, rendered with the checker's own `Verdict`
     component, so it can't drift from what the product says.
2. **Minimum set of changes that meets the exit criteria and the three deliverables:**
   - **CSV export of checks:** `GET /api/checks/export` 🔑 → `text/csv` attachment, one row per saved check:
     `Date checked, Vendor, Verdict, Failed rules, Reasons, Certificate expires`. A "Download check log (CSV)" button on the dashboard.
   - **Basic usage counts:** a `usage_counts` table of daily counters (`day, kind ∈ upload/pass/fail, count`).
     `/api/extract` counts an upload, and both check routes count a pass or a fail. `GET /api/usage` (Bearer `STATS_SECRET`)
     returns `{ uploads, passes, fails, days[] }`.
   - **Landing page** at `/` (replaces M1's redirect): the problem, an "upload a certificate" CTA to `/check`, the sample
     verdict, how it works, what it checks, and pricing.
   - **Taking money, the $0 way** (the MVP run must end able to take money, and M2 deferred payments here; there is no
     REVENUE.md, so this is the minimum): price on the landing page ($19/month per association, inside RESEARCH.md's
     $15–25 band) and a **Subscribe** button that opens a **Stripe Payment Link** from `CHECKOUT_URL`. Payment Links have
     no monthly fee, need no Stripe keys and no webhook. The button is hidden until the URL is set, and only `https:` URLs
     are accepted. Plain-English **`/terms`** and **`/privacy`** pages, linked from every page's footer (M2's review left
     "no privacy notice" open for M3). The contact address comes from `CONTACT_EMAIL`, falling back to the address in `EMAIL_FROM`.
   - **Deliberately NOT in M3:**
     - In-app plan gating, Stripe webhooks, Stripe API keys, linking a payment to an association. During the pilot every
       feature stays open, and David matches payments to associations by hand (the Payment Link asks for the association name).
     - Per-association usage stats, charts or an admin page. The counts are one JSON endpoint for the operator.
     - CSV date-range filters, XLSX/PDF export, exporting the reminder log.
     - A waitlist or email-capture form, analytics scripts, cookies. The demand signal is uploads, and the CTA is "check a certificate".
     - Deleting an association in-app (privacy requests go to the contact address), accounts, and everything else M2 deferred.
     - Moving hosting off Vercel Hobby. That is a deploy decision, flagged below as a blocker before the first charge.
3. **Complexity check: triggers.** About 9 new files (`lib/usage.ts`, `lib/csv.ts`, `lib/site.ts`, two routes, `app/landing.tsx`,
   `/terms`, `/privacy`, the screenshot script) and about 10 small edits. One new table, no new service (Stripe is a link, not an integration). Challenged:
   - The three `lib` files have different reasons to change: SQL counters, a pure encoder (security-sensitive and unit-tested
     on its own), and env-derived public config. Merging them into `store.ts` would mix tenant data with global metrics.
   - Two route files come from file-based routing (one per URL). The landing component needs its own file because a Next
     `page.tsx` may only export the page.
   - Reduced: no admin UI for counts, no server-side download token (the dashboard fetches the CSV with its Bearer key and
     saves it as a blob, so there's one auth path), no event log (daily counters stay bounded at 3 rows a day), and `after()` is not used.
   - Decision: proceed with this reduced version.
4. **Search check** (WebSearch):
   - CSV/formula injection: OWASP's current advice is to quote every field, double embedded quotes, and prefix `'` to cells
     starting with `=`, `+`, `-`, `@`, tab or CR. Quoting alone doesn't stop Excel. Sanitize at export, not at storage. Vendor
     names come from the board, and failed reasons quote certificate text, so both are attacker-influenced. [Layer 1]
     A UTF-8 BOM and CRLF line endings make Excel open names like "Café Landscaping" correctly.
   - Post-response work: Next's `after()` needs a request scope and throws when route handlers are called directly (as the
     tests do). Counting is one upsert, so it is awaited inline, inside a try/catch that never fails the user's request
     (and, added in review, never delays it by more than 2 s).
   - **[EUREKA] Taking money at $0:** a Stripe Payment Link is a hosted checkout with no monthly fee, created in the
     dashboard without code (standard 2.9% + 30¢ card fee). It needs no secret in this repo. Building Checkout Sessions plus
     webhooks would add a secret, a webhook route and entitlement state for 5 pilot boards.
   - **Hosting footgun:** Vercel Hobby is non-commercial only, and Vercel counts both processing payments and advertising a paid
     product as commercial. Netlify's free plan allows commercial use. So `CHECKOUT_URL` should only be turned on after
     moving to a free host that allows it (or Vercel Pro, which isn't $0). This is recorded under Infrastructure and as a request for David.
5. **TODOS cross-reference:** no TODOS.md. M2's open items: the privacy notice is bundled here (it is a precondition for charging).
   Reminder abuse controls, rate limits and accounts stay deferred; none of them blocks M3's exit criteria.
6. **Completeness check:** the export covers removed vendors, checks with no failures, no checks at all (header only), another
   association's data, formula and quote injection, non-ASCII names, and 401. Counts cover concurrent increments, all three
   kinds, per-day buckets, every `/api/extract` outcome (decided below), a database failure (the request still succeeds), and a
   fail-closed secret.
7. **Distribution check:** no new artifact. `scripts/screenshots.mjs` is a dev tool, and the app still deploys as one Next.js project.

### 1. Architecture

```
 Visitor ── GET / (static landing) ──► CTA "Check a certificate" ─► /check (M1 flow)
                                        Subscribe ─► CHECKOUT_URL (Stripe Payment Link, hosted by Stripe)
                                        footer ─► /terms, /privacy (static; contact from CONTACT_EMAIL | EMAIL_FROM)

 /check, dashboard ── POST /api/extract ─────────► read PDF ─┐
                    ── POST /api/check ──────────► check() ──┤  trackUsage(kind)  (best-effort, ≤ 2 s, errors logged)
                    ── POST /api/vendors/:id/check ► check() ─┘     INSERT INTO usage_counts (day, kind, 1)
                                                                    ON CONFLICT (day, kind) DO UPDATE SET count = count + 1
 Operator (David) ── GET /api/usage  (Bearer STATS_SECRET) ──► { uploads, passes, fails, days[] }

 Board ── dashboard "Download check log (CSV)" ── GET /api/checks/export (Bearer key) ──►
          checks ⋈ vendors WHERE association = key's association (removed vendors included)
          ORDER BY checked_on, id → toCsv (BOM, CRLF, quoted, formula-safe) → blob → file download
```

- **What counts:** `upload` = a file of at most 4 MB received by `/api/extract`, whether or not it could be read (a scan or
  a broken PDF is still someone trying the product, and a scan tells us OCR is wanted). Malformed requests and oversized
  files don't count. `pass` / `fail` = each verdict returned by either check route. Re-checking after an edit counts
  again, so passes + fails measure checks run, not distinct certificates. Days are UTC dates. No IPs, names or content are recorded.
- **CSV columns:** `Date checked` (the board's local date saved with the check), `Vendor`, `Verdict` (Pass/Fail),
  `Failed rules` (rule labels, `; `-joined), `Reasons` (the plain-English reasons, `; `-joined), `Certificate expires`.
  Rows are chronological. The file is `covercheck-checks-<association-slug>-<date>.csv`, with `Cache-Control: no-store`.
- **Boundaries:** `lib/store.ts` gets `listChecks` (all tenant SQL stays there). `lib/csv.ts` is the pure encoder plus the
  check-log format. `lib/usage.ts` holds the counters' SQL and `trackUsage`. `lib/site.ts` holds the price, `CHECKOUT_URL`
  and contact-address validation. `lib/api.ts` gets `requireBearerSecret` (shared by cron and usage). Routes stay parse → lib → respond.
- **Security:** the export filters by the authenticated association (another board's checks never appear). The counts are
  operator-only behind a fail-closed constant-time secret. The checkout URL must parse as `https:`, so a `javascript:` value
  can't become a link. All SQL is parameterized. The CSV is formula-safe. Private responses are `no-store`.
- **Production failure scenarios:**
  | Codepath | Realistic failure | Handled? |
  |---|---|---|
  | Usage | Neon down or `DATABASE_URL` missing during an upload | Yes: counting is best-effort. The upload or check still answers, and the log line has the error name only (tested) |
  | Usage | Neon slow (cold compute) or a hung connection | Yes (added in review): the request waits at most 2 s for its count, then answers. That count may be lost (tested with fake timers) |
  | Usage | Two uploads in the same instant | Yes: one atomic upsert per event, no read-modify-write (tested concurrently) |
  | Usage | First `/api/extract` on a cold instance now opens the database | Accepted: one schema check per instance (≈100–300 ms once). Extraction itself is unchanged |
  | Usage | `STATS_SECRET` unset ("Bearer undefined" attack) | Yes: 503, fails closed (tested) |
  | Export | Vendor named `=HYPERLINK(…)` or a certificate holder quoted in a reason | Yes: `'` prefix plus quoting (tested, and verified on the live server) |
  | Export | Board has no checks yet | Yes: header row only, still a valid file (tested) |
  | Export | Download blocked or the key is stale | Yes: the dashboard shows the API's message (tested in the browser test) |
  | Landing | `CHECKOUT_URL` misconfigured (`http:`, `javascript:`, garbage) | Yes: ignored, no Subscribe button (tested) |
  | Landing | `CHECKOUT_URL` set on Vercel Hobby | Not in code: a ToS issue, documented under Infrastructure. Turn it on only on a commercial-use host |
- **Scaling:** counters grow by at most 3 rows a day. The export is O(checks of one board): about 500 rows a year for a 40-vendor board.

### 3. Test plan

Vitest, no network, no secrets (the stats secret is built at runtime). DB tests use in-memory PGlite with the production schema.

| Area | Tests |
|---|---|
| **Exit M3-1** `GET /api/checks/export` | Seeded board: 3 vendors, 4 checks (one vendor checked twice, one removed vendor), plus another board's check. The parsed CSV has exactly one row per check, with vendor, date, verdict and failed rules (labels and reasons), chronological. The other board's check is absent. `text/csv` attachment with filename, `no-store` |
| **Exit M3-2** `GET /api/usage` | Usage recorded from the fixture `tests/fixtures/usage-events.json` → `uploads` equals the fixture's upload count, plus passes, fails and the per-day breakdown. End to end: 3 real PDF uploads to `/api/extract` → `uploads: 3` |
| CSV encoder | Commas, quotes, CR/LF quoted; `= + - @ \t \r` (also after leading spaces) prefixed with `'`; ordinary hyphens mid-text untouched; null → empty; BOM; CRLF; header-only file; filename slug (non-ASCII, punctuation, empty, long) |
| Export route | 401 without/with bad key; no checks → header only; a passing check → empty failed columns |
| Usage store | Concurrent increments are exact; kinds stay separate; days ascending; empty → zeros; unknown kind rejected by the DB |
| Usage tracking | `/api/extract` counts read, scanned (`no_text`), broken and non-PDF files, and not a missing file or an oversized one. `/api/check` counts pass and fail. `/api/vendors/:id/check` counts its verdict, and a 404 or 400 counts nothing. A database failure doesn't fail the request; a hung database delays it by at most 2 s (added in review) |
| Usage route | No / wrong / non-Bearer secret → 401; `STATS_SECRET` unset (even with "Bearer undefined") → 503; JSON shape; `no-store`. The cron tests still pass after the shared-secret refactor |
| Site config | `CHECKOUT_URL`: https accepted; `http:`, `javascript:`, garbage and empty rejected. Contact: `CONTACT_EMAIL`, else the address inside `EMAIL_FROM` ("Name <addr>" or bare), invalid → none |
| Landing | Server render: CTA link to `/check`; the sample verdict shows real engine reasons (a limit failure and a missing endorsement); the price; the Subscribe link only with a valid checkout URL, otherwise "free during the pilot"; the dashboard link; the page reads `CHECKOUT_URL` from the env |
| Legal pages & layout | `/terms`: not proof of coverage, not advice, Stripe billing, cancel, contact shown when set. `/privacy`: what's stored, PDFs never stored, usage counts are anonymous, processors, deletion by request. Layout: brand → `/`, footer links to terms and privacy |
| Dashboard (happy-dom) | "Download check log (CSV)" fetches the export with the Bearer key and saves a blob under the server's filename. A failed export shows the API's message |
| DB layer (added during the build) | `PGLITE_DIR` moves the local database; missing parent directories are created (a fresh clone has no `.data/`) |

## Decisions still in force from M1 and M2

Abridged; the full reasoning is in git history.

- **Rules decide, and fail closed** (M1): a value the extractor couldn't find fails its rule, never passes it. Every
  extracted field is shown for confirmation. A vendor's check is saved only by "Confirm and save" (M2 review fix).
- **Dates** (M1): ISO `YYYY-MM-DD` calendar dates. Coverage ends at 12:01 AM on the expiration date, so expiry on today's
  date counts as expired. A check's "today" is the board's local date (`asOf`), accepted within ±1 day of the server's UTC date.
- **Extraction** (M1): deterministic, label-anchored parsing of the ACORD 25 layout (`unpdf` text layer plus fillable-form
  widget values). No LLM, no OCR; scanned PDFs fall back to manual entry. PDFs are capped at 4 MB / 20 pages and never stored.
- **Access without accounts** (M2): creating an association returns a random 256-bit key. The dashboard link is
  `/dashboard#k=<key>` (a URL fragment never reaches servers or `Referer`). API calls send it as `Authorization: Bearer`,
  and only its SHA-256 is stored. Every association-scoped query filters by the authenticated association.
- **Database** (M2): Neon Postgres in production (`@neondatabase/serverless`, HTTP). The same SQL runs locally and in tests
  on PGlite. One idempotent schema script runs behind an advisory lock. Dates come back `::text` and counts `::int`. There's no ORM.
- **Status** (M2, derived): `no_certificate` → `expired` → `not_compliant` → `expiring` → `ok`. Certificate expiry = the
  earliest of the GL expiry and (if required) the workers' comp expiry.
- **Reminders** (M2): Vercel Cron daily at 13:00 UTC, windows 30/14/3 days with catch-up, exactly once per window by
  a unique claim, ≤ 40 per run, SMTP via `SMTP_URL` (a Gmail app password at $0), to the vendor with the agent in cc and
  reply-to the board. Delivery is at most once if a run dies mid-send.
- **"Request updated certificate"** (M2): a `mailto:` draft sent from the board member's own mail client. There's no server send path.

## What the product does now (after M3)

Five pages, with the header linking to the checker and dashboard and the footer to pricing, terms and privacy:

- **`/`: the landing page** (new). It says what's wrong with "we have a certificate on file". The main CTA,
  **Check a certificate free**, opens the checker, and **Track all your vendors** opens the dashboard. Below that: a sample
  verdict for a roofer's certificate, which is the rules engine's real output (a $500,000 limit below the $1M requirement,
  CG 20 37 missing, workers' comp expiring soon), then how it works, what it checks, and pricing. The pricing section shows
  **$19 per month per association**. With `CHECKOUT_URL` set it shows a **Subscribe** button to the Stripe Payment Link;
  otherwise it says "Free during the pilot".
- **`/check`: the certificate checker** (M1, plus M2's vendor mode). Upload an ACORD 25 PDF, confirm the values read,
  and get pass/fail per requirement with a one-line reason. Every upload and verdict is now counted (anonymously).
- **`/dashboard`: the vendor dashboard** (M2). Vendors soonest expiry first, with status colours, failed reasons, "Check
  certificate", "Request updated certificate" and "Remove". New: **Download check log (CSV)**, every check saved for the
  board's vendors (removed ones included) with date, vendor, verdict, failed rules, reasons and certificate expiry, ready for
  board minutes. On a phone the vendor table becomes one card per vendor.
- **`/terms` and `/privacy`** (new): plain-English terms (checklist not advice, billing, cancel and refund, liability) and a
  privacy notice (what's stored, that PDFs never are, the anonymous usage counts, processors, deletion on request). Both show
  the contact address when one is configured.
- **Automatic reminders** (M2): unchanged.

API (JSON unless noted; `Authorization: Bearer <key>` where marked 🔑):

| Endpoint | Does | Errors |
|---|---|---|
| `GET /api/checks/export` 🔑 (new) | `text/csv` attachment `covercheck-checks-<association>-<date>.csv`, one row per saved check: `Date checked, Vendor, Verdict, Failed rules, Reasons, Certificate expires` | 401 |
| `GET /api/usage` (Bearer `STATS_SECRET`, new) | `{ uploads, passes, fails, days: [{ date, uploads, passes, fails }] }`, days in UTC | 401, 503 `stats_not_configured` |
| `POST /api/associations` `{ name, contactEmail, requirements? }` | 201 `{ association, key }` | 400, 413 |
| `GET /api/vendors` 🔑 | `{ association, today, vendors[] }`, vendors ordered by expiry ascending | 401 |
| `POST /api/vendors` 🔑 `{ name, contactEmail, agentEmail? }` | 201 `{ vendor }` | 400, 401, 409 |
| `DELETE /api/vendors/:id` 🔑 | 204 | 401, 404 |
| `POST /api/vendors/:id/check` 🔑 `{ fields, asOf? }` | Verdict plus the updated `vendor`; saved; the verdict is counted | 400, 401, 404 |
| `GET /api/cron/reminders` (Bearer `CRON_SECRET`) | `{ date, sent, failed, deferred }` | 401, 503 |
| `POST /api/extract` (multipart `file`), `POST /api/check` | As in M1; the upload / verdict is counted | as in M1 |

Code map: new in M3: `lib/usage.ts` (counters), `lib/csv.ts` (encoder and check log), `lib/site.ts` (price, checkout,
contact), `app/api/checks/export/`, `app/api/usage/`, `app/landing.tsx`, `app/terms/`, `app/privacy/`,
`scripts/screenshots.mjs`. Changed: `lib/store.ts` (`listChecks`), `lib/db.ts` (`usage_counts`, `PGLITE_DIR`, parent directories),
`lib/api.ts` (`requireBearerSecret`), the three counting routes, the cron route (shared secret check), `app/dashboard/dashboard.tsx`
(download button, phone layout), `app/check/checker.tsx` (exported `Verdict`, drawn ✓/✗ marks), `app/layout.tsx`, `app/globals.css`.

## Run locally

Node 22 or newer (22.18+ for `npm run screenshots`, which imports a TypeScript test helper directly).

```bash
npm install          # works with npm_config_ignore_scripts; no package needs an install script
npm test             # vitest: 347 tests in 20 files, no network, no secrets
npm run typecheck
npm run dev          # http://localhost:3000 (landing), /check, /dashboard, /terms, /privacy
npm run build && npm start   # production build
npm run screenshots  # builds, starts the app on a throwaway database, saves docs/screenshots/*.png (needs CHROMIUM_PATH)
```

- **Database:** with no `DATABASE_URL`, the app uses a local PGlite database in `.data/pglite` (gitignored), created with its
  schema on first use (`PGLITE_DIR` moves it). Set `DATABASE_URL` in `.env.local` to use Postgres/Neon instead. On Vercel
  (`VERCEL` set) it refuses to start without `DATABASE_URL`.
- **Usage counts locally:** put any long random `STATS_SECRET` in `.env.local`, then
  `curl -H "Authorization: Bearer <that value>" http://localhost:3000/api/usage`.
- **Checkout and contact locally:** `CHECKOUT_URL` (an `https:` Payment Link) and `CONTACT_EMAIL` in `.env.local`. They are read
  when the static pages are built, so restart `npm run dev` or rebuild after changing them.
- **Reminders locally:** `CRON_SECRET`, `SMTP_URL` and `EMAIL_FROM` in `.env.local` (Mailpit works as `SMTP_URL=smtp://localhost:1025`),
  then call `GET /api/cron/reminders` with `Authorization: Bearer <your CRON_SECRET>`.
- **Screenshots:** `CHROMIUM_PATH` must point at a Chromium/Chrome binary (Playwright never downloads one). The script seeds
  sample data through the app's own API, into `.data/screenshots` with `DATABASE_URL` forced empty, so it can't touch a real database.

## Deploy (free tier)

Vercel Hobby + Neon free tier + a free SMTP account, $0 for the free pilot:

1. The pipeline runs `.provision`: a Neon Postgres database (`DATABASE_URL`), the Vercel project, and `DATABASE_URL` pushed to its env.
2. David stores `SMTP_URL`, `EMAIL_FROM`, `CRON_SECRET` and `STATS_SECRET` through the credential broker and pushes them to the
   Vercel env (the `request` lines in `.provision`).
3. Import the repo into the Vercel project (or `npx vercel --prod`). Framework preset Next.js, default build. `vercel.json`
   registers the daily cron (`0 13 * * *`). The schema, including the new `usage_counts` table, is created on the first request.
4. Check it: open `/`, click "Check a certificate free", upload a certificate; create an association on `/dashboard`, add a
   vendor, save a check, download the check log; then `GET /api/usage` with the stats secret shows the upload and the verdicts.

**Taking money** (the last `request` line in `.provision`): create a Stripe Payment Link ($19/month, recurring, with a custom
field for the association name), set `CHECKOUT_URL` and `CONTACT_EMAIL`, and redeploy (the landing and legal pages are static).
**Do this only on a host that allows commercial use.** Vercel Hobby doesn't (payments and advertising a paid product both count).
Netlify's free plan does, and runs Next.js; the daily reminder job would then need a Netlify scheduled function or a GitHub
Actions cron calling `/api/cron/reminders` with the `CRON_SECRET`. The other option is Vercel Pro, which isn't $0. Until then,
leave `CHECKOUT_URL` unset; the pricing section says "Free during the pilot".

## Exit criteria

Both M3 exit criteria pass, and M1's five and M2's three still pass (`npm test`: 347 tests in 20 files, all green;
`npm run typecheck` and `npm run build` succeed).

| # | Exit criterion | Tests | Status |
|---|---|---|---|
| M3-1 | CSV export contains one row per check with vendor, date, verdict and failed rules | `tests/export.test.ts` › "exit criterion M3-1" (one row per check incl. a removed vendor, another board's check absent, headers, header-only file, formula-safe vendor name, 401s) | ✅ pass |
| M3-2 | Counts endpoint returns the number of uploads recorded in a test fixture | `tests/usage.test.ts` › "exit criterion M3-2" (`tests/fixtures/usage-events.json`: 7 uploads, 4 passes, 3 fails over 3 days; and 3 real PDF uploads through `/api/extract`) | ✅ pass |
| M2-1…3 | Reminder exactly once at 30 days; none at 31 days; dashboard ordered by expiry | `tests/reminders.test.ts`, `tests/api-cron.test.ts`, `tests/api-vendors.test.ts`, `tests/store.test.ts` | ✅ pass |
| M1-1…5 | Limits, expiry, named insured, AI endorsement, extraction | `tests/check.test.ts`, `tests/extract.test.ts` | ✅ pass |

The roadmap's M3 deliverables all exist: the landing page with the upload-a-certificate CTA (`/`), the CSV export of checks
(`GET /api/checks/export` plus the dashboard button), and basic usage counts for uploads, passes and fails (`GET /api/usage`).

**Verified live here** (`next start` on the production build, local PGlite): the screenshot run uploads a real generated ACORD 25
PDF on `/check` and gets the verdict, and renders the seeded dashboard. A smoke run against the same server downloaded the CSV
(correct headers, formula-safe vendor cell), got 401 without a key, read `/api/usage` with a stats secret (counts matched
the checks made) and 401 with a wrong one, and loaded `/`, `/terms` and `/privacy` (200). **Not verified here:** Neon, a real
SMTP send, Vercel Cron, and Stripe.

## Infrastructure

`.provision` asks for:

- `neon db covercheck` → `DATABASE_URL` (Postgres, Neon free tier).
- `vercel project covercheck`: the Vercel Hobby project.
- `vercel env covercheck DATABASE_URL`: in case the project was created before the database.
- `request` **SMTP account** → `SMTP_URL` + `EMAIL_FROM` (M2). A dedicated Gmail account with an app password at $0.
- `request` **`CRON_SECRET`** (M2): random, ≥ 32 characters. The cron route refuses to run without it.
- `request` **`STATS_SECRET`** (new): random, ≥ 32 characters, in the Vercel env and David's keychain. It guards `GET /api/usage`.
- `request` **Payments** (new): a Stripe account and a $19/month Payment Link → `CHECKOUT_URL` (public, not a secret), plus
  `CONTACT_EMAIL` for the legal pages, and the commercial-use hosting decision above before turning checkout on.

The code reads `DATABASE_URL`, `SMTP_URL`, `EMAIL_FROM`, `CRON_SECRET`, `STATS_SECRET`, `CHECKOUT_URL`, `CONTACT_EMAIL`
(plus `PGLITE_DIR` locally and Vercel's own `VERCEL`) from the environment. Tests never need real values.

## What's left

- **Before charging:** move to a commercial-use host (or Vercel Pro), create the Payment Link, and set `CHECKOUT_URL` and
  `CONTACT_EMAIL`. The terms and privacy notice are plain-English drafts; have them reviewed, and confirm the refund promise
  (14 days) and the 30-day notice before limits.
- **Paid-plan mechanics:** linking a Stripe payment to an association (webhook + secret), plan limits for non-paying boards,
  cancel/refund handling beyond email. Today payments are matched by hand from the association name the Payment Link collects.
- **Before public launch** (from M2, more relevant now that the landing page invites visitors): verify the board's email before
  reminders go out (double opt-in), a per-association daily send cap, and rate limits on association creation and the public
  endpoints (`/api/extract`, `/api/check`).
- **Demand test** (PRD success metrics, by hand): post in HOA communities, watch `GET /api/usage` for 5 uploads within 3 weeks,
  ask those boards about paying $15–25/month, and measure extraction accuracy on 30 real certificates.
- An in-app way to delete an association (today: by request to the contact address), accounts and link recovery, editing
  requirements and vendors, reminder history on the dashboard, per-association time zones.
- From M1: OCR for scans, job-end-date and blanket-AI-form rules.
- `tests/probe.test.ts` holds the DB-layer tests. Renaming it to `tests/db.test.ts` is safe (the sandbox doesn't allow renames).
- `.data/smoke.mjs` is a throwaway live-smoke script left in the gitignored `.data/` (the sandbox didn't allow deleting it). Delete it.

## Review

Self-review of the M3 changes against gstack's "Review Categories" and "Fix-First Heuristic". Everything except README.md
is untracked, so `git diff` shows only README.md; every new or changed file was read in full. Findings use
`[severity] (confidence) file — description`.

**Pass 1 — CRITICAL: one found and fixed (a latent M2 bug), none open.**
- **Fixed** `[P1] (10/10) lib/db.ts connect`: PGlite creates its data directory but not missing parents, so on a fresh clone
  (no `.data/`) every database route of `npm run dev` / `npm start` answered 500 (`ENOENT … mkdir`). Found by the first live
  screenshot run (M2 couldn't start a server). The parent directories are now created; the regression test uses a nested path.
- SQL & data safety: the new queries (`listChecks`, `recordUsage`, `usageCounts`) are parameterized, and the export is scoped to
  the authenticated association (tested with another board's data). No N+1: the export is one join.
- Race conditions: counters are one atomic `INSERT … ON CONFLICT DO UPDATE SET count = count + 1` (25 concurrent increments
  tested). No new check-then-set.
- Unsafe output: no `dangerouslySetInnerHTML`. `CHECKOUT_URL` must parse as `https:` before it becomes an `href`
  (a `javascript:` value is tested), and the contact address is validated before it becomes a `mailto:`. The CSV, the
  export's equivalent of unsafe HTML, is formula-safe and quoted (tested, and checked on the live server).
- LLM output trust boundary: no LLM.
- Enum completeness: the new `UsageKind` (`upload`/`pass`/`fail`) was traced through the DB `CHECK`, the three `FILTER`
  sums, and both `trackUsage(result.verdict)` call sites (`verdict` ⊂ `UsageKind`, checked at compile time). The verdict
  card's marks still cover pass/fail/warn.
- Secrets: `STATS_SECRET` uses the cron route's fail-closed constant-time check, now shared in `lib/api.ts` (M2's cron tests
  pass unchanged). Usage errors are logged by name only. Test secrets are built at runtime, and the repo scan for credential-shaped strings is clean.

**Pass 2 — INFORMATIONAL:**
- **Fixed** `[P2] (8/10) lib/usage.ts trackUsage`: the count was awaited without a limit, so a slow Neon cold start or a hung
  connection would have delayed every upload and verdict. Now the request waits at most 2 s, then answers. Tested with
  fake timers, and the quick path is tested not to wait.
- **Fixed** `[P2] (9/10) app/globals.css`: on phones the vendor table was cut off on the right (seen in the first mobile
  screenshot). It is now one card per vendor with labelled dates.
- **Fixed** `[P3] (9/10) app/check/checker.tsx`, `app/globals.css`: ✓/✗ rendered as empty boxes where no symbol font has them,
  and `system-ui` fell back to a monospace font on Linux. The marks are drawn as inline SVG, and the font stack names fonts explicitly.
- **Fixed** `[P3] (8/10) app/dashboard/dashboard.tsx`: the actions cell was a `display: flex` `<td>`, which broke row borders and
  table-cell semantics. The flex layout moved to an inner `div`.
- Open `[P1] (7/10)` (from M2, unchanged): abuse of reminders. Anyone can create an association and add arbitrary addresses as
  vendors. The landing page now sends visitors there, so double opt-in of the board email and a per-association cap are needed
  before posting widely. Not auto-fixed: it changes onboarding (a design decision).
- Open `[P2] (7/10)`: no rate limits on `/api/associations`, `/api/extract` or `/api/check`. Counting adds a write per request,
  so a flood also inflates the demand-test numbers. Read the counts alongside Vercel's request logs.
- Open `[P3] (7/10) lib/usage.ts`: counts are approximate. A count that times out, or whose function is frozen after the
  response, is lost. Passes and fails count verdicts (a re-check counts again), not certificates. Documented above.
- Open `[P3] (6/10)` time windows: usage days are UTC dates, while the CSV's "Date checked" is the board's local date. A US
  evening upload counts on the next UTC day. Fine for weekly demand numbers.
- Open `[P3] (6/10) app/page.tsx`, `app/terms`, `app/privacy`: `CHECKOUT_URL` and `CONTACT_EMAIL` are read when the static pages
  are built, so changing them needs a redeploy (documented in Deploy).
- Open `[P3] (5/10) lib/db.ts`: the Neon path is still not exercised against a live database here; the SQL is identical and runs on PGlite.

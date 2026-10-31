# covercheck: launch-ready

What changed for the public launch, how to check it, and what's left for David. What the product does is unchanged;
the only visible product changes are the price ($19 → $15/month, per REVENUE.md) and the button name (Subscribe → Buy).

## What was done

1. **Search and sharing.** Every page sets its own `<title>`, meta description (≤ 160 characters), canonical URL, Open Graph
   tags and a large Twitter card, all through Next's metadata API (`pageMetadata` in `lib/seo.ts`). The 1200×630 share image is
   drawn in code with `next/og` (`app/share-image.tsx`) and rendered once at build time as `/opengraph-image` and `/twitter-image`.
   Every page carries JSON-LD for a `SoftwareApplication` with an `Offer` of $15.00 USD per month. `app/robots.ts` allows
   indexing (except `/api/`) and points at `app/sitemap.ts`, which lists `/`, `/check`, `/privacy` and `/terms`. The dashboard stays
   `noindex` and out of the sitemap because it's reached through private links.
2. **Privacy and terms.** `/privacy` now covers the visit counter: its three signals, what they carry and how to switch it off.
   It still says what a dashboard stores, that PDFs and cookies never are, and names the processors (now including RepoHQ).
   `/terms` has a "No warranty" section and the price, cancel and refund lines. Both give
   [GitHub issues](https://github.com/smithdavedesign/covercheck/issues) as the contact (plus `CONTACT_EMAIL` when it's set).
   Both were already linked from every page's footer.
3. **Payment.** A **Buy · $15/mo** button in every page's header and a **Buy for $15/month** button in the pricing section.
   Both link to `STRIPE_PAYMENT_LINK`, which must be an `https:` URL. When it's unset, both buttons are hidden and pricing
   says "Free during the pilot". The variable is read on the server, so it doesn't need a `NEXT_PUBLIC_` name. No link or key
   is in the code.
4. **Visit beacon** (`lib/beacon.ts`, `app/beacon.tsx`). It POSTs `{"slug":"covercheck","kind":…,"referrer":…}` as JSON to
   `https://idea-factory.1426davejobs.workers.dev/api/ideas/signal` (fire-and-forget, `keepalive`, `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`):
   - `visit`: on every page (the root layout mounts it), once per browser session (`sessionStorage`).
   - `activate`: the first time this browser gets a certificate verdict, once per browser (`localStorage`). **The core action
     is "check a certificate and get the verdict"**: a successful response from `/api/check` (the free checker on `/check`) or
     from `/api/vendors/:id/check` (a dashboard vendor's check).
   - `checkout`: every click (or middle-click) on a Buy button.

   `referrer` is `document.referrer` only when its origin differs from `location.origin`; otherwise it's `null`. Nothing is sent
   when `NEXT_PUBLIC_VERCEL_ENV` isn't `production`, when `navigator.webdriver` is true, when localStorage `repohq:notrack` is
   set, or when site storage is blocked.
5. **`.provision`**: `vercel project covercheck` and the request for the $15/month Stripe Payment Link.
6. **Tests**: 395 in 22 files, all passing. New: `tests/launch.test.tsx` (every page renders; unique titles and descriptions;
   canonical, OG and Twitter tags with the image; JSON-LD; robots and sitemap; the share image is a real 1200×630 PNG) and
   `tests/beacon.test.tsx` (payload and fetch options, once-per-session and once-per-browser, referrer rules, every
   "send nothing" case, Buy click → checkout, first verdict → activate, and a failed check sends nothing). `tests/landing.test.tsx`
   was updated: the Buy button is hidden without `STRIPE_PAYMENT_LINK` in both the header and pricing, the price is $15, and the
   legal pages say what they must.
7. **Screenshots** (`npm run screenshots`, kept out of `npm test`). It builds with the placeholder link `https://example.com/pay`,
   uploads a generated sample ACORD 25 PDF, and saves home, result and pricing+footer at 1280×800 and on an iPhone 13. It also
   checks robots.txt, sitemap.xml and the share image (copied to `.data/share-image.png`), and fails if the beacon tries to
   send anything. The two old dashboard screenshots were replaced by the pricing/footer pair, to stay at six.

### Decisions (nobody to ask, so written down here)

- **$15, not $19:** REVENUE.md's price wins over M3's placeholder. **`STRIPE_PAYMENT_LINK` replaces `CHECKOUT_URL`**, with no
  fallback to the old name: it was never meant to be set on the current host, and two names for one link would drift.
- **Refund line:** REVENUE.md gives no refund policy, so the existing terms stay: cancel any time, the plan ends at the close of the
  month, and a refund of that month if asked within 14 days of a charge.
- **Contact:** GitHub issues, as asked. Issues are public, so both pages warn against posting personal or payment details; the
  `CONTACT_EMAIL` address appears as a private route when it's set.
- **Canonical host:** Vercel's `VERCEL_PROJECT_PRODUCTION_URL` (set on every build and switched to a custom domain
  automatically), falling back to `https://covercheck.vercel.app`. Preview builds point their canonical tags at production.
- **Share image per page:** Next merges metadata shallowly, so a page that sets `openGraph` loses the root's file-based image.
  Each page names `/opengraph-image` and `/twitter-image` itself; the build output was checked for exactly one image tag of each per page.
- **Beacon on the dashboard too:** the root layout mounts it on every page. It never sends the page URL, so the `#k=` dashboard
  key can't leak. When site storage is blocked, nothing is sent (there's no way to send only once without it).
- **JSON content type:** the brief says "POST JSON". From a browser that means a CORS preflight, so this assumes RepoHQ answers
  `OPTIONS` with permissive CORS headers. It can't be verified from here (see "Review").

## How to check it

```bash
npm test                 # 395 tests, no network, no secrets
npm run typecheck
npm run build            # /opengraph-image, /twitter-image, /robots.txt, /sitemap.xml are prerendered
npm run screenshots      # needs CHROMIUM_PATH; saves docs/screenshots/*.png and .data/share-image.png
```

After deploying to production:

- Open `/robots.txt`, `/sitemap.xml` and `/opengraph-image`. View source on `/`: the title, description, canonical, `og:*`,
  `twitter:*` and the `application/ld+json` script should be there.
- Paste the URL into a link-preview checker (opengraph.xyz, LinkedIn Post Inspector) and Google's Rich Results Test.
- In a normal browser window, open the Network tab and load the site: one `POST …/api/ideas/signal` with `kind: "visit"`.
  Check a certificate: one `activate`. Click Buy: one `checkout`. Reloading or checking again sends nothing more.
- Without `STRIPE_PAYMENT_LINK`: no Buy button anywhere, and pricing says "Free during the pilot".

## What's left for David

1. **Stripe payment link.** Create a $15/month recurring Payment Link (`.provision` requests it). Ideally add a custom field for
   the association name and turn on the customer portal for self-cancelling. Paste the link into the Vercel env as
   **`STRIPE_PAYMENT_LINK`** (Production) and **redeploy**; the pages are static and read it at build time.
2. **Hosting before charging.** Vercel Hobby is for non-commercial use only, and a Buy button counts as commercial. Before
   setting `STRIPE_PAYMENT_LINK`, move to Vercel Pro or a free host that allows commercial use (BUILD.md, "Deploy").
3. **Mark your own browser.** On the production site, run `localStorage.setItem('repohq:notrack', '1')` in the developer console
   once per browser you use, so your visits aren't counted.
4. **Check the first signals arrive in RepoHQ** after deploying (the CORS assumption above). Leave Vercel's "Automatically expose
   System Environment Variables" on (the default); without it `NEXT_PUBLIC_VERCEL_ENV` is missing and the beacon stays silent.
5. **Make sure the GitHub repo is public**, or the contact link on `/privacy` and `/terms` leads nowhere for visitors. Optionally
   set `CONTACT_EMAIL` for private requests (deletion, billing).
6. **Custom domain (optional).** Add it in Vercel and make it the production domain. Canonical URLs, the sitemap, robots.txt and the
   JSON-LD follow it on the next deploy, with no code change.
7. Have the plain-English terms and privacy notice reviewed, including the 14-day refund promise.

## Review

Self-review of `git status` / `git diff` (plus the new untracked files, read in full) against gstack's "Review Categories" and
"Fix-First Heuristic". Format: `[severity] (confidence) file — description`.

**Pass 1 — CRITICAL: none found.**
- SQL and data safety, races on data: no SQL or schema changes.
- Unsafe HTML: the only `dangerouslySetInnerHTML` is the JSON-LD. It's constant data plus the site origin, normalized by `new URL`,
  and `<` is escaped (tested with a `</script>` payload).
- Shell injection: the screenshot script spawns `next` with argument arrays.
- LLM trust boundary: no LLM.
- Enum completeness: the new `SignalKind` (`visit`/`activate`/`checkout`) is traced through `ONCE` (checkout deliberately sends on
  every click), the privacy page's list and the tests. The rename `checkoutUrl` → `paymentLink` / `CHECKOUT_URL` →
  `STRIPE_PAYMENT_LINK` was grepped: no stale reader is left in code (BUILD.md's M3 plan keeps the old name as history, with a note).
- Secrets: none in code or tests. The payment link is public and read from the env. The repo scan for credential-shaped strings is clean.

**Pass 2 — INFORMATIONAL:**
- Fixed `[P2] (9/10) lib/seo.ts`: `/check`, `/privacy`, `/terms` and `/dashboard` had no `og:image` or `twitter:image`, because
  shallow metadata merging drops the root's file-based image. Found in the build output; fixed and tested.
- Fixed `[P3] (9/10) app/page.tsx`: the home description was 197 characters and would be cut off in results; now 150, and the
  ≤ 160 limit is tested.
- Fixed `[P3] (8/10) scripts/screenshots.mjs`: without the old dashboard seeding, the first upload met PGlite's cold start and the
  verdict timed out. The run now warms the database first and saves a failure screenshot to `.data/` for debugging.
- Fixed `[P3] (7/10) app/robots.ts`: dropped the non-standard `Host:` line.
- Fixed `[P3] (8/10) lib/seo.ts`: renamed a helper whose name clashed with `app/share-image.tsx`'s `shareImage`.
- Open `[P2] (6/10) lib/beacon.ts`: a JSON body from the browser means a CORS preflight. If RepoHQ doesn't allow it, every
  signal fails silently and the counts stay at zero. This follows the brief ("POST JSON"); check it after deploying (above).
- Open `[P2] (8/10)` hosting: a Buy button on Vercel Hobby breaks its non-commercial terms. Not auto-fixed: it's a business decision
  for David (above).
- Open `[P3] (6/10) lib/beacon.ts`: `sessionStorage` is per tab, so two tabs count two visits. Two tabs reaching their first
  verdict in the same instant could both send `activate`. Both are inherent to the storage-based design and harmless for demand counting.
- Open `[P3] (6/10) app/layout.tsx`, `app/page.tsx`: `STRIPE_PAYMENT_LINK` is baked into the static pages at build time, so changing
  it needs a redeploy (as any Vercel env change does).
- Open `[P3] (5/10) app/landing.tsx`: the "terms" link under the Buy button uses the browser's default link colour (pre-existing,
  cosmetic).
- Still open from M2/M3 (unchanged, see BUILD.md): reminder abuse controls, rate limits on public endpoints.

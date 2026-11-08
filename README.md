# covercheck — vendor insurance certificate checker for HOA boards

## Live

**https://covercheck.1426davejobs.workers.dev**

covercheck runs on a Cloudflare Worker (free plan) since 2026-11-08; Vercel's deployment answered 402. Screenshots of the main flow, taken against the live Worker with Chrome for Testing: the landing page, then a sample certificate (the repo's ACORD 25 fixture as a PDF) uploaded, read and checked. The run counted its two uploads and two verdicts in covercheck's anonymous daily usage counters; nothing else was stored. They live in docs/screenshots/live/, which `npm run screenshots` leaves alone.

| | Desktop (1440×900) | Phone (390×844) |
|---|---|---|
| The landing page on the Worker (no Buy button yet: there's no payment link, so pricing says "Free during the pilot") | <img src="docs/screenshots/live/home-desktop.png" alt="The landing page on the Worker (no Buy button yet: there's no payment link, so pricing says 'Free during the pilot'), desktop" width="520"> | <img src="docs/screenshots/live/home-phone.png" alt="The landing page on the Worker (no Buy button yet: there's no payment link, so pricing says 'Free during the pilot'), phone" width="200"> |
| The core action, step 1: a sample ACORD 25 PDF uploaded on /check and read by the Worker; the board confirms what was read | <img src="docs/screenshots/live/fields-desktop.png" alt="The core action, step 1: a sample ACORD 25 PDF uploaded on /check and read by the Worker; the board confirms what was read, desktop" width="520"> | <img src="docs/screenshots/live/fields-phone.png" alt="The core action, step 1: a sample ACORD 25 PDF uploaded on /check and read by the Worker; the board confirms what was read, phone" width="200"> |
| The verdict: the $500,000 limit and the missing CG 20 37 fail with plain-English reasons; workers' comp gets an "expires soon" warning | <img src="docs/screenshots/live/verdict-desktop.png" alt="The verdict: the $500,000 limit and the missing CG 20 37 fail with plain-English reasons; workers' comp gets an 'expires soon' warning, desktop" width="520"> | <img src="docs/screenshots/live/verdict-phone.png" alt="The verdict: the $500,000 limit and the missing CG 20 37 fail with plain-English reasons; workers' comp gets an 'expires soon' warning, phone" width="200"> |
| Pricing and the footer's Terms and Privacy links | <img src="docs/screenshots/live/pricing-desktop.png" alt="Pricing and the footer's Terms and Privacy links, desktop" width="520"> | <img src="docs/screenshots/live/pricing-phone.png" alt="Pricing and the footer's Terms and Privacy links, phone" width="200"> |

## Screenshots

Captured by `npm run screenshots` from the production build, with sample data only and a placeholder payment link (`https://example.com/pay`).

![Landing page on desktop, with the Buy button in the header](docs/screenshots/home-desktop.png)
The landing page leads with "Check a certificate free" and a sample verdict from the real rules; the header's Buy · $15/mo button appears because a payment link is set.

![Landing page on a phone](docs/screenshots/home-mobile.png)
The same page on an iPhone 13: the brand and the Buy button share the top row, and the call to action stays above the fold.

![Verdict for an uploaded certificate on desktop](docs/screenshots/result-desktop.png)
The core action: a sample ACORD 25 PDF uploaded on `/check` is read and checked; the $500,000 limit and the missing CG 20 37 fail with plain-English reasons, and workers' comp gets an "expires soon" warning.

![Verdict for an uploaded certificate on a phone](docs/screenshots/result-mobile.png)
The same verdict on a phone, one requirement per line.

![Pricing, Buy button and footer on desktop](docs/screenshots/pricing-desktop.png)
The bottom of the landing page: $15 per month per association with the Buy button, and the footer's Pricing, Terms and Privacy links.

![Pricing, Buy button and footer on a phone](docs/screenshots/pricing-mobile.png)
The same pricing section and footer links on a phone.

For self-managed HOA and condo boards and small property managers, it checks each vendor's insurance certificate for the endorsement, name and expiry that actually protect the association, and nudges vendors before coverage lapses, at a board-sized price instead of $99+/month.

- [Research](RESEARCH.md) — findings and sources
- [PRD](PRD.md)
- [Roadmap](ROADMAP.md)
- [Build notes](BUILD.md): what's built, how to run, test and deploy it
- [Launch notes](LAUNCH-READY.md): search and sharing tags, legal pages, Buy button, visit beacon, and what's left before launch

Effort: Medium · Confidence: Low

_Researched by the idea pipeline on 2026-10-11 ([original record](https://github.com/smithdavedesign/idea-factory/tree/main/ideas/covercheck)); repo created on David's go-ahead 2026-10-11._

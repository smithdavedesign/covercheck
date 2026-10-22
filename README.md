# covercheck — vendor insurance certificate checker for HOA boards

## Screenshots

Captured by `npm run screenshots` from the production build, with sample data only.

![Landing page on desktop](docs/screenshots/home-desktop.png)
The landing page leads with the "Check a certificate free" call to action and a sample verdict produced by the real rules.

![Landing page on a phone](docs/screenshots/home-mobile.png)
The same landing page fits an iPhone 13 screen, with the call to action above the fold.

![Verdict for an uploaded certificate on desktop](docs/screenshots/result-desktop.png)
A sample ACORD 25 PDF uploaded on `/check` is read and checked: the $500,000 limit and missing CG 20 37 fail with plain-English reasons, and workers' comp gets an "expires soon" warning.

![Verdict for an uploaded certificate on a phone](docs/screenshots/result-mobile.png)
The same verdict on a phone, one requirement per line.

![Vendor dashboard on desktop](docs/screenshots/dashboard-desktop.png)
The vendor dashboard lists vendors soonest expiry first, with status colours (Expired, Expires soon, OK, Not compliant), failed reasons and one-click actions.

![Vendor dashboard on a phone](docs/screenshots/dashboard-mobile.png)
On a phone, each vendor becomes a card with its status, reasons, expiry and actions.

For self-managed HOA and condo boards and small property managers, it checks each vendor's insurance certificate for the endorsement, name and expiry that actually protect the association, and nudges vendors before coverage lapses, at a board-sized price instead of $99+/month.

- [Research](RESEARCH.md) — findings and sources
- [PRD](PRD.md)
- [Roadmap](ROADMAP.md)
- [Build notes](BUILD.md): what's built, how to run, test and deploy it

Effort: Medium · Confidence: Low

_Researched by the idea pipeline on 2026-10-11 ([original record](https://github.com/smithdavedesign/idea-factory/tree/main/ideas/covercheck)); repo created on David's go-ahead 2026-10-11._

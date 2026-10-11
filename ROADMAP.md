# covercheck — roadmap

## Suggested stack
- Next.js on Vercel Hobby: one codebase for UI and API routes, $0.
- SQLite via Turso or Postgres on Neon free tier: small relational data.
- pdf-parse for the text layer: no cost, no external service.
- LLM extraction through the factory's subscription wrapper: reads messy PDFs; rules stay in code.
- Resend free tier for email: reminders and requests.

## M1 — Check one certificate (weekend)
Deliverables:
- Requirements config (JSON) with default association template.
- `POST /api/check` accepting extracted COI fields plus a requirements config and returning per-rule pass/fail with reasons.
- Upload page: PDF in, extracted fields shown, verdict shown.
- Extraction function turning COI text into the field schema.

Exit criteria (testable):
- check() with GL each-occurrence 1,000,000 against a requirement of 1,000,000 returns pass; with 500,000 returns fail with reason mentioning "limit".
- check() with expiry date earlier than today returns fail reason "expired"; with expiry within 30 days returns pass with warning "expires soon".
- check() with named insured "Acme Landscaping LLC" against vendor name "Acme Landscaping" returns pass; against "Bright Roofing" returns fail reason "named insured mismatch".
- check() with required endorsement CG 20 10 absent from the endorsement list returns fail reason "additional insured endorsement missing".
- Extraction on a fixture text of a sample ACORD 25 returns policy end date and each-occurrence limit matching the fixture values.

## M2 — Vendors and reminders
Deliverables:
- Vendor list with status and expiry sorting.
- Scheduled job sending reminders at 30/14/3 days.
- "Request updated certificate" email template.

Exit criteria:
- Vendor with expiry in 30 days produces exactly one reminder to vendor and agent when the job runs for that date, and none on re-run the same day.
- Vendor with expiry in 31 days produces no reminder.
- Dashboard endpoint returns vendors ordered by expiry ascending.

## M3 — Demand test and log export
Deliverables:
- Landing page with upload-a-certificate CTA.
- CSV export of checks.
- Basic usage counts (uploads, passes, fails).

Exit criteria:
- CSV export contains one row per check with vendor, date, verdict and failed rules.
- Counts endpoint returns the number of uploads recorded in a test fixture.

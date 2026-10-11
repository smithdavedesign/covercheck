# covercheck — PRD

## Problem
Self-managed HOA and condo boards hire landscapers, roofers and plumbers and collect a certificate of insurance from each. A certificate is not coverage: the additional-insured endorsement, the named insured and the expiry date decide whether the association is protected, and volunteers rarely check them or notice a lapse mid-project (habitatmag.com, davis-stirling.com). Existing COI tools start at $99/month and target managers with dozens of vendors.

## Target user
The treasurer or president of a self-managed HOA/condo association with 5–15 recurring vendors, and the owner or office manager of a small property-management company with up to ~40 vendors. Painful moment: a vendor starts a job and the board realises the certificate expired last month or lacks the association as additional insured.

## Competitors & gap
CertShield ($99/mo, 25 vendors), myCOI/TrustLayer (enterprise), CertFocus, SmartCompliance, and spreadsheets (see RESEARCH.md). Gap: a board-sized, board-priced checker with templates for the requirements an association typically sets, plain-English reasons for each failure, and no vendor-onboarding portal.

## MVP scope
- Create an association with a requirements template (GL limits, workers' comp required, additional-insured wording required, certificate-holder name).
- Add a vendor (name, contact email, agent email) and upload a COI PDF.
- Extract named insured, carrier, policy dates, limits and endorsement form numbers; show the extracted fields for human confirmation.
- Pass/fail per requirement with a one-line reason (e.g. "expires 2026-11-01, before job end", "association not named as certificate holder").
- Dashboard of vendors sorted by expiry with status colours.
- Automated email reminders to the vendor and agent at 30/14/3 days before expiry.
- One-click "request updated certificate + endorsement" email using a template.
- Exportable log (CSV) of what was checked and when, for board minutes.

## Non-goals
- Vendor self-service portals, payments, or onboarding forms.
- Verifying with carriers directly or giving legal/insurance advice.
- Enterprise features: SSO, API, multi-property roll-ups.
- Mobile app.

## Success metrics
- Extraction accuracy of at least 90% on named insured, dates and limits across 30 sample ACORD 25 PDFs (measured by hand).
- Landing-page demand test: 5 board members or small managers agree to upload a real certificate, within 3 weeks of posting in HOA communities.
- At least 2 of those say they would pay $15–25/month after seeing the result.
- A full check takes under 60 seconds from upload to verdict.

## Open questions
- Do boards feel this pain enough to pay, or does their management company/broker already cover it?
- Is the endorsement check reliable from the PDF text alone, or are endorsement pages usually missing?
- Where do small boards actually congregate, and is posting allowed?
- Can per-association flat pricing beat $99/month competitors on perceived value?

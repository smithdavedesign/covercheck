# covercheck: road to the first dollar

**Verdict:** Weak evidence that anyone will pay. The pain is real in legal guidance, but I found no board member asking for a tool, and the free alternative (a spreadsheet, or the broker/manager) is strong. The cheapest honest test is to charge $15/month to the first 10 people who upload a real certificate. If none pay, stop.

Evidence strength: problem exists = medium (law/HOA guidance, vendor marketing). Willingness to pay = low (inferred from competitor prices only, no buyer has said it).

## Who pays
The treasurer of a self-managed HOA or condo association with 5–15 recurring vendors. They approve small spend from the association budget, usually without a full board vote. A second buyer is the owner of a 1–3 person property-management firm with up to ~40 vendors. This is a role and a budget line, not a named person yet. Nobody has been identified, and David has no network here.

## What they pay today
- **$0:** a spreadsheet plus a calendar reminder, or nothing. This is the real competitor. It checks expiry only, not the additional-insured endorsement or the named insured.
- [CertShield](https://www.producthunt.com/products/certshield/reviews): from $99/month, with a free 3-certificate audit. Vendor cap per tier is unconfirmed in what I could find.
- [BCS](https://www.getbcs.com/pricing): self-service tier at $0.95 per vendor per month, which is about $10/month for 10 vendors. This is the closest price comparison I found. The cheap per-vendor option already exists, so "cheaper than $99" is not a moat.
- [AffordableHOA](https://www.capterra.com/p/10043205/AffordableHOA/): $49/month for 1–50 units, with vendor COI tracking included in a full HOA platform.
- [Vertikal RMS guide](https://vertikalrms.com/article/how-much-does-coi-tracking-software-cost-2025-pricing-guide/): entry platforms at $800–2,000/year. This is vendor marketing, so treat it as rough.

## Price
**$15/month per association, with a $149/year option later.** It sits above BCS's ~$10 for 10 vendors because it checks endorsements and gives plain-English reasons, and well below $49 and $99. Do not go higher until someone pays. Monthly keeps the ask small for a volunteer treasurer. At this price Stripe fees are about 3.5% ($0.30 + 2.9%), which is acceptable.

## Narrowest version worth paying for
Upload a COI PDF, get pass/fail against the association's requirements with a reason for each failure, and get reminders at 30/14/3 days. The built MVP already covers this. The CSV log for board minutes is a bonus. Nothing more should be built before a payment.

Bonus push: the free tier should be a single check with no signup. The paid trigger is "track my vendors and send reminders", because that needs saved state and recurring value.

## Plan, in order
1. Finish launch-ready: add og:image, robots.txt and sitemap.xml (agent work).
2. Manual accuracy check: run 10–30 real or sample ACORD 25 PDFs by hand. If extraction is below ~90% on named insured, dates and limits, fix that before showing anyone. A wrong pass is worse than no product.
3. David creates a Stripe Payment Link at $15/month, with a customer-portal link for cancelling. This needs no backend. Gate reminders and vendor tracking behind it, manually if need be: after payment, David flips a flag.
4. Post in the channels below. The offer: "Upload one real certificate, free, and I'll show you what it misses."
5. Watch the first few uploads with the owner's permission. Ask the one question that matters: "Would you pay $15/month for the reminders?" Then send the payment link in the same reply.

## Must have before charging
Checkout link, privacy and terms pages (already live), a visible "a certificate is not proof of coverage; not legal or insurance advice" disclaimer, a way to cancel, and a support email address.

## First ten users, by place
Reddit r/HOA and r/condo (answer COI questions helpfully and link only when relevant; check each sub's self-promotion rules first), r/PropertyManagement, and Facebook groups for HOA board members (I could not verify URLs or posting rules, so David must check them). Cold-email the small property-management firms listed in David's own city, because they have the vendors and the budget. Boards in a single city give a tight sample. Expect low volume: 10 uploads probably means 3–5 weeks of daily posting.

## Risks
- Nobody pays; spreadsheets and the broker are good enough. Earlier reviews passed credclock for the same reason.
- Extraction errors give false reassurance, which is a liability risk. The product must show the extracted fields for confirmation and always carry the disclaimer.
- Endorsement pages are often missing from the PDF, which makes the main differentiator unreliable.
- BCS or CertShield could cheaply serve this segment.
- Reddit and Facebook may remove promotional posts.
- Handling vendors' insurance documents means a privacy duty, and uploaded PDFs should be deleted on request.

## Kill criteria
Stop if, after ~25 real certificate uploads or 5 weeks, fewer than 2 people pay $15 or say they would pay when handed the link. Also stop if hand-measured extraction cannot reach 90%.

## Assignment for David
Create the Stripe $15/month payment link, then post one helpful answer with the free-check offer in r/HOA this week.

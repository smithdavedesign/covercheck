# covercheck — research

## Summary
- Self-managed HOA/condo boards and small property managers collect vendor certificates of insurance (COIs) but a COI alone is not coverage: the additional-insured endorsement, named-insured match and expiry are what matter, and volunteers rarely check them.
- Paid COI tools exist but are priced and sold for 20–2,000 unit managers and larger; the cheapest found is CertShield at $99/month for 25 vendors. No tool found is aimed at a volunteer board with 5–15 vendors.
- Opening is a narrow, cheap checker: upload a COI PDF, get a pass/fail against the board's requirements, and automatic renewal nudges to the vendor. Confidence is low: spreadsheets and "good enough" are the real competitor.

## Evidence of the problem
- Guidance for condo boards lists the repeat mistakes: not reviewing the certificate when work starts late, letting work continue after a certificate expires, and assuming someone else handles renewal; neither the managing agent nor the shareholder is normally told when coverage is cancelled. Source: https://habitatmag.com/Board-Talk/sub-contractor2
- HOA-focused sources say a COI does not add the association to the policy; only an endorsement does, and recommend proof sent directly from the carrier because vendors have been known to alter expiry dates on documents. Sources: https://www.davis-stirling.com/HOME/C/Contractor-Insurance , https://www.jaburgwilk.com/?p=4790
- A compliance-platform source says the most common rejection cause is the additional-insured endorsement, then named-insured mismatch and expired COIs. Source: https://netvendor.com/blog/vendor-compliance-requirements-why-theyre-strict-what-it-means-for-your-business
- A South Carolina supreme court decision, as summarised in search results, held a contractor liable for an uninsured subcontractor's employee and found an incomplete certificate is not proper documentation. Single case, state-specific, not verified further (search result summary only). Source: https://sclawyersweekly.com/?p=12758
- Gap in evidence: I found no first-hand board-member complaints (Reddit, forums). Demand is inferred from vendor marketing and legal guidance, not from people asking for a tool.

## Who pays
- **Buyer:** the treasurer or president of a self-managed HOA/condo association, or the owner/office manager of a small property-management company handling roughly 5–40 vendors. HOA budgets can fund a small software line item; a board vote is the purchase process.
- **Price point to test:** about $15–25/month per association, or $149/year flat. This is a guess anchored on the competitor prices below, not a measured willingness to pay.
- **Evidence people pay for something like it today:**
  - CertShield lists "$99 / Monthly (Starter — 25 vendors)", targeting property managers with ~20–2,000 units and small contractors. https://www.saashub.com/certshield-app
  - A COI vendor's pricing guide (vendor marketing, unverified) gives entry-level platforms at $800–$2,000/year for under 50 vendors, and per-vendor prices of C2COI $15–$40, MyCOI $30–$60, SmartCompliance $40–$80. https://vertikalrms.com/article/how-much-does-coi-tracking-software-cost-2025-pricing-guide/
  - CertFocus lists from $6/month on AlternativeTo (unclear tier). https://alternativeto.net/software/certfocus-by-vertikal-rms/about
  - Review sites list SmartCompliance from $1,000 (period unstated). https://www.gartner.com/reviews/product/smartcompliance

## Competitors & alternatives
| Name | Price | Gap |
|---|---|---|
| CertShield | $99/mo for 25 vendors; free 3-certificate audit | Reads ACORD 25 and CG 20 10/20 37 endorsements; sized for managers and contractors, 0 reviews on SaaSHub, nothing board-specific |
| myCOI / TrustLayer | enterprise; $8k–25k/yr per CertShield's claim | Too heavy and expensive for a volunteer board |
| CertFocus (Vertikal RMS) | $7,500 annual minimum (vendor's own guide); $6/mo listing on AlternativeTo | Mismatch between sources; enterprise-oriented |
| SmartCompliance | from $1,000 | Per-user tiers, built for larger programs |
| Spreadsheet + calendar reminder | $0 | Checks expiry only, not endorsements or name mismatch; relies on a volunteer remembering |

## Technical notes
- Input is a PDF (ACORD 25 certificate and, ideally, endorsement pages). Extraction: PDF text layer first, LLM extraction for fields (named insured, carrier, policy number, effective/expiry dates, GL limits, workers' comp, endorsement form numbers such as CG 20 10 and CG 20 37 as named by CertShield's page).
- Rules engine is plain data: each association defines required limits and endorsements; the check returns pass/fail with a reason per rule. The rules, not the LLM, make the decision.
- Reminders: email to the vendor and the vendor's agent at 30/14/3 days before expiry. A plain scheduled job is enough.
- Must show "certificate is not proof of coverage; request carrier-issued confirmation" in output; no legal advice.
- Cost: a few cents of LLM per certificate; free-tier hosting is enough for a demand test.

## Risks & open questions
- Weakest point: no direct evidence boards will pay or that they feel this pain. Earlier reviews passed credclock for a similar expiry tracker where a spreadsheet was good enough.
- CertShield could add a cheaper tier.
- Wrong extraction could give false reassurance; liability and disclaimers matter.
- Reaching boards: no obvious cheap channel besides HOA forums and Facebook groups; David has no network here.
- Open: do boards or their managers already get this from their insurance broker or management company for free?

## Sources
- https://www.saashub.com/certshield-app
- https://vertikalrms.com/article/how-much-does-coi-tracking-software-cost-2025-pricing-guide/
- https://habitatmag.com/Board-Talk/sub-contractor2
- https://www.davis-stirling.com/HOME/C/Contractor-Insurance
- https://www.jaburgwilk.com/?p=4790
- https://netvendor.com/blog/vendor-compliance-requirements-why-theyre-strict-what-it-means-for-your-business
- https://alternativeto.net/software/certfocus-by-vertikal-rms/about
- https://www.gartner.com/reviews/product/smartcompliance
- https://sclawyersweekly.com/?p=12758

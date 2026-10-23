import { ImageResponse } from 'next/og';
import { SHARE_IMAGE_SIZE } from '../lib/seo';
import { PRICE_PER_MONTH_USD } from '../lib/site';

/* The link-preview image, drawn in code and rendered once at build time (app/opengraph-image.tsx, app/twitter-image.tsx). */

// The site's palette (app/globals.css).
const INK = '#1d2430';
const MUTED = '#5b6573';
const LINE = '#d8dde4';
const ACCENT = '#1f5fae';
const STATES = {
  pass: { color: '#1d7a3e', background: '#e8f5ec', path: 'M5 12.5 10 17.5 19 6.5' },
  fail: { color: '#b42318', background: '#fdecea', path: 'M6 6 18 18 M18 6 6 18' },
  warn: { color: '#9a6200', background: '#fff4dc', path: 'M12 5 12 13 M12 18.5 12 19' },
};

/** The landing page's sample verdict (a roofer's certificate, 2 of 9 rules failed), abridged. */
const ROWS: { state: keyof typeof STATES; label: string; reason: string }[] = [
  { state: 'pass', label: 'Named insured', reason: 'matches Bright Roofing' },
  { state: 'fail', label: 'Each occurrence', reason: '$500,000 is below $1,000,000' },
  { state: 'fail', label: 'Endorsements', reason: 'CG 20 37 missing' },
  { state: 'warn', label: 'Workers’ comp', reason: 'expires soon' },
];

function Mark({ state }: { state: keyof typeof STATES }) {
  const { color, path } = STATES[state];
  return (
    <svg width="28" height="28" viewBox="0 0 24 24">
      <path d={path} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function shareImage(): ImageResponse {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', background: '#f6f7f9', padding: 64, gap: 40, color: INK }}>
        <div style={{ display: 'flex', flexDirection: 'column', width: 520 }}>
          <div style={{ fontSize: 40, color: ACCENT, letterSpacing: -1 }}>covercheck</div>
          <div style={{ fontSize: 52, lineHeight: 1.15, marginTop: 36, letterSpacing: -1 }}>
            Is that vendor’s insurance certificate actually protecting your HOA?
          </div>
          <div style={{ fontSize: 26, lineHeight: 1.4, color: MUTED, marginTop: 'auto' }}>
            {`Upload a certificate, get pass or fail with plain-English reasons. Check one free; $${PRICE_PER_MONTH_USD}/month per association for reminders.`}
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            alignSelf: 'center',
            background: '#fff',
            border: `3px solid ${STATES.fail.color}`,
            borderRadius: 16,
            padding: 28,
          }}
        >
          <div style={{ fontSize: 27, color: STATES.fail.color }}>Fail: 2 of 9 requirements not met</div>
          <div style={{ fontSize: 20, color: MUTED, marginTop: 6, marginBottom: 16 }}>Bright Roofing’s ACORD 25</div>
          {ROWS.map((row) => (
            <div
              key={row.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                background: STATES[row.state].background,
                borderRadius: 10,
                padding: '12px 16px',
                marginTop: 10,
              }}
            >
              <Mark state={row.state} />
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontSize: 22 }}>{row.label}</div>
                <div style={{ fontSize: 20, color: MUTED }}>{row.reason}</div>
              </div>
            </div>
          ))}
          <div style={{ fontSize: 16, color: MUTED, marginTop: 16, borderTop: `1px solid ${LINE}`, paddingTop: 12 }}>
            A certificate is not proof of coverage. Not legal or insurance advice.
          </div>
        </div>
      </div>
    ),
    SHARE_IMAGE_SIZE,
  );
}

import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CreateAssociationForm, VendorTable } from '../app/dashboard/dashboard';
import type { VendorView } from '../lib/store';

const key = 'k'.repeat(43);

function vendor(patch: Partial<VendorView>): VendorView {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Acme Landscaping',
    contactEmail: 'office@acme.example',
    agentEmail: 'certs@agent.example',
    expiryDate: '2026-11-21',
    verdict: 'pass',
    checkedOn: '2026-10-22',
    failedReasons: [],
    status: 'expiring',
    statusLabel: 'Expires soon',
    daysLeft: 30,
    requestHref: 'mailto:office@acme.example?cc=certs%40agent.example&subject=S&body=B',
    ...patch,
  };
}

describe('vendor dashboard', () => {
  it('offers to create an association with the default requirements', () => {
    const html = renderToString(<CreateAssociationForm onCreated={() => {}} />);
    expect(html).toContain('Association name');
    expect(html).toContain('Board contact email');
    expect(html).toContain('value="1000000"');
    expect(html).toContain('CG 20 10, CG 20 37');
    expect(html).toContain('Create dashboard');
  });

  it('renders vendors in the order given, with status, expiry and actions', () => {
    const vendors = [
      vendor({ id: 'a1111111-1111-4111-8111-111111111111', name: 'Alpha Pools', status: 'expired', statusLabel: 'Expired', expiryDate: '2026-10-01', daysLeft: -21 }),
      vendor({ id: 'b1111111-1111-4111-8111-111111111111', name: 'Bravo Roofing' }),
      vendor({
        id: 'c1111111-1111-4111-8111-111111111111',
        name: 'Charlie Paving',
        status: 'no_certificate',
        statusLabel: 'No certificate',
        expiryDate: null,
        daysLeft: null,
        verdict: null,
        checkedOn: null,
        agentEmail: null,
      }),
    ];
    const html = renderToString(<VendorTable vendors={vendors} dashboardKey={key} onRemove={() => {}} />);

    const order = ['Alpha Pools', 'Bravo Roofing', 'Charlie Paving'].map((name) => html.indexOf(name));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    expect(html).toContain('status-expired');
    expect(html).toContain('status-expiring');
    expect(html).toContain('status-no_certificate');
    expect(html).toContain('expired 21 days ago');
    expect(html).toContain('in 30 days');
    expect(html).toContain(`href="/check?vendor=a1111111-1111-4111-8111-111111111111#k=${key}"`);
    expect(html).toContain('href="mailto:office@acme.example?cc=certs%40agent.example&amp;subject=S&amp;body=B"');
    expect(html).toContain('Request updated certificate');
    expect(html).toContain('Remove');
  });

  it('explains an empty vendor list', () => {
    const html = renderToString(<VendorTable vendors={[]} dashboardKey={key} onRemove={() => {}} />);
    expect(html).toContain('No vendors yet');
  });
});

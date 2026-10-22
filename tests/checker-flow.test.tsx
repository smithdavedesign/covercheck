// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Checker } from '../app/check/checker';
import { DISCLAIMER } from '../lib/check';
import { DEFAULT_REQUIREMENTS, emptyFields } from '../lib/schema';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const key = 'Ab3_-'.repeat(8) + 'xyz';
const vendorId = '11111111-1111-4111-8111-111111111111';
const verdict = { verdict: 'pass', asOf: '2026-10-22', results: [], warnings: [], disclaimer: DISCLAIMER };

interface Call {
  url: string;
  method: string;
  authorization: string | null;
  body: unknown;
}

let calls: Call[];
let container: HTMLDivElement;
let root: Root;

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A fake covercheck API that records every call the page makes. */
async function fakeApi(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = String(input);
  const headers = new Headers(init.headers);
  calls.push({
    url,
    method: init.method ?? 'GET',
    authorization: headers.get('authorization'),
    body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
  });
  if (url === '/api/vendors') {
    return respond({
      association: { name: 'Maple Ridge HOA', contactEmail: 'treasurer@mapleridge.example', requirements: { ...DEFAULT_REQUIREMENTS, certificateHolder: 'Maple Ridge HOA' } },
      today: '2026-10-22',
      vendors: [{ id: vendorId, name: 'Acme Landscaping' }],
    });
  }
  if (url === '/api/extract') {
    // (helpers/fixtures.ts reads files from disk, which the browser environment can't.)
    const fields = { ...emptyFields(), namedInsured: 'Acme Landscaping LLC', endorsements: ['CG 20 10'] };
    return respond({ fields, pages: 1, text: 'ACORD 25' });
  }
  return respond(verdict);
}

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function render(element: React.ReactElement) {
  await act(async () => root.render(element));
  await settle();
}

const byText = (selector: string, text: string) =>
  [...container.querySelectorAll<HTMLElement>(selector)].find((element) => element.textContent?.includes(text));

async function chooseAndReadPdf() {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { value: [new File(['%PDF-1.4'], 'coi.pdf', { type: 'application/pdf' })] });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => {
    input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await settle();
}

async function submitConfirmedFields() {
  const button = byText('button', 'Confirm and save') ?? byText('button', 'Check certificate');
  await act(async () => {
    button!.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await settle();
}

beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(fakeApi));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  window.location.hash = '';
});

describe('checking a dashboard vendor’s certificate (/check?vendor=…#k=…)', () => {
  beforeEach(() => {
    window.location.hash = `k=${key}`;
  });

  it('loads the vendor and the association’s saved requirements with the key from the link', async () => {
    await render(<Checker vendorId={vendorId} />);
    expect(calls).toEqual([{ url: '/api/vendors', method: 'GET', authorization: `Bearer ${key}`, body: null }]);
    const vendorInput = byText('label', 'Vendor name')!.querySelector('input')!;
    expect(vendorInput.value).toBe('Acme Landscaping');
    expect(vendorInput.readOnly).toBe(true);
    expect(container.querySelector('fieldset.plain')!.hasAttribute('disabled')).toBe(true);
    expect(container.textContent).toContain('Maple Ridge HOA’s saved requirements');
  });

  it('saves nothing until the board confirms the fields read from the PDF', async () => {
    await render(<Checker vendorId={vendorId} />);
    await chooseAndReadPdf();
    expect(calls.map((c) => c.url)).toEqual(['/api/vendors', '/api/extract']);
    expect(byText('button', 'Confirm and save to Acme Landscaping')).toBeDefined();
  });

  it('saves the confirmed fields to the vendor, never through the stateless check', async () => {
    await render(<Checker vendorId={vendorId} />);
    await chooseAndReadPdf();
    await submitConfirmedFields();

    const saves = calls.filter((c) => c.method === 'POST' && c.url !== '/api/extract');
    expect(saves).toHaveLength(1);
    expect(saves[0].url).toBe(`/api/vendors/${vendorId}/check`);
    expect(saves[0].authorization).toBe(`Bearer ${key}`);
    expect(saves[0].body).toMatchObject({ fields: { namedInsured: 'Acme Landscaping LLC' }, asOf: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    expect(container.textContent).toContain('Saved to Acme Landscaping’s record.');
    expect(byText('a', 'Back to the vendor dashboard')!.getAttribute('href')).toBe(`/dashboard#k=${key}`);
  });

  it('refuses to check (rather than check unsaved) when the link has no key', async () => {
    window.location.hash = '';
    await render(<Checker vendorId={vendorId} />);
    expect(calls).toEqual([]);
    expect(container.textContent).toContain('Open this page from your vendor dashboard');
    await act(async () => byText('button', 'Enter the fields by hand')!.click());
    await submitConfirmedFields();
    expect(calls).toEqual([]);
  });
});

describe('checking without a vendor (/check)', () => {
  it('checks right after reading the PDF and stores nothing', async () => {
    await render(<Checker />);
    const vendorInput = byText('label', 'Vendor name')!.querySelector('input')!;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setValue.call(vendorInput, 'Acme Landscaping');
      vendorInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await chooseAndReadPdf();
    expect(calls.map((c) => c.url)).toEqual(['/api/extract', '/api/check']);
    expect(calls[1].authorization).toBeNull();
    expect(calls[1].body).toMatchObject({ vendorName: 'Acme Landscaping' });
  });
});

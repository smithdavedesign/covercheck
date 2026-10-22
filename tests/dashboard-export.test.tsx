// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dashboard } from '../app/dashboard/dashboard';
import { DEFAULT_REQUIREMENTS } from '../lib/schema';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const key = 'Zx9_-'.repeat(8) + 'abc';
const CSV = 'Date checked,Vendor\r\n';
const FILENAME = 'covercheck-checks-maple-ridge-hoa-2026-10-22.csv';

interface Call {
  url: string;
  authorization: string | null;
}

let calls: Call[];
let exportResponse: () => Response;
let container: HTMLDivElement;
let root: Root;
let downloads: { href: string; download: string }[];

async function fakeApi(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = String(input);
  calls.push({ url, authorization: new Headers(init.headers).get('authorization') });
  if (url === '/api/vendors') {
    return Response.json({
      association: { name: 'Maple Ridge HOA', contactEmail: 'treasurer@mapleridge.example', requirements: DEFAULT_REQUIREMENTS },
      today: '2026-10-22',
      vendors: [],
    });
  }
  if (url === '/api/checks/export') return exportResponse();
  return Response.json({ error: 'not_found' }, { status: 404 });
}

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const button = (text: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('button')].find((element) => element.textContent?.includes(text));

beforeEach(async () => {
  calls = [];
  downloads = [];
  exportResponse = () =>
    new Response(CSV, {
      headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${FILENAME}"` },
    });
  vi.stubGlobal('fetch', vi.fn(fakeApi));
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:covercheck-test');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ href: this.href, download: this.download });
  });
  window.location.hash = `k=${key}`;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<Dashboard />));
  await settle();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.location.hash = '';
});

describe('dashboard: download the check log', () => {
  it('fetches the CSV with the dashboard key and saves it under the server’s filename', async () => {
    await act(async () => button('Download check log (CSV)')!.click());
    await settle();

    expect(calls.at(-1)).toEqual({ url: '/api/checks/export', authorization: `Bearer ${key}` });
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    expect(await blob.text()).toBe(CSV);
    expect(downloads).toEqual([{ href: 'blob:covercheck-test', download: FILENAME }]);
  });

  it('shows the API’s message when the export fails', async () => {
    exportResponse = () => Response.json({ error: 'unauthorized', message: 'This dashboard link is missing its key.' }, { status: 401 });
    await act(async () => button('Download check log (CSV)')!.click());
    await settle();

    expect(downloads).toEqual([]);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('This dashboard link is missing its key.');
  });
});

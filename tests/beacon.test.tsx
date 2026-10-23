// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BuyButton, VisitBeacon } from '../app/beacon';
import { Checker } from '../app/check/checker';
import { DISCLAIMER } from '../lib/check';
import { NO_TRACK_KEY, ONCE, SIGNAL_URL, externalReferrer, signal } from '../lib/beacon';
import { emptyFields } from '../lib/schema';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let fetchMock: ReturnType<typeof vi.fn>;
let container: HTMLDivElement;
let root: Root;

/** The signals sent to RepoHQ, decoded. */
function signals() {
  return fetchMock.mock.calls
    .filter(([url]) => String(url) === SIGNAL_URL)
    .map(([, init]) => JSON.parse((init as RequestInit).body as string) as { slug: string; kind: string; referrer: string | null });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function setReferrer(referrer: string) {
  Object.defineProperty(document, 'referrer', { value: referrer, configurable: true });
}

function setWebdriver(value: boolean) {
  Object.defineProperty(navigator, 'webdriver', { value, configurable: true });
}

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'production');
  fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  sessionStorage.clear();
  localStorage.clear();
  setReferrer('');
  setWebdriver(false);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('signal()', () => {
  it('POSTs {slug, kind, referrer} as JSON to RepoHQ, keepalive and without cookies', () => {
    signal('checkout');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://repohq.vercel.app/api/ideas/signal');
    expect(init).toMatchObject({ method: 'POST', keepalive: true, credentials: 'omit', referrerPolicy: 'no-referrer' });
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ slug: 'covercheck', kind: 'checkout', referrer: null });
  });

  it('sends a visit once per browser session', () => {
    signal('visit');
    signal('visit');
    expect(signals().map((s) => s.kind)).toEqual(['visit']);
    sessionStorage.clear(); // a new session
    signal('visit');
    expect(signals().map((s) => s.kind)).toEqual(['visit', 'visit']);
  });

  it('sends activate once per browser, across sessions', () => {
    signal('activate');
    sessionStorage.clear();
    signal('activate');
    expect(signals().map((s) => s.kind)).toEqual(['activate']);
  });

  it('sends checkout on every click', () => {
    signal('checkout');
    signal('checkout');
    expect(signals().map((s) => s.kind)).toEqual(['checkout', 'checkout']);
  });

  it('passes on a referrer from another site, and never one of its own pages', () => {
    setReferrer('https://www.reddit.com/r/HOA/comments/abc/');
    signal('checkout');
    setReferrer(`${window.location.origin}/dashboard`);
    signal('checkout');
    expect(signals().map((s) => s.referrer)).toEqual(['https://www.reddit.com/r/HOA/comments/abc/', null]);
  });

  it.each([
    ['a preview deployment', () => vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'preview')],
    ['local development', () => vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', '')],
    ['an automated browser', () => setWebdriver(true)],
    ['the owner’s browser (repohq:notrack)', () => localStorage.setItem(NO_TRACK_KEY, '1')],
  ])('sends nothing from %s', (_case, arrange) => {
    arrange();
    for (const kind of ['visit', 'activate', 'checkout'] as const) signal(kind);
    expect(fetchMock).not.toHaveBeenCalled();
    // …and doesn't use up the once-only events.
    expect(sessionStorage.getItem(ONCE.visit!.key)).toBeNull();
    expect(localStorage.getItem(ONCE.activate!.key)).toBeNull();
  });

  it('sends nothing, and doesn’t throw, when storage is blocked', () => {
    // What browsers do when site data is blocked: reading window.localStorage throws.
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    try {
      expect(() => signal('visit')).not.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('is fire-and-forget: a failed request is swallowed', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(() => signal('checkout')).not.toThrow();
    await settle();
  });
});

describe('externalReferrer()', () => {
  const origin = 'https://covercheck.vercel.app';
  it.each([
    ['https://news.ycombinator.com/item?id=1', 'https://news.ycombinator.com/item?id=1'],
    ['https://covercheck.vercel.app/check', null],
    ['https://covercheck.vercel.app/', null],
    ['http://covercheck.vercel.app/', 'http://covercheck.vercel.app/'],
    ['', null],
    ['not a url', null],
  ])('%j → %j', (referrer, expected) => {
    expect(externalReferrer(referrer, origin)).toBe(expected);
  });
});

describe('wired into the site', () => {
  it('the layout’s VisitBeacon counts the visit when a page opens', async () => {
    await act(async () => root.render(<VisitBeacon />));
    expect(signals().map((s) => s.kind)).toEqual(['visit']);
  });

  it('clicking Buy counts a checkout and still follows the payment link', async () => {
    await act(async () => root.render(<BuyButton href="https://example.com/pay">Buy</BuyButton>));
    const link = container.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('https://example.com/pay');
    let navigated = true;
    link.addEventListener('click', (event) => {
      navigated = !event.defaultPrevented;
      event.preventDefault(); // keep happy-dom on the page
    });
    await act(async () => link.click());
    expect(navigated).toBe(true);
    expect(signals().map((s) => s.kind)).toEqual(['checkout']);
  });

  it('renders no Buy button without a payment link', async () => {
    await act(async () => root.render(<BuyButton href={null}>Buy</BuyButton>));
    expect(container.innerHTML).toBe('');
  });

  it('the first certificate verdict counts as activation, once; a failed check doesn’t', async () => {
    let checkStatus = 422;
    fetchMock.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === '/api/extract') {
        return json({ fields: { ...emptyFields(), namedInsured: 'Acme Landscaping LLC' }, pages: 1, text: 'ACORD 25' });
      }
      if (url === '/api/check') {
        return checkStatus === 200
          ? json({ verdict: 'pass', asOf: '2026-10-22', results: [], warnings: [], disclaimer: DISCLAIMER })
          : json({ error: 'invalid_fields', message: 'Check the fields.' }, checkStatus);
      }
      return new Response(null, { status: 204 });
    });
    await act(async () => root.render(<Checker />));

    const vendorInput = container.querySelector<HTMLInputElement>('input:not([type])[placeholder="Acme Landscaping"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(vendorInput, 'Acme Landscaping');
      vendorInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(fileInput, 'files', { value: [new File(['%PDF-1.4'], 'coi.pdf', { type: 'application/pdf' })] });
    await act(async () => {
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const readAndCheck = async () => {
      await act(async () => {
        fileInput.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      await settle();
    };

    await readAndCheck();
    expect(signals()).toEqual([]);

    checkStatus = 200;
    await readAndCheck();
    await readAndCheck();
    expect(signals().map((s) => s.kind)).toEqual(['activate']);
  });
});

// Screenshot proof that covercheck does its job: builds and starts the production app on a throwaway
// local database, seeds sample data through the app's own API, drives it with Playwright and saves PNGs
// to docs/screenshots/. Uses the system Chromium from CHROMIUM_PATH; never downloads a browser.
//
//   npm run screenshots
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright-core';
import { layoutTextToPdf } from '../tests/helpers/pdf.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT_DIR = 'docs/screenshots';
/** Inside the repo's gitignored .data/, deleted before and after the run. */
const DATA_DIR = '.data/screenshots';
const PORT = 3210;
const BASE = `http://localhost:${PORT}`;
const NEXT_BIN = 'node_modules/next/dist/bin/next';
const START_TIMEOUT_MS = 60_000;

const DESKTOP = { viewport: { width: 1280, height: 800 } };
// The descriptor names WebKit as its default browser; only the viewport, user agent and touch settings are used.
const { defaultBrowserType: _webkit, ...IPHONE } = devices['iPhone 13'];
const SIZES = [
  ['desktop', DESKTOP],
  ['mobile', IPHONE],
];

// ── Dates relative to today, so the statuses look the same on any day ─────────

const TODAY = new Date().toISOString().slice(0, 10);

function addDays(days, from = TODAY) {
  const date = new Date(`${from}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const usDate = (iso) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;

// ── Sample data ────────────────────────────────────────────────────────────────

/**
 * The repo's sample ACORD 25 with a too-low each-occurrence limit, CG 20 37 missing and workers' comp
 * expiring in 20 days: the kind of certificate a board should not accept as is.
 */
function sampleCertificatePdf() {
  const glExpiry = addDays(130);
  const wcExpiry = addDays(20);
  const text = readFileSync(`${ROOT}tests/fixtures/acord25-sample.txt`, 'utf8')
    .replace('10/15/2026', usDate(addDays(-7)))
    .replace('03/01/2026   03/01/2027', `${usDate(addDays(-365, glExpiry))}   ${usDate(glExpiry)}`)
    .replace('01/01/2026   01/01/2027', `${usDate(addDays(-365, wcExpiry))}   ${usDate(wcExpiry)}`)
    .replace('EACH OCCURRENCE   $   1,000,000', 'EACH OCCURRENCE   $   500,000')
    .replace(' and CG 20 37 04 13', '');
  return Buffer.from(layoutTextToPdf(text));
}

/** Confirmed certificate fields, as the board would save them from the checker. */
function certificate(namedInsured, { glExpiry, wcExpiry = glExpiry, eachOccurrence = 1_000_000, endorsements = ['CG 20 10', 'CG 20 37'] }) {
  return {
    namedInsured,
    certificateHolder: 'Maple Ridge HOA, 12 Maple Ridge Drive, Springfield, IL 62702',
    generalLiability: {
      carrier: 'Hartford Casualty Insurance Company',
      policyNumber: 'GL-1234567',
      effectiveDate: addDays(-365, glExpiry),
      expiryDate: glExpiry,
      eachOccurrence,
      aggregate: 2_000_000,
    },
    workersComp: { carrier: 'Travelers Indemnity Company', policyNumber: 'WC-7654321', effectiveDate: addDays(-365, wcExpiry), expiryDate: wcExpiry },
    endorsements,
    description: `Maple Ridge HOA is included as additional insured per ${endorsements.join(' and ')}.`,
  };
}

const VENDORS = [
  { name: 'Acme Landscaping', email: 'office@acme-landscaping.example', agent: 'certs@smith-agency.example', fields: certificate('Acme Landscaping LLC', { glExpiry: addDays(130), wcExpiry: addDays(200) }) },
  { name: 'Bright Roofing', email: 'jobs@bright-roofing.example', agent: 'coi@harbor-insurance.example', fields: certificate('Bright Roofing Co.', { glExpiry: addDays(160), eachOccurrence: 500_000, endorsements: ['CG 20 10'] }) },
  { name: 'Clearwater Pools', email: 'service@clearwater-pools.example', agent: null, fields: certificate('Clearwater Pools Inc.', { glExpiry: addDays(12) }) },
  { name: 'Delta Plumbing', email: 'dispatch@delta-plumbing.example', agent: 'certs@smith-agency.example', fields: certificate('Delta Plumbing LLC', { glExpiry: addDays(-5) }) },
  { name: 'Evergreen Tree Care', email: 'hello@evergreen-trees.example', agent: null, fields: null },
];

async function api(path, { key, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (key) headers.authorization = `Bearer ${key}`;
  const response = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`${path} answered ${response.status}`);
  return response.json();
}

/** Creates the sample association through the app's own API; returns its dashboard key. */
async function seed() {
  const { key } = await api('/api/associations', { body: { name: 'Maple Ridge HOA', contactEmail: 'treasurer@mapleridge.example' } });
  for (const vendor of VENDORS) {
    const { vendor: added } = await api('/api/vendors', { key, body: { name: vendor.name, contactEmail: vendor.email, agentEmail: vendor.agent ?? '' } });
    if (vendor.fields) await api(`/api/vendors/${added.id}/check`, { key, body: { fields: vendor.fields, asOf: TODAY } });
  }
  return key;
}

// ── App lifecycle ──────────────────────────────────────────────────────────────

function run(args) {
  const result = spawnSync(process.execPath, [NEXT_BIN, ...args], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
  if (result.status !== 0) throw new Error(`next ${args[0]} failed`);
}

function startApp() {
  return spawn(process.execPath, [NEXT_BIN, 'start', '-p', String(PORT)], {
    cwd: ROOT,
    detached: true, // its own process group, so stopping it also stops anything it spawned
    stdio: ['ignore', 'inherit', 'inherit'],
    // An empty DATABASE_URL wins over .env.local, so sample data never reaches a real database.
    env: { ...process.env, DATABASE_URL: '', PGLITE_DIR: DATA_DIR, NEXT_TELEMETRY_DISABLED: '1' },
  });
}

async function waitUntilAnswering(app) {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (app.exitCode !== null) throw new Error('the app exited before it answered');
    try {
      if ((await fetch(BASE)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`the app did not answer on ${BASE} within ${START_TIMEOUT_MS / 1000} s`);
}

function stopApp(app) {
  if (app.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    app.once('exit', resolve);
    process.kill(-app.pid, 'SIGTERM');
  });
}

// ── Screens ───────────────────────────────────────────────────────────────────

async function capture(browser, key, pdf) {
  for (const [size, options] of SIZES) {
    const context = await browser.newContext(options);
    const page = await context.newPage();
    const shot = (name) => page.screenshot({ path: `${OUT_DIR}/${name}-${size}.png` });

    await page.goto(`${BASE}/`);
    await page.getByRole('heading', { level: 1 }).waitFor();
    await shot('home');

    await page.goto(`${BASE}/check`);
    await page.getByLabel('Vendor name').fill('Acme Landscaping');
    await page.locator('input[type="file"]').setInputFiles({ name: 'acme-landscaping-coi.pdf', mimeType: 'application/pdf', buffer: pdf });
    await page.getByRole('button', { name: 'Read certificate' }).click();
    const verdict = page.locator('#verdict-heading');
    await verdict.waitFor();
    await verdict.evaluate((element) => {
      element.closest('section').scrollIntoView({ block: 'start' });
      window.scrollBy(0, -16);
    });
    await shot('result');

    await page.goto(`${BASE}/dashboard#k=${key}`);
    await page.locator('table.vendors').waitFor();
    await page.locator('h2.association').evaluate((element) => element.scrollIntoView({ block: 'start' }));
    await shot('dashboard');

    await context.close();
  }
}

async function main() {
  if (!process.env.CHROMIUM_PATH) throw new Error('Set CHROMIUM_PATH to a Chromium or Chrome executable.');
  mkdirSync(`${ROOT}${OUT_DIR}`, { recursive: true });
  rmSync(`${ROOT}${DATA_DIR}`, { recursive: true, force: true });
  run(['build']);

  const app = startApp();
  let browser;
  try {
    await waitUntilAnswering(app);
    const key = await seed();
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
    process.chdir(ROOT);
    await capture(browser, key, sampleCertificatePdf());
    console.log(`Saved ${SIZES.length * 3} screenshots to ${OUT_DIR}/`);
  } finally {
    await browser?.close();
    await stopApp(app);
    rmSync(`${ROOT}${DATA_DIR}`, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

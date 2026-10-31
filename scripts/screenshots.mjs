// Screenshot proof that covercheck is launch-ready and does its job: builds and starts the production app
// on a throwaway local database with a placeholder payment link, drives it with Playwright and saves PNGs
// to docs/screenshots/. Uses the system Chromium from CHROMIUM_PATH; never downloads a browser.
//
//   npm run screenshots
//
// It also checks what the screenshots can't show: robots.txt, sitemap.xml and the 1200×630 share image
// (saved to .data/share-image.png to look at), and that the visit beacon sent nothing.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright-core';
import { layoutTextToPdf } from '../tests/helpers/pdf.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT_DIR = 'docs/screenshots';
/** Inside the repo's gitignored .data/, deleted before and after the run. */
const DATA_DIR = '.data/screenshots';
const SHARE_IMAGE_COPY = '.data/share-image.png';
const PORT = 3210;
const BASE = `http://localhost:${PORT}`;
const NEXT_BIN = 'node_modules/next/dist/bin/next';
const START_TIMEOUT_MS = 60_000;
/** Shows the Buy buttons without a real Stripe link. The pages are static, so the build bakes it in. */
const PLACEHOLDER_PAYMENT_LINK = 'https://example.com/pay';
const SIGNAL_URL = 'https://idea-factory.1426davejobs.workers.dev/api/ideas/signal';

const APP_ENV = {
  ...process.env,
  STRIPE_PAYMENT_LINK: PLACEHOLDER_PAYMENT_LINK,
  // Not a Vercel production deployment, so the beacon stays off (Playwright also sets navigator.webdriver).
  NEXT_PUBLIC_VERCEL_ENV: '',
  NEXT_TELEMETRY_DISABLED: '1',
};

const DESKTOP = { viewport: { width: 1280, height: 800 } };
// The descriptor names WebKit as its default browser; only the viewport, user agent and touch settings are used.
const { defaultBrowserType: _webkit, ...IPHONE } = devices['iPhone 13'];
const SIZES = [
  ['desktop', DESKTOP],
  ['mobile', IPHONE],
];
const SCREENS = ['home', 'result', 'pricing'];

// ── Sample data ────────────────────────────────────────────────────────────────

const TODAY = new Date().toISOString().slice(0, 10);

function addDays(days, from = TODAY) {
  const date = new Date(`${from}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const usDate = (iso) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;

/**
 * The repo's sample ACORD 25 with a too-low each-occurrence limit, CG 20 37 missing and workers' comp
 * expiring in 20 days: the kind of certificate a board should not accept as is. Dates are relative to
 * today, so the verdict looks the same on any day.
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

// ── App lifecycle ──────────────────────────────────────────────────────────────

function run(args) {
  const result = spawnSync(process.execPath, [NEXT_BIN, ...args], { cwd: ROOT, stdio: 'inherit', env: APP_ENV });
  if (result.status !== 0) throw new Error(`next ${args[0]} failed`);
}

function startApp() {
  return spawn(process.execPath, [NEXT_BIN, 'start', '-p', String(PORT)], {
    cwd: ROOT,
    detached: true, // its own process group, so stopping it also stops anything it spawned
    stdio: ['ignore', 'inherit', 'inherit'],
    // An empty DATABASE_URL wins over .env.local, so sample data never reaches a real database.
    env: { ...APP_ENV, DATABASE_URL: '', PGLITE_DIR: DATA_DIR },
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

/**
 * The local PGlite database boots (WASM, schema) on first use, which can take longer than the
 * checker's wait for a verdict. Creating a sample association through the app's own API boots it first.
 */
async function warmUpDatabase() {
  const response = await fetch(`${BASE}/api/associations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Maple Ridge HOA', contactEmail: 'treasurer@mapleridge.example' }),
  });
  if (!response.ok) throw new Error(`/api/associations answered ${response.status}`);
}

function stopApp(app) {
  if (app.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    app.once('exit', resolve);
    process.kill(-app.pid, 'SIGTERM');
  });
}

// ── Checks the screenshots can't show ─────────────────────────────────────────

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function checkSearchFiles() {
  const robots = await fetch(`${BASE}/robots.txt`);
  const robotsText = await robots.text();
  check(robots.ok && /^Allow: \/$/m.test(robotsText) && /^Sitemap: https:\/\/\S+\/sitemap\.xml$/m.test(robotsText), 'robots.txt is wrong');
  const sitemap = await (await fetch(`${BASE}/sitemap.xml`)).text();
  for (const path of ['/', '/check', '/privacy', '/terms']) check(sitemap.includes(`${path}</loc>`), `sitemap.xml lacks ${path}`);

  const image = Buffer.from(await (await fetch(`${BASE}/opengraph-image`)).arrayBuffer());
  check(image.readUInt32BE(16) === 1200 && image.readUInt32BE(20) === 630, 'the share image is not 1200×630');
  writeFileSync(`${ROOT}${SHARE_IMAGE_COPY}`, image);
}

// ── Screens ───────────────────────────────────────────────────────────────────

/** Start page, the core action and its verdict, then pricing and the footer; one PNG each. */
async function captureScreens(page, shot, pdf) {
  await page.goto(`${BASE}/`);
  await page.getByRole('heading', { level: 1 }).waitFor();
  const buy = page.locator('header.site a.buy');
  check((await buy.getAttribute('href')) === PLACEHOLDER_PAYMENT_LINK, 'the header Buy button is missing');
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

  // The pricing section's Buy button and the footer's Terms and Privacy links, at the bottom of the landing page.
  await page.goto(`${BASE}/#pricing`);
  await page.getByRole('link', { name: /^Buy for \$\d+\/month$/ }).waitFor();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  for (const name of ['Terms', 'Privacy']) check(await page.locator('footer.site').getByRole('link', { name }).isVisible(), `no ${name} link in the footer`);
  await shot('pricing');
}

async function capture(browser, pdf) {
  let signals = 0;
  for (const [size, options] of SIZES) {
    const context = await browser.newContext(options);
    // Belt and braces: the beacon must stay silent here, and nothing may reach RepoHQ from a screenshot run.
    await context.route(SIGNAL_URL, (route) => {
      signals += 1;
      return route.abort();
    });
    const page = await context.newPage();
    try {
      await captureScreens(page, (name) => page.screenshot({ path: `${OUT_DIR}/${name}-${size}.png` }), pdf);
    } catch (error) {
      await page.screenshot({ path: `.data/screenshots-failed-${size}.png` }).catch(() => {});
      throw error;
    } finally {
      await context.close();
    }
  }
  check(signals === 0, `the visit beacon tried to send ${signals} signal(s) during the screenshot run`);
}

/** The script owns docs/screenshots/: PNGs it no longer produces are removed, so the README's set stays current. */
function removeStaleScreenshots() {
  const current = new Set(SIZES.flatMap(([size]) => SCREENS.map((screen) => `${screen}-${size}.png`)));
  for (const file of readdirSync(`${ROOT}${OUT_DIR}`)) {
    if (file.endsWith('.png') && !current.has(file)) rmSync(`${ROOT}${OUT_DIR}/${file}`);
  }
}

async function main() {
  if (!process.env.CHROMIUM_PATH) throw new Error('Set CHROMIUM_PATH to a Chromium or Chrome executable.');
  mkdirSync(`${ROOT}${OUT_DIR}`, { recursive: true });
  removeStaleScreenshots();
  rmSync(`${ROOT}${DATA_DIR}`, { recursive: true, force: true });
  run(['build']);

  const app = startApp();
  let browser;
  try {
    await waitUntilAnswering(app);
    await warmUpDatabase();
    await checkSearchFiles();
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
    process.chdir(ROOT);
    await capture(browser, sampleCertificatePdf());
    console.log(`Saved ${SIZES.length * SCREENS.length} screenshots to ${OUT_DIR}/ and the share image to ${SHARE_IMAGE_COPY}`);
    console.log('Note: .next/ now holds a build with the placeholder payment link; run `npm run build` again before `npm start`.');
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

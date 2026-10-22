import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST } from '../app/api/extract/route';
import { setDb } from '../lib/db';
import { MAX_PDF_BYTES as MAX_UPLOAD_BYTES } from '../lib/schema';
import { testDb, type TestDb } from './helpers/db';
import { ACORD25_TEXT } from './helpers/fixtures';
import { layoutTextToPdf, makePdf } from './helpers/pdf';

// Uploads are counted (M3); an in-memory database keeps the count out of the local dev database.
let t: TestDb;
beforeAll(async () => {
  t = await testDb();
  setDb(t.db);
});
afterAll(async () => {
  setDb(null);
  await t.close();
});

function upload(bytes: Uint8Array, { name = 'coi.pdf', type = 'application/pdf', field = 'file' } = {}) {
  const form = new FormData();
  form.append(field, new File([bytes.slice().buffer], name, { type }));
  return new Request('http://localhost/api/extract', { method: 'POST', body: form });
}

describe('POST /api/extract', () => {
  it('returns the extracted fields for a certificate PDF', async () => {
    const response = await POST(upload(layoutTextToPdf(ACORD25_TEXT)));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.fields.generalLiability.expiryDate).toBe('2027-03-01');
    expect(body.fields.generalLiability.eachOccurrence).toBe(1_000_000);
    expect(body.fields.namedInsured).toBe('Acme Landscaping LLC');
    expect(body.pages).toBe(1);
    expect(body.text).toContain('COMMERCIAL GENERAL LIABILITY');
  });

  it('answers 400 when no file was sent', async () => {
    const form = new FormData();
    form.append('note', 'no file here');
    const response = await POST(new Request('http://localhost/api/extract', { method: 'POST', body: form }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('missing_file');
  });

  it('answers 400 when the body is not multipart form data', async () => {
    const response = await POST(
      new Request('http://localhost/api/extract', {
        method: 'POST',
        body: '{}',
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('missing_file');
  });

  it('answers 415 for a file that is not a PDF, whatever its name', async () => {
    const response = await POST(upload(new TextEncoder().encode('GIF89a...'), { name: 'photo.pdf' }));
    expect(response.status).toBe(415);
    expect((await response.json()).error).toBe('not_pdf');
  });

  it('answers 413 for a file over the size limit', async () => {
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    big.set(new TextEncoder().encode('%PDF-1.7\n'));
    const response = await POST(upload(big));
    expect(response.status).toBe(413);
    expect((await response.json()).error).toBe('too_large');
  });

  it('answers 413 from the Content-Length header before reading the body', async () => {
    const request = new Request('http://localhost/api/extract', {
      method: 'POST',
      body: 'x',
      headers: { 'content-length': String(MAX_UPLOAD_BYTES * 2) },
    });
    const response = await POST(request);
    expect(response.status).toBe(413);
    expect(request.bodyUsed).toBe(false);
  });

  it('answers 422 no_text for a scanned PDF so the page can switch to manual entry', async () => {
    const response = await POST(upload(makePdf([{ drawing: '0.5 g 20 20 300 300 re f' }])));
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error).toBe('no_text');
    expect(body.message).toMatch(/by hand/);
  });

  it('answers 422 unreadable for a damaged PDF', async () => {
    const response = await POST(upload(new TextEncoder().encode('%PDF-1.7\nbroken\n%%EOF')));
    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe('unreadable');
  });
});

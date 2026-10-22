import { describe, expect, it } from 'vitest';
import { PdfError, itemsToLayoutText, pdfToText, withTimeout } from '../lib/pdf';
import { extractFields } from '../lib/extract';
import { ACORD25_TEXT } from './helpers/fixtures';
import { layoutTextToPdf, makePdf } from './helpers/pdf';

describe('itemsToLayoutText()', () => {
  it('groups items into lines top to bottom and orders each line left to right', () => {
    const text = itemsToLayoutText([
      { str: 'second', x: 10, y: 690, width: 30, fontSize: 8 },
      { str: 'right', x: 300, y: 700.4, width: 25, fontSize: 8 },
      { str: 'left', x: 10, y: 700, width: 20, fontSize: 8 },
    ]);
    expect(text).toBe('left   right\nsecond');
  });

  it('joins touching items without a gap and close items with one space', () => {
    const text = itemsToLayoutText([
      { str: 'Acme', x: 10, y: 700, width: 20, fontSize: 8 },
      { str: 'Land', x: 30, y: 700, width: 20, fontSize: 8 },
      { str: 'scaping', x: 52, y: 700, width: 30, fontSize: 8 },
    ]);
    expect(text).toBe('AcmeLand scaping');
  });

  it('drops whitespace-only items and collapses inner whitespace', () => {
    const text = itemsToLayoutText([
      { str: ' ', x: 5, y: 700, width: 2, fontSize: 8 },
      { str: 'Maple  Ridge', x: 10, y: 700, width: 40, fontSize: 8 },
    ]);
    expect(text).toBe('Maple Ridge');
  });
});

describe('pdfToText()', () => {
  it('reads the text layer of a flattened certificate, keeping columns apart', async () => {
    const { text, pages } = await pdfToText(layoutTextToPdf(ACORD25_TEXT));
    expect(pages).toBe(1);
    const lines = text.split('\n');
    expect(lines).toContain('INSURED   INSURER B :   Travelers Indemnity Company   25658');
    expect(lines).toContain('Acme Landscaping LLC   INSURER C :');
  });

  it('round-trips the fixture: extraction from the PDF equals extraction from the text', async () => {
    const { text } = await pdfToText(layoutTextToPdf(ACORD25_TEXT));
    expect(extractFields(text)).toEqual(extractFields(ACORD25_TEXT));
  });

  it('includes values typed into a fillable form at their position on the page', async () => {
    const pdf = makePdf([
      {
        texts: [
          { x: 20, y: 700, text: 'INSURED' },
          { x: 20, y: 600, text: 'CERTIFICATE HOLDER' },
        ],
        fields: [
          { name: 'NamedInsured_FullName_A', value: 'Acme Landscaping LLC', rect: [20, 680, 220, 692] },
          { name: 'Notes', value: 'line one\nline two', rect: [20, 500, 300, 540] },
        ],
      },
    ]);
    const { text } = await pdfToText(pdf);
    const lines = text.split('\n');
    expect(lines.indexOf('Acme Landscaping LLC')).toBe(lines.indexOf('INSURED') + 1);
    expect(lines.indexOf('line two')).toBe(lines.indexOf('line one') + 1);
    expect(extractFields(text).namedInsured).toBe('Acme Landscaping LLC');
  });

  it('returns empty text for a PDF without a text layer (a scan)', async () => {
    const pdf = makePdf([{ drawing: '0.5 g 20 20 300 300 re f' }]);
    expect(await pdfToText(pdf)).toEqual({ text: '', pages: 1 });
  });

  it('reads at most maxPages pages but reports the real page count', async () => {
    const pdf = makePdf([
      { texts: [{ x: 20, y: 700, text: 'page one' }] },
      { texts: [{ x: 20, y: 700, text: 'page two' }] },
      { texts: [{ x: 20, y: 700, text: 'page three' }] },
    ]);
    const { text, pages } = await pdfToText(pdf, { maxPages: 2 });
    expect(pages).toBe(3);
    expect(text).toContain('page two');
    expect(text).not.toContain('page three');
  });

  it('rejects bytes that are not a PDF', async () => {
    await expect(pdfToText(new TextEncoder().encode('hello, not a pdf'))).rejects.toMatchObject({
      name: 'PdfError',
      code: 'not_pdf',
    });
  });

  it('rejects a damaged PDF as unreadable', async () => {
    await expect(pdfToText(new TextEncoder().encode('%PDF-1.7\nthis is not really a pdf\n%%EOF'))).rejects.toMatchObject(
      { name: 'PdfError', code: 'unreadable' },
    );
  });
});

describe('withTimeout()', () => {
  it('rejects with a timeout PdfError when the work takes too long', async () => {
    const never = new Promise<never>(() => {});
    const error = await withTimeout(never, 10).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PdfError);
    expect(error).toMatchObject({ code: 'timeout' });
  });

  it('passes the result through when the work finishes in time', async () => {
    await expect(withTimeout(Promise.resolve('done'), 1000)).resolves.toBe('done');
  });
});

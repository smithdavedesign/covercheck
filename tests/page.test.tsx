import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { Checker } from '../app/check/checker';

describe('upload page', () => {
  const html = renderToString(<Checker />);

  it('offers a PDF upload and a manual-entry fallback', () => {
    expect(html).toMatch(/<input[^>]*type="file"[^>]*accept="application\/pdf/);
    expect(html).toContain('Read certificate');
    expect(html).toContain('Enter the fields by hand');
  });

  it('asks for the vendor name and shows the default requirements', () => {
    expect(html).toContain('Vendor name');
    expect(html).toContain('Each occurrence');
    expect(html).toContain('value="1000000"');
    expect(html).toContain('CG 20 10, CG 20 37');
  });

  it('always shows the not-proof-of-coverage notice', () => {
    expect(html).toContain('not proof of coverage');
  });
});

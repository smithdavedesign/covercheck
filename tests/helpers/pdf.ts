/**
 * Builds small, valid PDFs in memory so the PDF path is tested on real bytes
 * without checking binary fixtures into the repo. ASCII text only.
 */

export interface PdfTextRun {
  x: number;
  y: number;
  text: string;
  size?: number;
}

/** A filled-in AcroForm text field (how fillable ACORD 25s carry their values). */
export interface PdfTextField {
  name: string;
  value: string;
  rect: [number, number, number, number];
}

export interface PdfPage {
  texts?: PdfTextRun[];
  fields?: PdfTextField[];
  /** Raw content-stream operators, e.g. a filled rectangle standing in for a scanned image. */
  drawing?: string;
}

const escapePdfString = (value: string) => value.replace(/[\\()]/g, (char) => `\\${char}`);

export function makePdf(pages: PdfPage[], { width = 720, height = 800 } = {}): Uint8Array {
  // Objects 1–3 are fixed: catalog, page tree, Courier font. Bodies are filled in at the end.
  const objects: string[] = ['', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>'];
  const add = (body: string) => objects.push(body);
  const pageIds: number[] = [];
  const fieldIds: number[] = [];

  for (const page of pages) {
    const content = [
      ...(page.texts ?? []).map(
        (run) => `BT /F1 ${run.size ?? 8} Tf 1 0 0 1 ${run.x.toFixed(2)} ${run.y.toFixed(2)} Tm (${escapePdfString(run.text)}) Tj ET`,
      ),
      page.drawing ?? '',
    ].join('\n');
    const contentId = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    const annotIds = (page.fields ?? []).map((field) =>
      add(
        `<< /Type /Annot /Subtype /Widget /FT /Tx /F 4 /T (${escapePdfString(field.name)}) ` +
          `/V (${escapePdfString(field.value)}) /Rect [${field.rect.join(' ')}] /DA (/F1 8 Tf 0 g) >>`,
      ),
    );
    fieldIds.push(...annotIds);
    const annots = annotIds.length ? ` /Annots [${annotIds.map((id) => `${id} 0 R`).join(' ')}]` : '';
    pageIds.push(
      add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] ` +
          `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R${annots} >>`,
      ),
    );
  }

  const acroForm = fieldIds.length
    ? ` /AcroForm << /Fields [${fieldIds.map((id) => `${id} 0 R`).join(' ')}] /DA (/F1 8 Tf 0 g) /DR << /Font << /F1 3 0 R >> >> >>`
    : '';
  objects[0] = `<< /Type /Catalog /Pages 2 0 R${acroForm} >>`;
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  let out = '%PDF-1.7\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = out.length;
  out +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

/** Courier is monospaced: 0.6 em per character, so 4.8 pt at 8 pt. */
const COURIER_CHAR_WIDTH = 4.8;

/**
 * Renders layout text (columns separated by 3+ spaces) as a one-page PDF, placing each
 * column at the x position of its first character, the way a flattened ACORD 25 is laid out.
 */
export function layoutTextToPdf(layout: string): Uint8Array {
  const texts: PdfTextRun[] = [];
  layout.split('\n').forEach((line, row) => {
    for (const cell of line.matchAll(/\S+(?: \S+)*/g)) {
      texts.push({ x: 20 + (cell.index ?? 0) * COURIER_CHAR_WIDTH, y: 780 - row * 10, text: cell[0] });
    }
  });
  return makePdf([{ texts }]);
}

import { getDocumentProxy } from 'unpdf';

/** Certificates are 1–3 pages plus endorsements; anything past this is not read. */
export const MAX_PAGES = 20;
export const PARSE_TIMEOUT_MS = 15_000;
/** Caps the memory a single declared image can make PDF.js allocate (~16 megapixels). */
const MAX_IMAGE_PIXELS = 16_777_216;

export type PdfErrorCode = 'not_pdf' | 'unreadable' | 'timeout';

export class PdfError extends Error {
  constructor(
    readonly code: PdfErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PdfError';
  }
}

/** A run of text at a position on the page (PDF coordinates: origin bottom-left). */
export interface TextBox {
  str: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
}

export interface PdfText {
  /** Layout text: one line per printed line, columns separated by three spaces. */
  text: string;
  /** Total pages in the document (only the first MAX_PAGES are read). */
  pages: number;
}

/**
 * Reads the text of a PDF as layout text. Includes values typed into fillable form fields,
 * which many ACORD 25s carry in widget annotations rather than in the page text.
 * A scanned (image-only) PDF yields empty text.
 */
export async function pdfToText(
  data: Uint8Array,
  { maxPages = MAX_PAGES, timeoutMs = PARSE_TIMEOUT_MS }: { maxPages?: number; timeoutMs?: number } = {},
): Promise<PdfText> {
  if (!looksLikePdf(data)) throw new PdfError('not_pdf', 'This file is not a PDF.');
  return withTimeout(readPdf(data, maxPages), timeoutMs);
}

function looksLikePdf(data: Uint8Array): boolean {
  // The header may follow a little leading junk; PDF readers look within the first 1 KB.
  return new TextDecoder('latin1').decode(data.subarray(0, 1024)).includes('%PDF-');
}

async function readPdf(data: Uint8Array, maxPages: number): Promise<PdfText> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(data, { maxImageSize: MAX_IMAGE_PIXELS });
  } catch (error) {
    const locked = (error as { name?: string } | null)?.name === 'PasswordException';
    throw new PdfError(
      'unreadable',
      locked ? 'This PDF is password-protected. Upload an unlocked copy.' : 'This PDF could not be read. It may be damaged.',
    );
  }
  try {
    const pageTexts: string[] = [];
    for (let n = 1; n <= Math.min(pdf.numPages, maxPages); n++) {
      const page = await pdf.getPage(n);
      const [content, annotations] = await Promise.all([page.getTextContent(), page.getAnnotations()]);
      pageTexts.push(itemsToLayoutText([...textBoxes(content.items), ...formFieldBoxes(annotations)]));
    }
    return { text: pageTexts.filter(Boolean).join('\n\n'), pages: pdf.numPages };
  } catch {
    throw new PdfError('unreadable', 'This PDF could not be read. It may be damaged.');
  } finally {
    await pdf.loadingTask.destroy();
  }
}

function textBoxes(items: readonly object[]): TextBox[] {
  const boxes: TextBox[] = [];
  for (const item of items) {
    if (!('str' in item) || !('transform' in item)) continue; // marked-content markers carry no text
    const { str, transform, width, height } = item as { str: string; transform: number[]; width: number; height: number };
    boxes.push({ str, x: transform[4], y: transform[5], width, fontSize: Math.hypot(transform[2], transform[3]) || height || 8 });
  }
  return boxes;
}

interface WidgetAnnotation {
  subtype?: string;
  fieldType?: string;
  fieldValue?: unknown;
  rect?: number[];
}

/** Values of filled-in text fields, placed where the field sits on the page. */
function formFieldBoxes(annotations: readonly WidgetAnnotation[]): TextBox[] {
  const boxes: TextBox[] = [];
  for (const annotation of annotations) {
    const { subtype, fieldType, fieldValue, rect } = annotation;
    if (subtype !== 'Widget' || fieldType !== 'Tx' || typeof fieldValue !== 'string' || rect?.length !== 4) continue;
    const valueLines = fieldValue.split(/\r\n|\r|\n/).filter((line) => line.trim());
    if (valueLines.length === 0) continue;
    const [left, bottom, , top] = rect;
    const height = top - bottom;
    const multiline = valueLines.length > 1;
    const fontSize = multiline ? 8 : Math.min(10, Math.max(6, height * 0.6));
    const firstBaseline = multiline ? top - fontSize : bottom + (height - fontSize) / 2;
    valueLines.forEach((line, i) => {
      boxes.push({
        str: line,
        x: left + 2,
        y: firstBaseline - i * fontSize * 1.2,
        width: line.length * fontSize * 0.5,
        fontSize,
      });
    });
  }
  return boxes;
}

/**
 * Rebuilds printed lines from positioned text: items on the same baseline form one line,
 * read left to right; a wide horizontal gap becomes a three-space column separator.
 */
export function itemsToLayoutText(boxes: readonly TextBox[]): string {
  const sorted = boxes
    .map((box) => ({ ...box, str: box.str.replace(/\s+/g, ' ') }))
    .filter((box) => box.str.trim())
    .sort((a, b) => b.y - a.y || a.x - b.x);

  const lines: TextBox[][] = [];
  for (const box of sorted) {
    const line = lines.at(-1);
    const tolerance = Math.max(1, Math.min(line?.[0].fontSize ?? box.fontSize, box.fontSize) * 0.4);
    if (line && Math.abs(line[0].y - box.y) <= tolerance) line.push(box);
    else lines.push([box]);
  }

  return lines
    .map((line) => {
      let out = '';
      let end = -Infinity;
      for (const box of line.sort((a, b) => a.x - b.x)) {
        const gap = box.x - end;
        if (out && gap > box.fontSize * 0.9) out = `${out.trimEnd()}   `;
        else if (out && gap > box.fontSize * 0.15 && !out.endsWith(' ')) out += ' ';
        out += out.endsWith(' ') ? box.str.trimStart() : box.str;
        end = box.x + box.width;
      }
      return out.trim();
    })
    .join('\n');
}

/** Rejects with a `timeout` PdfError if `work` takes longer than `ms`. */
export function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PdfError('timeout', 'Reading this PDF took too long.')), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

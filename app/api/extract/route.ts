import { extractFields } from '../../../lib/extract';
import { PdfError, pdfToText } from '../../../lib/pdf';
import { MAX_PDF_BYTES } from '../../../lib/schema';
import { trackUsage } from '../../../lib/usage';

export const runtime = 'nodejs';
export const maxDuration = 30;

const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

const STATUS_BY_PDF_ERROR = { not_pdf: 415, unreadable: 422, timeout: 422 } as const;

function error(status: number, code: string, message: string) {
  return Response.json({ error: code, message }, { status });
}

const tooLarge = () => error(413, 'too_large', 'The PDF must be 4 MB or smaller.');

/** POST multipart/form-data with a `file` field holding the certificate PDF. The PDF is never stored; only the upload is counted. */
export async function POST(request: Request) {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_PDF_BYTES + MULTIPART_OVERHEAD_BYTES) return tooLarge();

  let file: FormDataEntryValue | null = null;
  try {
    file = (await request.formData()).get('file');
  } catch {
    // Not multipart form data; reported below as a missing file.
  }
  if (!file || typeof file === 'string') {
    return error(400, 'missing_file', 'Send the certificate PDF as multipart form data in a field named "file".');
  }
  if (file.size > MAX_PDF_BYTES) return tooLarge();
  // Every certificate someone tries counts for the demand test, whether or not it can be read.
  await trackUsage('upload');

  try {
    const { text, pages } = await pdfToText(new Uint8Array(await file.arrayBuffer()));
    if (!text.trim()) {
      return error(
        422,
        'no_text',
        'This PDF has no readable text; it looks like a scan. Enter the certificate fields by hand.',
      );
    }
    return Response.json({ fields: extractFields(text), pages, text });
  } catch (caught) {
    if (caught instanceof PdfError) return error(STATUS_BY_PDF_ERROR[caught.code], caught.code, caught.message);
    throw caught;
  }
}

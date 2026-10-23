'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { signal } from '../../lib/beacon';
import { DISCLAIMER, type CheckResult } from '../../lib/check';
import {
  dashboardKeyFromHash,
  fieldsToForm,
  formToFields,
  formToRequirements,
  localIsoDate,
  requirementsToForm,
  type FieldsForm,
  type RequirementsForm,
} from '../../lib/form';
import { DEFAULT_REQUIREMENTS, MAX_PDF_BYTES, emptyFields, type Requirements } from '../../lib/schema';
import type { VendorView } from '../../lib/store';
import { RequirementsFields } from '../requirements-fields';

type CheckResponse = CheckResult & { disclaimer: string };

/** Checking for a vendor on the dashboard: the association's saved requirements apply and the verdict is saved. */
interface VendorContext {
  id: string;
  name: string;
  associationName: string;
  dashboardKey: string;
}

interface FieldInput {
  key: keyof FieldsForm;
  label: string;
  type?: 'date' | 'textarea';
}

const FIELD_GROUPS: { title: string; inputs: FieldInput[] }[] = [
  {
    title: 'Certificate',
    inputs: [
      { key: 'namedInsured', label: 'Named insured' },
      { key: 'certificateHolder', label: 'Certificate holder' },
      { key: 'endorsements', label: 'Endorsement forms (comma-separated)' },
      { key: 'description', label: 'Description of operations', type: 'textarea' },
    ],
  },
  {
    title: 'General liability',
    inputs: [
      { key: 'glCarrier', label: 'Insurer' },
      { key: 'glPolicyNumber', label: 'Policy number' },
      { key: 'glEffective', label: 'Effective date', type: 'date' },
      { key: 'glExpiry', label: 'Expiry date', type: 'date' },
      { key: 'glEachOccurrence', label: 'Each occurrence ($)' },
      { key: 'glAggregate', label: 'General aggregate ($)' },
    ],
  },
  {
    title: 'Workers’ compensation',
    inputs: [
      { key: 'wcCarrier', label: 'Insurer' },
      { key: 'wcPolicyNumber', label: 'Policy number' },
      { key: 'wcEffective', label: 'Effective date', type: 'date' },
      { key: 'wcExpiry', label: 'Expiry date', type: 'date' },
    ],
  },
];

const OFFLINE = 'Could not reach covercheck. Check your connection and try again.';

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return response.json().catch(() => ({}));
}

/**
 * Upload page: requirements → PDF → extracted fields for confirmation → verdict.
 * With `vendorId` (a "Check certificate" link from the dashboard) the verdict is saved to that vendor.
 */
export function Checker({ vendorId }: { vendorId?: string } = {}) {
  const [requirementsForm, setRequirementsForm] = useState<RequirementsForm>(() => requirementsToForm(DEFAULT_REQUIREMENTS));
  const [vendorName, setVendorName] = useState('');
  const [vendor, setVendor] = useState<VendorContext | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fieldsForm, setFieldsForm] = useState<FieldsForm | null>(null);
  const [pdfText, setPdfText] = useState<string | null>(null);
  const [result, setResult] = useState<CheckResponse | null>(null);
  const [busy, setBusy] = useState<'reading' | 'checking' | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!vendorId) return;
    const dashboardKey = dashboardKeyFromHash(window.location.hash);
    if (!dashboardKey) {
      setMessage('Open this page from your vendor dashboard to save the result to the vendor.');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/vendors', { headers: { authorization: `Bearer ${dashboardKey}` } });
        const body = await readJson(response);
        if (cancelled) return;
        const vendors = (body.vendors ?? []) as VendorView[];
        const found = response.ok ? vendors.find((v) => v.id === vendorId) : undefined;
        if (!found) {
          setMessage('That vendor is not on your dashboard. Open the check from your vendor dashboard again.');
          return;
        }
        const association = body.association as { name: string; requirements: Requirements };
        setVendor({ id: found.id, name: found.name, associationName: association.name, dashboardKey });
        setVendorName(found.name);
        setRequirementsForm(requirementsToForm(association.requirements));
      } catch {
        if (!cancelled) setMessage(OFFLINE);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [vendorId]);

  // Any edit makes the shown verdict stale, so it is cleared until the next check.
  const setRequirement = <K extends keyof RequirementsForm>(key: K, value: RequirementsForm[K]) => {
    setRequirementsForm((form) => ({ ...form, [key]: value }));
    setResult(null);
  };
  const setField = (key: keyof FieldsForm, value: string) => {
    setFieldsForm((form) => (form ? { ...form, [key]: value } : form));
    setResult(null);
  };
  const changeVendorName = (value: string) => {
    setVendorName(value);
    setResult(null);
  };

  /** A dashboard vendor is checked server-side against the association's saved requirements, and saved. */
  function checkRequest(form: FieldsForm): { url: string; init: RequestInit } | { error: string } {
    const fields = formToFields(form);
    const asOf = localIsoDate();
    if (vendor) {
      return {
        url: `/api/vendors/${encodeURIComponent(vendor.id)}/check`,
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${vendor.dashboardKey}` },
          body: JSON.stringify({ fields, asOf }),
        },
      };
    }
    // Never silently fall back to an unsaved check when the board meant to save one.
    if (vendorId) return { error: 'The vendor is not loaded yet. Open this check from your vendor dashboard again.' };
    if (!vendorName.trim()) return { error: 'Enter the vendor’s name as it appears on your contract.' };
    const requirements = formToRequirements(requirementsForm, DEFAULT_REQUIREMENTS);
    if (!requirements.ok) return { error: requirements.error };
    return {
      url: '/api/check',
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ vendorName, fields, requirements: requirements.requirements, asOf }),
      },
    };
  }

  async function runCheck(form: FieldsForm) {
    const request = checkRequest(form);
    if ('error' in request) return setMessage(request.error);
    setBusy('checking');
    setMessage(null);
    try {
      const response = await fetch(request.url, request.init);
      const body = await readJson(response);
      if (response.ok) {
        setResult(body as unknown as CheckResponse);
        // The core action: a certificate checked to a verdict. Counted once per browser.
        signal('activate');
      } else {
        setResult(null);
        setMessage(typeof body.message === 'string' ? body.message : 'The check failed. Try again.');
      }
    } catch {
      setMessage(OFFLINE);
    } finally {
      setBusy(null);
    }
  }

  async function readCertificate(event: FormEvent) {
    event.preventDefault();
    if (!file) return setMessage('Choose the certificate PDF first.');
    if (file.size > MAX_PDF_BYTES) return setMessage('The PDF must be 4 MB or smaller.');
    setBusy('reading');
    setMessage(null);
    setResult(null);
    setPdfText(null);
    try {
      const upload = new FormData();
      upload.append('file', file);
      const response = await fetch('/api/extract', { method: 'POST', body: upload });
      const body = await readJson(response);
      if (!response.ok) {
        setMessage(typeof body.message === 'string' ? body.message : 'The certificate could not be read.');
        if (body.error === 'no_text') setFieldsForm(fieldsToForm(emptyFields()));
        return;
      }
      const form = fieldsToForm(body.fields as Parameters<typeof fieldsToForm>[0]);
      setFieldsForm(form);
      setPdfText(typeof body.text === 'string' ? body.text : null);
      // A quick check of what was read is harmless when nothing is stored. A vendor's check is
      // saved and drives reminders, so it waits until the board has confirmed the fields.
      if (!vendor) await runCheck(form);
    } catch {
      setMessage(OFFLINE);
    } finally {
      setBusy(null);
    }
  }

  function enterByHand() {
    setFieldsForm(fieldsToForm(emptyFields()));
    setPdfText(null);
    setResult(null);
    setMessage(null);
  }

  return (
    <div className="checker">
      <section aria-labelledby="requirements-heading">
        <h2 id="requirements-heading">1. Your association’s requirements</h2>
        <p className="hint">
          {vendor
            ? `${vendor.associationName}’s saved requirements. The verdict will be saved to ${vendor.name}’s record on your dashboard.`
            : 'Prefilled with the default association template. Change it to match your vendor policy.'}
        </p>
        <RequirementsFields form={requirementsForm} onChange={setRequirement} disabled={vendor !== null} />
      </section>

      <section aria-labelledby="upload-heading">
        <h2 id="upload-heading">2. Vendor and certificate</h2>
        <form className="grid" onSubmit={readCertificate}>
          <label>
            Vendor name
            <input
              required
              readOnly={vendor !== null}
              value={vendorName}
              placeholder="Acme Landscaping"
              onChange={(e) => changeVendorName(e.target.value)}
            />
          </label>
          <label>
            Certificate of insurance (PDF, up to 4 MB)
            <input type="file" accept="application/pdf,.pdf" required onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <div className="actions">
            <button type="submit" disabled={busy !== null}>
              {busy === 'reading' ? 'Reading…' : 'Read certificate'}
            </button>
            <button type="button" className="secondary" onClick={enterByHand} disabled={busy !== null}>
              Enter the fields by hand
            </button>
          </div>
        </form>
      </section>

      {message && (
        <p role="alert" className="message">
          {message}
        </p>
      )}

      {fieldsForm && (
        <section aria-labelledby="fields-heading">
          <h2 id="fields-heading">3. Confirm what was read</h2>
          <p className="hint">
            {vendor
              ? `Compare every value with the PDF and correct anything misread. Saving records the verdict and the expiry date on ${vendor.name}’s record; the expiry date drives the reminders.`
              : 'The verdict uses these values. Correct anything misread, then check again.'}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void runCheck(fieldsForm);
            }}
          >
            {FIELD_GROUPS.map((group) => (
              <fieldset key={group.title} className="grid">
                <legend>{group.title}</legend>
                {group.inputs.map((input) => (
                  <label key={input.key} className={input.type === 'textarea' ? 'wide' : undefined}>
                    {input.label}
                    {input.type === 'textarea' ? (
                      <textarea rows={3} value={fieldsForm[input.key]} onChange={(e) => setField(input.key, e.target.value)} />
                    ) : (
                      <input
                        type={input.type ?? 'text'}
                        value={fieldsForm[input.key]}
                        onChange={(e) => setField(input.key, e.target.value)}
                      />
                    )}
                  </label>
                ))}
              </fieldset>
            ))}
            <div className="actions">
              <button type="submit" disabled={busy !== null}>
                {busy === 'checking' ? 'Checking…' : vendor ? `Confirm and save to ${vendor.name}` : 'Check certificate'}
              </button>
            </div>
          </form>
          {pdfText && (
            <details>
              <summary>Text read from the PDF</summary>
              <pre>{pdfText}</pre>
            </details>
          )}
        </section>
      )}

      {result && <Verdict result={result} />}
      {result && vendor && (
        <p className="saved">
          Saved to {vendor.name}’s record.{' '}
          <a href={`/dashboard#${new URLSearchParams({ k: vendor.dashboardKey })}`}>Back to the vendor dashboard</a>
        </p>
      )}

      <p className="disclaimer">{DISCLAIMER}</p>
    </div>
  );
}

/** Drawn rather than typed: ✓ and ✗ are missing from many systems' fonts and show up as empty boxes. */
function Mark({ state }: { state: 'pass' | 'fail' | 'warn' }) {
  if (state === 'warn') return <>!</>;
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
      <path
        d={state === 'pass' ? 'M2 6.5 5 9.5 10 2.5' : 'M2.5 2.5 9.5 9.5 M9.5 2.5 2.5 9.5'}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The verdict card; the landing page shows it for a sample certificate. */
export function Verdict({ result }: { result: CheckResponse }) {
  const failed = result.results.filter((r) => !r.passed).length;
  const total = result.results.length;
  const warnings = result.warnings.length;
  const summary = failed ? `${failed} of ${total} requirements not met` : `all ${total} requirements met`;
  return (
    <section aria-live="polite" aria-labelledby="verdict-heading" className={`verdict ${result.verdict}`}>
      <h2 id="verdict-heading">
        {result.verdict === 'pass' ? 'Pass' : 'Fail'}: {summary}
        {warnings ? `, ${warnings} warning${warnings === 1 ? '' : 's'}` : ''}
      </h2>
      <p className="hint">Checked as of {result.asOf}.</p>
      <ul className="rules">
        {result.results.map((r, i) => {
          const state = !r.passed ? 'fail' : r.warning ? 'warn' : 'pass';
          return (
            <li key={`${r.rule}-${i}`} className={state}>
              <span className="mark" aria-label={state}>
                <Mark state={state} />
              </span>
              <span>
                <strong>{r.label}</strong>: {r.reason}
                {r.warning && <em className="warning"> ({r.warning})</em>}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

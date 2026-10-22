'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { REMINDER_WINDOWS, requirementLines } from '../../lib/email';
import { dashboardKeyFromHash, formToRequirements, requirementsToForm, type RequirementsForm } from '../../lib/form';
import { DEFAULT_REQUIREMENTS, type Requirements } from '../../lib/schema';
import type { VendorView } from '../../lib/store';
import { RequirementsFields } from '../requirements-fields';

interface DashboardData {
  association: { name: string; contactEmail: string; requirements: Requirements };
  today: string;
  vendors: VendorView[];
}

const OFFLINE = 'Could not reach covercheck. Check your connection and try again.';
/** How long a downloaded file's blob URL stays valid; some browsers read the blob only after click() returns. */
const BLOB_URL_LIFETIME_MS = 30_000;

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return response.json().catch(() => ({}));
}

function errorMessage(body: Record<string, unknown>, fallback: string): string {
  return typeof body.message === 'string' ? body.message : fallback;
}

/** Reads the association key from the URL fragment, which never leaves the browser. */
export function Dashboard() {
  const [key, setKey] = useState<string | null | undefined>(undefined);
  const [justCreated, setJustCreated] = useState(false);

  useEffect(() => {
    const read = () => setKey(dashboardKeyFromHash(window.location.hash));
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);

  if (key === undefined) return <p className="hint">Loading…</p>;
  if (key === null) {
    return (
      <CreateAssociationForm
        onCreated={(created) => {
          setJustCreated(true);
          window.location.hash = new URLSearchParams({ k: created }).toString();
        }}
      />
    );
  }
  return <VendorDashboard dashboardKey={key} justCreated={justCreated} />;
}

export function CreateAssociationForm({ onCreated }: { onCreated: (key: string) => void }) {
  const [name, setName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [requirementsForm, setRequirementsForm] = useState<RequirementsForm>(() => requirementsToForm(DEFAULT_REQUIREMENTS));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const requirements = formToRequirements(requirementsForm, DEFAULT_REQUIREMENTS);
    if (!requirements.ok) return setMessage(requirements.error);
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch('/api/associations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, contactEmail, requirements: requirements.requirements }),
      });
      const body = await readJson(response);
      if (response.ok && typeof body.key === 'string') onCreated(body.key);
      else setMessage(errorMessage(body, 'The dashboard could not be created. Try again.'));
    } catch {
      setMessage(OFFLINE);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <section aria-labelledby="create-heading">
        <h2 id="create-heading">Set up your association</h2>
        <p className="hint">
          Already have a dashboard? Open the private link you bookmarked. covercheck has no passwords: the link is the key.
        </p>
        <div className="grid">
          <label>
            Association name
            <input required maxLength={200} value={name} placeholder="Maple Ridge HOA" onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Board contact email (vendors’ replies go here)
            <input
              required
              type="email"
              value={contactEmail}
              placeholder="treasurer@example.com"
              onChange={(e) => setContactEmail(e.target.value)}
            />
          </label>
        </div>
      </section>
      <section aria-labelledby="create-requirements-heading">
        <h2 id="create-requirements-heading">What you require of every vendor</h2>
        <p className="hint">Prefilled with the default association template. Change it to match your vendor policy.</p>
        <RequirementsFields
          form={requirementsForm}
          onChange={(key, value) => setRequirementsForm((form) => ({ ...form, [key]: value }))}
          holderLabel="Certificate holder name (blank: the association name)"
          holderPlaceholder="Maple Ridge Homeowners Association, Inc."
        />
      </section>
      {message && (
        <p role="alert" className="message">
          {message}
        </p>
      )}
      <div className="actions">
        <button type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create dashboard'}
        </button>
      </div>
    </form>
  );
}

function VendorDashboard({ dashboardKey, justCreated }: { dashboardKey: string; justCreated: boolean }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const authorization = `Bearer ${dashboardKey}`;

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/vendors', { headers: { authorization } });
      const body = await readJson(response);
      if (response.ok) {
        setData(body as unknown as DashboardData);
        setFailed(false);
      } else {
        setFailed(true);
        setMessage(errorMessage(body, 'The vendor list could not be loaded.'));
      }
    } catch {
      setMessage(OFFLINE);
    }
  }, [authorization]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(vendor: VendorView) {
    if (!window.confirm(`Remove ${vendor.name}? Reminders to them stop; their check history is kept.`)) return;
    try {
      const response = await fetch(`/api/vendors/${vendor.id}`, { method: 'DELETE', headers: { authorization } });
      if (!response.ok) setMessage(errorMessage(await readJson(response), 'The vendor could not be removed.'));
      await load();
    } catch {
      setMessage(OFFLINE);
    }
  }

  /** The key travels in a header, never in a URL, so the file is fetched here and saved from a blob. */
  async function downloadLog() {
    setMessage(null);
    try {
      const response = await fetch('/api/checks/export', { headers: { authorization } });
      if (!response.ok) {
        setMessage(errorMessage(await readJson(response), 'The check log could not be downloaded.'));
        return;
      }
      const filename = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1];
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = filename ?? 'covercheck-checks.csv';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), BLOB_URL_LIFETIME_MS);
    } catch {
      setMessage(OFFLINE);
    }
  }

  if (failed) {
    return (
      <p role="alert" className="message">
        {message} <a href="/dashboard">Set up a new dashboard</a>
      </p>
    );
  }
  if (!data) return <p className="hint">{message ?? 'Loading your vendors…'}</p>;

  const link = `${window.location.origin}/dashboard#${new URLSearchParams({ k: dashboardKey })}`;
  return (
    <>
      <h2 className="association">{data.association.name}</h2>
      <details className="notice" open={justCreated}>
        <summary>Your private dashboard link: bookmark it</summary>
        <input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Private dashboard link" />
        <p className="hint">
          Anyone with this link can see and change your vendor list, so share it only with your board. There is no
          password to reset: if you lose the link, you’ll have to set up a new dashboard.
        </p>
      </details>

      {message && (
        <p role="alert" className="message">
          {message}
        </p>
      )}

      <section aria-labelledby="vendors-heading">
        <h2 id="vendors-heading">Vendors, soonest expiry first</h2>
        <VendorTable vendors={data.vendors} dashboardKey={dashboardKey} onRemove={remove} />
        <p className="hint">
          covercheck emails each vendor, with their insurance agent in copy, {REMINDER_WINDOWS.join(', ')} days before their
          certificate expires. Replies go to {data.association.contactEmail}.
        </p>
        <div className="actions log">
          <button type="button" className="secondary" onClick={() => void downloadLog()}>
            Download check log (CSV)
          </button>
          <span className="hint">Every check saved here, with date, verdict and failed rules, for your board minutes.</span>
        </div>
      </section>

      <AddVendorForm authorization={authorization} onAdded={load} />

      <section aria-labelledby="requirements-summary-heading">
        <h2 id="requirements-summary-heading">Your requirements</h2>
        <ul>
          {requirementLines(data.association.requirements, data.association.name).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
    </>
  );
}

function daysText(daysLeft: number | null): string {
  if (daysLeft === null) return '';
  const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
  if (daysLeft > 0) return `in ${days(daysLeft)}`;
  return daysLeft === 0 ? 'expired today' : `expired ${days(-daysLeft)} ago`;
}

export function VendorTable({
  vendors,
  dashboardKey,
  onRemove,
}: {
  vendors: VendorView[];
  dashboardKey: string;
  onRemove: (vendor: VendorView) => void;
}) {
  if (!vendors.length) {
    return <p className="hint">No vendors yet. Add the landscapers, roofers and plumbers you hire below.</p>;
  }
  const fragment = new URLSearchParams({ k: dashboardKey }).toString();
  return (
    <div className="table-wrap">
      <table className="vendors">
        <thead>
          <tr>
            <th>Status</th>
            <th>Vendor</th>
            <th>Certificate expires</th>
            <th>Last checked</th>
            <th>
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {vendors.map((vendor) => (
            <tr key={vendor.id} className={`status-${vendor.status}`}>
              <td>
                <span className="pill">{vendor.statusLabel}</span>
              </td>
              <td>
                <strong>{vendor.name}</strong>
                <div className="hint">
                  {vendor.contactEmail}
                  {vendor.agentEmail && ` · agent ${vendor.agentEmail}`}
                </div>
                {vendor.failedReasons.length > 0 && (
                  <ul className="reasons">
                    {vendor.failedReasons.map((reason, i) => (
                      <li key={i}>{reason}</li>
                    ))}
                  </ul>
                )}
              </td>
              <td data-label="Certificate expires">
                {vendor.expiryDate ?? '—'}
                {vendor.expiryDate && <div className="hint">{daysText(vendor.daysLeft)}</div>}
              </td>
              <td data-label="Last checked">{vendor.checkedOn ?? 'Never'}</td>
              <td>
                <div className="row-actions">
                  <a className="button" href={`/check?vendor=${encodeURIComponent(vendor.id)}#${fragment}`}>
                    Check certificate
                  </a>
                  <a className="button secondary" href={vendor.requestHref}>
                    Request updated certificate
                  </a>
                  <button type="button" className="link" onClick={() => onRemove(vendor)}>
                    Remove
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AddVendorForm({ authorization, onAdded }: { authorization: string; onAdded: () => Promise<void> }) {
  const empty = { name: '', contactEmail: '', agentEmail: '' };
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const set = (key: keyof typeof empty, value: string) => setForm((current) => ({ ...current, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch('/api/vendors', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization },
        body: JSON.stringify(form),
      });
      if (response.ok) {
        setForm(empty);
        await onAdded();
      } else {
        setMessage(errorMessage(await readJson(response), 'The vendor could not be added.'));
      }
    } catch {
      setMessage(OFFLINE);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="add-vendor-heading">
      <h2 id="add-vendor-heading">Add a vendor</h2>
      <form className="grid" onSubmit={submit}>
        <label>
          Vendor name (as on your contract)
          <input required maxLength={200} value={form.name} placeholder="Acme Landscaping" onChange={(e) => set('name', e.target.value)} />
        </label>
        <label>
          Vendor contact email
          <input
            required
            type="email"
            value={form.contactEmail}
            placeholder="office@acme.example"
            onChange={(e) => set('contactEmail', e.target.value)}
          />
        </label>
        <label>
          Insurance agent email (optional)
          <input type="email" value={form.agentEmail} placeholder="certs@agency.example" onChange={(e) => set('agentEmail', e.target.value)} />
        </label>
        <div className="actions">
          <button type="submit" disabled={busy}>
            {busy ? 'Adding…' : 'Add vendor'}
          </button>
        </div>
      </form>
      {message && (
        <p role="alert" className="message">
          {message}
        </p>
      )}
    </section>
  );
}

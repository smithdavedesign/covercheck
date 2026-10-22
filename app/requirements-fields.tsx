import type { RequirementsForm } from '../lib/form';

interface Props {
  form: RequirementsForm;
  onChange: <K extends keyof RequirementsForm>(key: K, value: RequirementsForm[K]) => void;
  /** Read-only, e.g. when checking against an association's saved requirements. */
  disabled?: boolean;
  holderLabel?: string;
  holderPlaceholder?: string;
}

/** The association's requirements as form inputs; shared by the checker and the dashboard setup. */
export function RequirementsFields({
  form,
  onChange,
  disabled = false,
  holderLabel = 'Association name (must be the certificate holder)',
  holderPlaceholder = 'Maple Ridge Homeowners Association',
}: Props) {
  return (
    <fieldset className="grid plain" disabled={disabled}>
      <label>
        {holderLabel}
        <input value={form.certificateHolder} placeholder={holderPlaceholder} onChange={(e) => onChange('certificateHolder', e.target.value)} />
      </label>
      <label>
        Each occurrence minimum ($)
        <input
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={form.eachOccurrence}
          onChange={(e) => onChange('eachOccurrence', e.target.value)}
        />
      </label>
      <label>
        General aggregate minimum ($)
        <input
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={form.aggregate}
          onChange={(e) => onChange('aggregate', e.target.value)}
        />
      </label>
      <label>
        Required additional insured endorsements
        <input value={form.requiredEndorsements} onChange={(e) => onChange('requiredEndorsements', e.target.value)} />
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={form.workersCompRequired}
          onChange={(e) => onChange('workersCompRequired', e.target.checked)}
        />
        Workers’ compensation required
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={form.additionalInsuredWording}
          onChange={(e) => onChange('additionalInsuredWording', e.target.checked)}
        />
        Additional insured wording required in the description
      </label>
    </fieldset>
  );
}

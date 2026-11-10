'use client';
// Kayıt adım 2 (042 §3.1; 053-01 §5): meslek başvurusu. `POST /api/v1/me/lawyer-application`.
// Baro yalnız kanonik listeden seçilir (serbest metin yok); sicil ile stajyer sicili ayrı alanlardır.
// Davet kabulünde aynı form `invitationId` ile kullanılır (053-01 §8).
import { BARO_NAMES } from '@eda/legal/courts';
import {
  Button,
  Checkbox,
  Combobox,
  Field,
  Input,
  RadioGroup,
  turkishComboboxFilter,
} from '@eda/ui';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { AuthApiError, submitLawyerApplication } from '../../lib/auth-api.ts';
import { AuthErrorNotice } from './auth-notice.tsx';

const REGISTRY_RE = /^[0-9A-Za-z/-]{1,20}$/;
const PARTNER_RE = /^[A-Z0-9-]{4,32}$/;

export function ProfessionForm({
  invitationId,
  withReferral = true,
  submitLabel,
  onDone,
}: {
  invitationId?: string;
  withReferral?: boolean;
  submitLabel?: string;
  onDone: (result: { partnerCodeAccepted: boolean | null }) => void;
}) {
  const t = useTranslations('auth.profession');
  const [kind, setKind] = useState<'lawyer' | 'trainee'>('lawyer');
  const [baro, setBaro] = useState<string | null>(null);
  const [registry, setRegistry] = useState('');
  const [partner, setPartner] = useState('');
  const [declare, setDeclare] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [apiError, setApiError] = useState<AuthApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const options = useMemo(() => BARO_NAMES.map((n) => ({ value: n, label: n })), []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setApiError(null);
    const errs: Record<string, string> = {};
    if (baro === null) errs.baro = t('errors.baro');
    if (!REGISTRY_RE.test(registry.trim())) errs.registry = t('errors.sicil');
    // Yalnız ASCII: `toUpperCase` Türkçe harf kuralı gerektirmez, kod alfabesi A-Z, 0-9, -.
    const code = partner.trim().replace(/[a-z]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 32));
    if (code !== '' && !PARTNER_RE.test(code)) errs.partner = t('errors.partnerCode');
    if (!declare) errs.declare = t('errors.required');
    setErrors(errs);
    if (Object.keys(errs).length > 0 || baro === null) return;
    setBusy(true);
    try {
      const r = await submitLawyerApplication({
        kind,
        baro,
        ...(kind === 'lawyer'
          ? { sicilNo: registry.trim() }
          : { traineeRegistryNo: registry.trim() }),
        ...(code !== '' ? { partnerCode: code } : {}),
        declareProfession: true,
        ...(invitationId ? { invitationId } : {}),
      });
      const accepted = r.partnerCodeAccepted;
      onDone({ partnerCodeAccepted: typeof accepted === 'boolean' ? accepted : null });
    } catch (err) {
      setApiError(
        err instanceof AuthApiError
          ? err
          : new AuthApiError({ status: 0, code: 'CLIENT_NETWORK', message: '' }),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-5" aria-busy={busy}>
      {apiError && <AuthErrorNotice error={apiError} />}
      <RadioGroup
        legend={t('kind')}
        value={kind}
        onValueChange={setKind}
        orientation="horizontal"
        options={[
          { value: 'lawyer', label: t('lawyer') },
          { value: 'trainee', label: t('trainee') },
        ]}
      />
      <Field label={t('baro')} {...(errors.baro ? { error: errors.baro } : {})}>
        <Combobox
          options={options}
          value={baro}
          onValueChange={setBaro}
          filter={turkishComboboxFilter}
          emptyLabel={t('baroEmpty')}
          labels={{ toggle: t('baroToggle') }}
          placeholder={t('baroPlaceholder')}
        />
      </Field>
      <Field
        label={kind === 'lawyer' ? t('sicil') : t('traineeNo')}
        description={t('sicilHelp')}
        {...(errors.registry ? { error: errors.registry } : {})}
      >
        <Input
          value={registry}
          onChange={(e) => setRegistry(e.target.value)}
          autoComplete="off"
          inputMode="text"
        />
      </Field>
      {withReferral && (
        <details className="rounded-md border border-border px-3 py-2">
          <summary className="cursor-pointer text-body-sm text-fg-muted focus-visible:focus-ring">
            {t('referral')}
          </summary>
          <div className="pt-3">
            <Field
              label={t('referralLabel')}
              {...(errors.partner ? { error: errors.partner } : {})}
            >
              <Input
                value={partner}
                onChange={(e) => setPartner(e.target.value)}
                autoComplete="off"
              />
            </Field>
          </div>
        </details>
      )}
      <div className="flex flex-col gap-1.5">
        <Checkbox checked={declare} onCheckedChange={setDeclare} label={t('declare')} />
        {errors.declare && <p className="text-body-sm text-danger">{errors.declare}</p>}
      </div>
      <Button type="submit" fullWidth loading={busy} loadingLabel={t('submitting')}>
        {submitLabel ?? t('submit')}
      </Button>
    </form>
  );
}

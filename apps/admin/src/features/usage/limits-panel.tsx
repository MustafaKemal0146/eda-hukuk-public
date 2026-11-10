'use client';
// Limitler sekmesi: platform varsayılanları (görünüm) ve büro bazlı geçersiz kılma. Yazma işlemleri
// yeniden doğrulama (step-up) ister ve denetim kaydına yazılır; kullanıcı bazlı limit bu
// ekranda yoktur. Değerler yalnız sayıdır.
import type { AdminLimitsResponseValue, OrgLimitKey } from '@eda/contracts/api/admin-usage';
import {
  Badge,
  Button,
  Card,
  Dialog,
  ErrorState,
  Field,
  Input,
  Select,
  Skeleton,
  Table,
  Td,
  Th,
  Tr,
} from '@eda/ui';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStepUp } from '../../components/step-up.tsx';
import { AdminApiError, adminFetch } from '../../lib/admin-api.ts';
import { parseLimitValue, UUID_RE } from './usage-model.ts';

type Item = AdminLimitsResponseValue['items'][number];
type Confirm =
  | { kind: 'set'; orgId: string; key: OrgLimitKey; value: number; before: string }
  | { kind: 'remove'; orgId: string; key: OrgLimitKey };

const GROUP_ORDER = [
  'chat',
  'costGuard',
  'credits',
  'rateLimit',
  'upload',
  'files',
  'kvkk',
  'sources',
  'trial',
] as const;

export function LimitsPanel({ initialOrgId }: { initialOrgId: string }) {
  const t = useTranslations('usage.limits');
  const format = useFormatter();
  const stepUp = useStepUp();
  const [data, setData] = useState<AdminLimitsResponseValue | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [orgId, setOrgId] = useState(initialOrgId);
  const [key, setKey] = useState<OrgLimitKey | ''>('');
  const [valueRaw, setValueRaw] = useState('');
  const [touched, setTouched] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    setOrgId(initialOrgId);
  }, [initialOrgId]);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const r = await adminFetch<AdminLimitsResponseValue>('/limits');
      setData(r);
      setKey((cur) => (cur === '' ? (r.overridableKeys[0] ?? '') : cur));
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const show = (v: unknown): string =>
    v === null || v === undefined
      ? '—'
      : typeof v === 'number'
        ? format.number(v)
        : Array.isArray(v)
          ? v.join(', ')
          : String(v);

  const byKey = useMemo(() => new Map((data?.items ?? []).map((i) => [i.key, i] as const)), [data]);
  const groups = useMemo(() => {
    const out = new Map<string, Item[]>();
    for (const i of data?.items ?? []) out.set(i.group, [...(out.get(i.group) ?? []), i]);
    return GROUP_ORDER.filter((g) => out.has(g)).map((g) => [g, out.get(g) ?? []] as const);
  }, [data]);

  const orgValid = UUID_RE.test(orgId.trim());
  const parsed = parseLimitValue(valueRaw);
  const platformDefault = key === '' ? undefined : byKey.get(key);

  function review() {
    setTouched(true);
    setNotice(null);
    if (!orgValid || parsed === null || key === '') return;
    const id = orgId.trim().toLocaleLowerCase('tr-TR');
    const existing = data?.overrides.find((o) => o.orgId === id && o.key === key);
    setConfirm({
      kind: 'set',
      orgId: id,
      key,
      value: parsed,
      before: existing ? show(existing.value) : show(platformDefault?.effectiveValue),
    });
  }

  async function run() {
    if (confirm === null) return;
    setBusy(true);
    try {
      const path = `/limits/orgs/${confirm.orgId}/${confirm.key}`;
      await stepUp.run(() =>
        confirm.kind === 'set'
          ? adminFetch(path, { method: 'PUT', body: { value: confirm.value } })
          : adminFetch(path, { method: 'DELETE' }),
      );
      setNotice({ tone: 'ok', text: confirm.kind === 'set' ? t('saved') : t('removed') });
      setConfirm(null);
      if (confirm.kind === 'set') {
        setValueRaw('');
        setTouched(false);
      }
      await load();
    } catch (e) {
      setConfirm(null);
      setNotice({
        tone: 'error',
        text:
          e instanceof AdminApiError && e.code === 'VALIDATION_ROUTE_NOT_FOUND'
            ? t('notFound')
            : t('actionError'),
      });
    } finally {
      setBusy(false);
    }
  }

  const when = (iso: string) =>
    format.dateTime(new Date(iso), {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <>
      <p className="text-body-sm text-fg-muted">{t('intro')}</p>
      {notice && (
        <p
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={`text-body-sm ${notice.tone === 'error' ? 'text-danger' : 'text-fg'}`}
        >
          {notice.text}
        </p>
      )}
      {state === 'loading' && (
        <div aria-busy="true" className="flex flex-col gap-3">
          <span className="sr-only">{t('loading')}</span>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}
      {state === 'error' && (
        <ErrorState
          title={t('error')}
          onRetry={() => void load()}
          labels={{
            retry: t('retry'),
            retrying: t('loading'),
            supportCode: '',
            copy: '',
            copied: '',
          }}
        />
      )}
      {state === 'ready' && data && (
        <>
          <section aria-labelledby="gecersiz" className="flex flex-col gap-3">
            <h2 id="gecersiz" className="text-title text-fg">
              {t('overrides')}
            </h2>
            {data.overrides.length === 0 ? (
              <p className="text-body-sm text-fg-muted">{t('overridesEmpty')}</p>
            ) : (
              <Table caption={t('overrides')}>
                <thead>
                  <tr>
                    <Th>{t('org')}</Th>
                    <Th>{t('key')}</Th>
                    <Th>{t('value')}</Th>
                    <Th>{t('updated')}</Th>
                    <Th>
                      <span className="sr-only">{t('actions')}</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {data.overrides.map((o) => (
                    <Tr key={`${o.orgId}:${o.key}`}>
                      <Td>
                        <span className="block text-fg">{o.orgLabel}</span>
                        <span className="block font-mono text-caption text-fg-subtle">
                          {o.orgId}
                        </span>
                      </Td>
                      <Td className="font-mono text-caption">{o.key}</Td>
                      <Td className="tabular-nums">{show(o.value)}</Td>
                      <Td className="tabular-nums">{when(o.updatedAt)}</Td>
                      <Td>
                        <div className="flex flex-wrap gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setOrgId(o.orgId);
                              setKey(o.key);
                              setValueRaw(String(o.value));
                              setTouched(false);
                              setNotice(null);
                            }}
                          >
                            {t('edit')}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setNotice(null);
                              setConfirm({ kind: 'remove', orgId: o.orgId, key: o.key });
                            }}
                          >
                            {t('remove')}
                          </Button>
                        </div>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}

            <Card className="flex flex-col gap-4 p-5">
              <h3 className="text-body font-medium text-fg">{t('new')}</h3>
              <div className="grid gap-4 md:grid-cols-3">
                <Field
                  label={t('orgId')}
                  description={t('orgIdHint')}
                  error={touched && !orgValid ? t('orgIdInvalid') : undefined}
                >
                  <Input
                    value={orgId}
                    onChange={(e) => setOrgId(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono"
                  />
                </Field>
                <Field label={t('keyLabel')}>
                  <Select
                    value={key}
                    onChange={(e) => setKey(e.target.value as OrgLimitKey)}
                    options={data.overridableKeys.map((k) => ({ value: k, label: k }))}
                  />
                </Field>
                <Field
                  label={t('valueLabel')}
                  description={t('valueHint', { default: show(platformDefault?.effectiveValue) })}
                  error={touched && parsed === null ? t('valueInvalid') : undefined}
                >
                  <Input
                    inputMode="numeric"
                    value={valueRaw}
                    onChange={(e) => setValueRaw(e.target.value)}
                    autoComplete="off"
                    className="tabular-nums"
                  />
                </Field>
              </div>
              <div>
                <Button onClick={review}>{t('save')}</Button>
              </div>
            </Card>
          </section>

          <section aria-labelledby="platform" className="flex flex-col gap-3">
            <h2 id="platform" className="text-title text-fg">
              {t('platform')}
            </h2>
            {groups.map(([g, items]) => (
              <Table key={g} caption={t(`group.${g}`)}>
                <thead>
                  <tr>
                    <Th>{t('key')}</Th>
                    <Th>{t('default')}</Th>
                    <Th>{t('effective')}</Th>
                    <Th>{t('source')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <Tr key={i.key}>
                      <Td>
                        <span className="block font-mono text-caption text-fg">{i.key}</span>
                        <span className="mt-1 flex flex-wrap gap-1">
                          {i.orgOverridable && <Badge tone="primary">{t('orgOverridable')}</Badge>}
                          {i.adminEditable && <Badge tone="neutral">{t('adminEditable')}</Badge>}
                        </span>
                      </Td>
                      <Td className="tabular-nums">{show(i.defaultValue)}</Td>
                      <Td className="tabular-nums">{show(i.effectiveValue)}</Td>
                      <Td>
                        {i.source === 'system_setting' ? t('sourceSetting') : t('sourceDefault')}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            ))}
          </section>
        </>
      )}

      <Dialog
        open={confirm !== null}
        onOpenChange={(o) => {
          if (!o) setConfirm(null);
        }}
        title={confirm?.kind === 'remove' ? t('removeTitle') : t('confirmTitle')}
        description={
          confirm === null
            ? undefined
            : confirm.kind === 'set'
              ? t('confirmBody', {
                  key: confirm.key,
                  before: confirm.before,
                  after: show(confirm.value),
                })
              : t('removeBody', { key: confirm.key })
        }
        labels={{ close: t('close') }}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              {t('cancel')}
            </Button>
            <Button loading={busy} loadingLabel={t('working')} onClick={() => void run()}>
              {confirm?.kind === 'remove' ? t('removeConfirm') : t('confirm')}
            </Button>
          </>
        }
      >
        {confirm && <p className="font-mono text-caption text-fg-muted">{confirm.orgId}</p>}
      </Dialog>
      {stepUp.dialog}
    </>
  );
}

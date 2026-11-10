'use client';
// Yönetim girişi güvenliği özeti: başarısız deneme ve kilitlenme SAYAÇLARI. IP, e-posta ve kimlik
// gösterilmez (api yalnız sayı ve kod benzeri neden anahtarı döndürür).
import type { AuditLoginFailuresResponseValue } from '@eda/contracts/api/admin-audit';
import { Badge, Button, Card, Skeleton } from '@eda/ui';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { adminFetch } from '../../lib/admin-api.ts';
import { loginReasonKey } from './model.ts';

type Run = <T>(fn: () => Promise<T>) => Promise<T>;
type State =
  | { kind: 'loading' }
  | { kind: 'ready'; data: AuditLoginFailuresResponseValue }
  | { kind: 'error' };

export function LoginFailuresView({ data }: { data: AuditLoginFailuresResponseValue }) {
  const t = useTranslations('audit.loginFailures');
  const format = useFormatter();
  const n = (v: number) => format.number(v);
  return (
    <>
      <dl className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <dt className="text-caption text-fg-subtle">{t('failures24h')}</dt>
          <dd className="font-display text-heading-lg tabular-nums text-fg">
            {n(data.failures24h)}
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-caption text-fg-subtle">{t('failures7d')}</dt>
          <dd className="font-display text-heading-lg tabular-nums text-fg">
            {n(data.failures7d)}
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-caption text-fg-subtle">{t('lockouts24h')}</dt>
          <dd className="flex items-center gap-2 font-display text-heading-lg tabular-nums text-fg">
            {n(data.lockouts24h)}
            {data.lockouts24h > 0 && (
              <Badge tone="warning" icon="notice.warning">
                {t('reason.backoff')}
              </Badge>
            )}
          </dd>
        </div>
      </dl>
      {data.byReason.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-caption text-fg-subtle">{t('reasons')}</p>
          <ul className="flex flex-wrap gap-2">
            {data.byReason.map((r) => (
              <li key={r.key}>
                <Badge tone="neutral">
                  {t(`reason.${loginReasonKey(r.key)}`)}: {n(r.count)}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-caption text-fg-subtle">{t('note')}</p>
    </>
  );
}

export function LoginFailuresCard({ run }: { run: Run }) {
  const t = useTranslations('audit.loginFailures');
  const [state, setState] = useState<State>({ kind: 'loading' });
  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const data = await run(() =>
        adminFetch<AuditLoginFailuresResponseValue>('/audit/login-failures'),
      );
      setState({ kind: 'ready', data });
    } catch {
      setState({ kind: 'error' });
    }
  }, [run]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card className="flex flex-col gap-3 p-5" aria-labelledby="giris-guvenligi">
      <div>
        <h2 id="giris-guvenligi" className="text-title text-fg">
          {t('title')}
        </h2>
        <p className="text-body-sm text-fg-muted">{t('intro')}</p>
      </div>
      {state.kind === 'loading' && (
        <div aria-busy="true">
          <span className="sr-only">{t('loading')}</span>
          <Skeleton className="h-16 w-full" />
        </div>
      )}
      {state.kind === 'error' && (
        <div className="flex items-center gap-3">
          <p className="text-body-sm text-fg-muted">{t('error')}</p>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            {t('retry')}
          </Button>
        </div>
      )}
      {state.kind === 'ready' && <LoginFailuresView data={state.data} />}
    </Card>
  );
}

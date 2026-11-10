'use client';
// Kullanıcı ayrıntısında "API anahtarı" bölümü: süper yönetici kullanıcıya Anthropic API anahtarı
// atar, değiştirir veya siler (Yapay zekâ sayfasındaki aynı pencereler). Durum yalnız tanımlı/yok, kaynak,
// son 4 hane ve zamandır; anahtar hiçbir yanıtta dönmez. Büro anahtarı için Yapay zekâ sayfasındaki
// "Büro / baro" listesine bağlantı verilir.
import type { AdminAiKeyUserListResponseValue } from '@eda/contracts/api/admin-ai-keys';
import { Badge, Button, Card } from '@eda/ui';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { adminFetch } from '../../lib/admin-api.ts';
import { type KeyItem, slotTone, withKind } from '../ai/ai-keys-model.ts';
import { KeyAssignDialog, KeyRemoveDialog, type StepUpRun } from '../ai/key-dialogs.tsx';

type State = 'loading' | 'ready' | 'error';

export function UserKeySection({
  userId,
  run,
  canWrite,
}: {
  userId: string;
  run: StepUpRun;
  canWrite: boolean;
}) {
  const t = useTranslations('users.apiKey');
  const tk = useTranslations('ai.keys');
  const format = useFormatter();
  const [item, setItem] = useState<KeyItem | null>(null);
  const [state, setState] = useState<State>('loading');
  const [assign, setAssign] = useState<KeyItem | null>(null);
  const [remove, setRemove] = useState<KeyItem | null>(null);
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    try {
      // Arama metni URL'de taşınmaz: kimlikle tek kayıt aranır.
      const r = await run(() =>
        adminFetch<AdminAiKeyUserListResponseValue>('/ai/keys/users/search', {
          method: 'POST',
          body: { query: userId, limit: 1 },
        }),
      );
      const found = r.items.find((x) => x.userId === userId);
      setItem(found === undefined ? null : withKind.user(found));
      setState('ready');
    } catch {
      setState('error');
    }
  }, [run, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function applied() {
    setDone(true);
    await load();
  }

  const slot = item?.kind === 'user' ? item.key : null;
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div>
        <h2 className="text-title text-fg">{t('title')}</h2>
        <p className="text-body-sm text-fg-muted">{t('intro')}</p>
      </div>
      {state === 'loading' && (
        <p aria-busy="true" className="text-body-sm text-fg-muted">
          {t('loading')}
        </p>
      )}
      {state === 'error' && (
        <p role="alert" className="text-body-sm text-danger">
          {t('error')}
        </p>
      )}
      {done && (
        <p role="status" className="text-body-sm text-success">
          {tk('done')}
        </p>
      )}
      {state === 'ready' && item !== null && item.kind === 'user' && slot !== null && (
        <>
          <dl className="grid gap-x-6 gap-y-3 text-body-sm sm:grid-cols-4">
            <div>
              <dt className="text-caption text-fg-subtle">{t('status')}</dt>
              <dd>
                <Badge tone={slotTone(slot)}>
                  {slot.configured ? tk('state.configured') : tk('state.none')}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-caption text-fg-subtle">{t('source')}</dt>
              <dd>{tk(`source.${item.source}`)}</dd>
            </div>
            <div>
              <dt className="text-caption text-fg-subtle">{tk('table.last4')}</dt>
              <dd className="font-mono">{slot.last4 ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-caption text-fg-subtle">{tk('table.updated')}</dt>
              <dd>
                {slot.updatedAt === null
                  ? '—'
                  : format.dateTime(new Date(slot.updatedAt), {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
              </dd>
            </div>
          </dl>
          {canWrite && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setDone(false);
                  setAssign(item);
                }}
              >
                {slot.configured ? tk('replace') : tk('assign')}
              </Button>
              <Button
                variant="outline"
                disabled={!slot.configured}
                onClick={() => {
                  setDone(false);
                  setRemove(item);
                }}
              >
                {tk('remove')}
              </Button>
            </div>
          )}
        </>
      )}
      {state === 'ready' && item === null && (
        <p className="text-body-sm text-fg-muted">{t('notFound')}</p>
      )}
      <p className="text-body-sm text-fg-muted">
        {t('orgHint')}{' '}
        <Link
          href="/yapay-zeka#ai-anahtar"
          className="rounded-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:focus-ring"
        >
          {t('orgLink')}
        </Link>
      </p>
      <KeyAssignDialog
        target={assign}
        run={run}
        onClose={() => setAssign(null)}
        onApplied={applied}
      />
      <KeyRemoveDialog
        target={remove}
        run={run}
        onClose={() => setRemove(null)}
        onApplied={applied}
      />
    </Card>
  );
}

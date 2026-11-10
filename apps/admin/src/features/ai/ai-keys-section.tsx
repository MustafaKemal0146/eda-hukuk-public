'use client';
// "Anahtar ataması" bölümü: platform ortak anahtarı kartı (anahtar girme/ad/silme,
// düşüş anahtarı, limitler; `platform-key-card.tsx`) ve büro/kullanıcıya Anthropic anahtarı atama/silme
// (pencereler `key-dialogs.tsx`; Kullanıcılar ayrıntısı aynı pencereleri kullanır). Anahtar alanı password
// türündedir, kayıttan hemen sonra temizlenir ve hiçbir yerde saklanmaz; hiçbir yanıt anahtarı taşımaz
// (yalnız ad, son 4 karakter ve durum). Her değişiklik yeniden doğrulama (step-up) ister; denetim sunucuda.
import type {
  AdminAiKeyOrgListResponseValue,
  AdminAiKeyUserListResponseValue,
  AdminAiPlatformKeyDtoValue,
} from '@eda/contracts/api/admin-ai-keys';
import {
  Badge,
  Button,
  Field,
  Input,
  SegmentedControl,
  Skeleton,
  Table,
  Td,
  Th,
  Tr,
} from '@eda/ui';
import { useFormatter, useTranslations } from 'next-intl';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { useStepUp } from '../../components/step-up.tsx';
import { adminFetch } from '../../lib/admin-api.ts';
import { type KeyItem, type KeyKind, slotTone, targetLabel, withKind } from './ai-keys-model.ts';
import { KeyAssignDialog, KeyRemoveDialog } from './key-dialogs.tsx';
import { PlatformKeyCard } from './platform-key-card.tsx';

type ListState = { kind: 'loading' } | { kind: 'ready'; items: KeyItem[] } | { kind: 'error' };

export function AiKeysSection({ canWrite = true }: { canWrite?: boolean }) {
  const t = useTranslations('ai.keys');
  const format = useFormatter();
  const stepUp = useStepUp();
  const runStepUp = stepUp.run;
  const [card, setCard] = useState<AdminAiPlatformKeyDtoValue | null>(null);
  const [kind, setKind] = useState<KeyKind>('org');
  const [query, setQuery] = useState('');
  const [list, setList] = useState<ListState>({ kind: 'loading' });
  const [assign, setAssign] = useState<KeyItem | null>(null);
  const [remove, setRemove] = useState<KeyItem | null>(null);
  const [done, setDone] = useState(false);
  const [tooShort, setTooShort] = useState(false);

  const loadCard = useCallback(async () => {
    try {
      setCard(await adminFetch<AdminAiPlatformKeyDtoValue>('/ai/keys/platform'));
    } catch {
      setCard(null);
    }
  }, []);

  const loadList = useCallback(
    async (k: KeyKind, q: string) => {
      setList({ kind: 'loading' });
      const base = k === 'org' ? '/ai/keys/orgs' : '/ai/keys/users';
      try {
        const res = await runStepUp(() =>
          q === ''
            ? adminFetch<AdminAiKeyOrgListResponseValue | AdminAiKeyUserListResponseValue>(base)
            : adminFetch<AdminAiKeyOrgListResponseValue | AdminAiKeyUserListResponseValue>(
                `${base}/search`,
                { method: 'POST', body: { query: q } },
              ),
        );
        setList({
          kind: 'ready',
          items:
            k === 'org'
              ? (res as AdminAiKeyOrgListResponseValue).items.map(withKind.org)
              : (res as AdminAiKeyUserListResponseValue).items.map(withKind.user),
        });
      } catch {
        setList({ kind: 'error' });
      }
    },
    [runStepUp],
  );

  useEffect(() => {
    void loadCard();
    void loadList(kind, '');
    setQuery('');
    setTooShort(false);
  }, [kind, loadCard, loadList]);

  function submitSearch(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (q !== '' && q.length < 2) {
      setTooShort(true);
      return;
    }
    setTooShort(false);
    void loadList(kind, q);
  }

  /** Atama/silme sonrası liste ve kart yenilenir. */
  async function applied() {
    setDone(true);
    await loadList(kind, query.trim());
    await loadCard();
  }

  const when = (iso: string | null) =>
    iso === null
      ? '—'
      : format.dateTime(new Date(iso), { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <section aria-labelledby="ai-anahtar" className="flex flex-col gap-3">
      <h2 id="ai-anahtar" className="text-title text-fg">
        {t('title')}
      </h2>
      <p className="text-body-sm text-fg-muted">{t('intro')}</p>

      {card !== null && (
        <PlatformKeyCard card={card} run={runStepUp} canWrite={canWrite} onChanged={loadCard} />
      )}

      <div className="flex flex-wrap items-end gap-3">
        <SegmentedControl
          label={t('kind.label')}
          value={kind}
          onValueChange={setKind}
          options={[
            { value: 'org', label: t('kind.org') },
            { value: 'user', label: t('kind.user') },
          ]}
        />
        <form onSubmit={submitSearch} className="flex flex-wrap items-end gap-2" noValidate>
          <Field label={t('search.label')} {...(tooShort ? { error: t('search.short') } : {})}>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('search.placeholder')}
              autoComplete="off"
              maxLength={254}
            />
          </Field>
          <Button type="submit" variant="outline">
            {t('search.submit')}
          </Button>
          {query !== '' && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setQuery('');
                setTooShort(false);
                void loadList(kind, '');
              }}
            >
              {t('search.reset')}
            </Button>
          )}
        </form>
      </div>

      {done && (
        <p role="status" className="text-body-sm text-success">
          {t('done')}
        </p>
      )}

      {list.kind === 'loading' && (
        <div aria-busy="true" className="flex flex-col gap-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}
      {list.kind === 'error' && (
        <p role="alert" className="text-body-sm text-danger">
          {t('error.load')}
        </p>
      )}
      {list.kind === 'ready' &&
        (list.items.length === 0 ? (
          <p className="text-body-sm text-fg-muted">{t('table.empty')}</p>
        ) : (
          <Table caption={t('table.caption')}>
            <thead>
              <tr>
                <Th>{t('table.target')}</Th>
                <Th>{t('table.id')}</Th>
                <Th>{t('table.status')}</Th>
                {kind === 'user' && <Th>{t('table.source')}</Th>}
                <Th>{t('table.last4')}</Th>
                <Th>{t('table.updated')}</Th>
                <Th>{t('table.action')}</Th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((item) => (
                <Tr key={item.kind === 'org' ? item.orgId : item.userId}>
                  <Td className="font-medium">
                    {targetLabel(item)}
                    {item.kind === 'org' && (
                      <span className="block text-caption font-normal text-fg-subtle">
                        {t('table.orgKind', { kind: item.orgKind })}
                      </span>
                    )}
                  </Td>
                  <Td className="font-mono text-caption">{item.shortId}</Td>
                  <Td>
                    <Badge tone={slotTone(item.key)}>
                      {item.key.configured ? t('state.configured') : t('state.none')}
                    </Badge>
                  </Td>
                  {item.kind === 'user' && <Td>{t(`source.${item.source}`)}</Td>}
                  <Td className="font-mono">{item.key.last4 ?? '—'}</Td>
                  <Td>{when(item.key.updatedAt)}</Td>
                  <Td>
                    <span className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!canWrite}
                        onClick={() => {
                          setDone(false);
                          setAssign(item);
                        }}
                      >
                        {item.key.configured ? t('replace') : t('assign')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!canWrite || !item.key.configured}
                        onClick={() => {
                          setDone(false);
                          setRemove(item);
                        }}
                      >
                        {t('remove')}
                      </Button>
                    </span>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        ))}

      <KeyAssignDialog
        target={assign}
        run={runStepUp}
        onClose={() => setAssign(null)}
        onApplied={applied}
      />
      <KeyRemoveDialog
        target={remove}
        run={runStepUp}
        onClose={() => setRemove(null)}
        onApplied={applied}
      />
      {stepUp.dialog}
    </section>
  );
}

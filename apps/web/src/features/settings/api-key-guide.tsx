'use client';
// Kurum Paneli Claude API anahtarı rehberi (#57): anahtarın Anthropic Console'dan nasıl alınacağını
// anlatan açılır bölüm. Yalnız metin ve yönlendirme içerir; anahtar saklama, doğrulama ve şifreleme
// #54'ün alanıdır. Metinler `tr.json` `orgSettings.apiKeyGuide` altındadır.
import { Accordion, AccordionItem, Icon, NoticeBanner } from '@eda/ui';
import { useTranslations } from 'next-intl';

const STEP_KEYS = ['account', 'billing', 'limit', 'create', 'copy', 'save'] as const;
const WARNING_KEYS = ['share', 'storage', 'billing', 'revoke'] as const;

/** Tek dış bağlantı; başka alan adı eklenmez (#57). */
const CONSOLE_URL = 'https://console.anthropic.com';

export function ApiKeyGuide() {
  const t = useTranslations('orgSettings.apiKeyGuide');
  return (
    <Accordion defaultValue={['guide']}>
      <AccordionItem value="guide" title={t('title')} headingLevel={3}>
        <div className="flex flex-col gap-4">
          <p>{t('intro')}</p>
          <a
            href={CONSOLE_URL}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
            className="inline-flex min-h-control-sm w-fit items-center gap-1.5 text-primary underline-offset-2 hover:underline focus-visible:focus-ring pointer-coarse:min-h-11"
          >
            {t('consoleLink')}
            <Icon icon="action.external" size="sm" className="shrink-0" />
          </a>
          <ol className="flex flex-col gap-3">
            {STEP_KEYS.map((key) => (
              <li key={key} className="flex flex-col gap-0.5">
                <span className="font-medium text-fg">{t(`steps.${key}.title`)}</span>
                <span>{t(`steps.${key}.body`)}</span>
              </li>
            ))}
          </ol>
          <NoticeBanner tone="warning" title={t('warning.title')}>
            <ul className="flex list-disc flex-col gap-1 pl-4">
              {WARNING_KEYS.map((key) => (
                <li key={key}>{t(`warning.items.${key}`)}</li>
              ))}
            </ul>
          </NoticeBanner>
        </div>
      </AccordionItem>
    </Accordion>
  );
}

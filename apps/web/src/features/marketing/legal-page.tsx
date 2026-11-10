// Dört düz yasal sayfanın ortak sunucu çizimi (KVKK, koşullar, gizlilik, çerez). Güven Merkezi
// ayrı bir bileşendir (`trust-center.tsx`). Metin kataloğun `legal.pages.<sayfa>` alanındadır.
import { LEGAL_VERSIONS, type LegalVersionKey } from '@eda/contracts/legal-versions';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LegalDocument, type LegalDocumentProps } from './legal-document.tsx';
import { fillSection, type LegalSection } from './legal-model.ts';
import { fillConfig } from './placeholders.ts';
import type { Translator } from './translator.ts';

export type LegalPageKey = 'kvkk' | 'terms' | 'privacy' | 'cookies';

const VERSION_KEY: Record<LegalPageKey, LegalVersionKey> = {
  kvkk: 'privacyNoticeVersion',
  terms: 'termsVersion',
  privacy: 'privacyPolicyVersion',
  cookies: 'cookiePolicyVersion',
};

export async function legalMetadata(page: LegalPageKey): Promise<Metadata> {
  const t = await getTranslations('legal.pages');
  return {
    title: t(`${page}.title`),
    description: t(`${page}.description`),
    robots: { index: true, follow: true },
  };
}

/** Bir yasal sayfanın belge özellikleri; senkron ve saftır (test edilebilir). */
export function legalDocumentProps(page: LegalPageKey, t: Translator): LegalDocumentProps {
  return {
    title: t(`pages.${page}.title`),
    intro: fillConfig(String(t.raw(`pages.${page}.intro`))),
    draftNotice: t('draftNotice'),
    versionLine: t('doc.version', {
      version: LEGAL_VERSIONS[VERSION_KEY[page]],
      date: '{{YURURLUK_TARIHI}}',
    }),
    tocLabel: t('doc.toc'),
    sections: (t.raw(`pages.${page}.sections`) as LegalSection[]).map(fillSection),
    numbered: page !== 'cookies',
    tableLabel: (caption) => t('doc.tableRegion', { caption }),
  };
}

export async function LegalPage({ page }: { page: LegalPageKey }) {
  const t = await getTranslations('legal');
  return <LegalDocument {...legalDocumentProps(page, t)} />;
}

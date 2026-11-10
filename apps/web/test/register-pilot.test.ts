// @tk TK-28
// KK-pilot-2: kayıt ekranında kullanım koşulları onayının yanında pilot notu (gerçek müvekkil verisi
// işlenmez) görünür. Metin `tr.json` kataloğundadır. Veriler sentetiktir.
import { NextIntlClientProvider } from 'next-intl';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import messages from '../messages/tr.json';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));

describe('KK-pilot-2: kayıt ekranı pilot notu', () => {
  it('kullanım koşulları onayının hemen altında pilot notu çizilir', async () => {
    const { RegisterForm } = await import('../src/features/auth/register-form.tsx');
    const html = renderToStaticMarkup(
      createElement(NextIntlClientProvider, {
        locale: 'tr',
        messages,
        timeZone: 'Europe/Istanbul',
        children: createElement(RegisterForm),
      }),
    );
    const note = messages.auth.register.pilotNote;
    expect(note).toBe('Bu pilot sürümde gerçek müvekkil verisi işlenmez.');
    expect(html).toContain(note);
    expect(html.indexOf(note)).toBeGreaterThan(html.indexOf('/kullanim-kosullari'));
  });
});

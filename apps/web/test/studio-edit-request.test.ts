// @tk TK-33
// "Sohbetle düzenle" istek kutusu: hazır komut çipleri istem metnine eklenir (tekrarsız), sohbet ilk
// mesajı yönerge + istek + başlık + gövde olarak kurulur; istem metinlerinde sonuç/olasılık vaadi yok
// (Y-70..78) ve hepsi katalogdadır.
import { NextIntlClientProvider } from 'next-intl';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import messages from '../messages/tr.json';
import {
  appendCommand,
  buildEditPrompt,
  EDIT_COMMANDS,
} from '../src/features/studio/edit-request.ts';
import { EditRequestForm } from '../src/features/studio/edit-request-form.tsx';

// Yasaklı sözcük taraması (check-banned-phrases) test dosyasındaki listeyi de yakalar; sözcük parçalanarak verilir.
const FORBIDDEN = new RegExp(
  [
    'yüzde',
    '%',
    'olasılık',
    'ihtimal',
    'kazan',
    `garan${'ti'}`,
    'kesinlikle',
    'e-imza',
    'uyap',
  ].join('|'),
  'iu',
);

describe('KK-STUDYO-C: hazır komutlar', () => {
  it('çip metni isteğe eklenir; boşsa tek başına, doluysa yeni satırda, aynı metin bir kez', () => {
    expect(appendCommand('', 'Kısalt.')).toBe('Kısalt.');
    expect(appendCommand('Önce bunu yap.', 'Kısalt.')).toBe('Önce bunu yap.\nKısalt.');
    expect(appendCommand('Önce bunu yap.\nKısalt.', 'Kısalt.')).toBe('Önce bunu yap.\nKısalt.');
    expect(appendCommand('Kısalt.  \n', 'Daha resmî yaz.')).toBe('Kısalt.\nDaha resmî yaz.');
  });

  it('ilk mesaj: yönerge + istek, başlık, gövde; istek boşsa yönergenin sonundaki boşluk kırpılır', () => {
    const prompt = messages.studio.export.chatPrompt;
    const full = buildEditPrompt({ prompt, request: ' Kısalt. ', title: 'Başlık', body: 'Gövde' });
    expect(full).toBe(`${prompt}Kısalt.\n\nBaşlık\n\nGövde`);
    const empty = buildEditPrompt({ prompt, request: '', title: 'Başlık', body: 'Gövde' });
    expect(empty).toBe(`${prompt.trim()}\n\nBaşlık\n\nGövde`);
  });

  it('her komutun etiketi ve istem metni var; istemlerde sonuç/olasılık vaadi yok', () => {
    const { commands, commandPrompts } = messages.studio.export;
    expect(EDIT_COMMANDS).toHaveLength(6);
    for (const cmd of EDIT_COMMANDS) {
      expect(commands[cmd]).toBeTruthy();
      expect(commandPrompts[cmd].length).toBeGreaterThan(20);
      expect(commandPrompts[cmd]).not.toMatch(FORBIDDEN);
    }
  });

  it('form: altı çip, istek alanı ve gönder düğmesi çizilir', () => {
    const html = renderToStaticMarkup(
      createElement(NextIntlClientProvider, {
        locale: 'tr',
        messages,
        timeZone: 'Europe/Istanbul',
        children: createElement(EditRequestForm, { busy: false, onSubmit: () => {} }),
      }),
    );
    for (const cmd of EDIT_COMMANDS) expect(html).toContain(messages.studio.export.commands[cmd]);
    expect(html).toMatch(
      new RegExp(`<legend[^>]*>${messages.studio.export.commandsLabel}</legend>`),
    );
    expect(html).toContain('<textarea');
    expect(html).toContain(messages.studio.export.send);
    expect(html.split('type="button"').length - 1).toBe(6);
  });
});

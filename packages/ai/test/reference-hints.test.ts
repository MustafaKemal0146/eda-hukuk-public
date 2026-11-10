// @tk TK-28
// Doğrudan atıf yönlendirmesi: karar numarası / madde atfı sunucu notu TUR BAĞLAMI'na girer; chat.core
// öneki (golden) ve araç seti değişmez. Numaralar uydurmadır.
import { PROMPTS } from '@eda/contracts/prompts';
import { describe, expect, it } from 'vitest';
import { chatInstructions, turnFrame } from '../src/prompts/build.ts';
import { referenceHints } from '../src/prompts/reference-hints.ts';

const frame = (userText: string) =>
  turnFrame({ modeLabel: 'Müvekkil işi', scopeLabel: 'Tümü', sources: [], userText });

describe('referenceHints: karar numarası', () => {
  it('"Yargıtay 3. HD 2022/5000 E. 2023/100 K." için daire ve numara alanlarıyla çağrı önerir', () => {
    const h = referenceHints('Yargıtay 3. HD 2022/5000 E. 2023/100 K. kararını özetler misin?');
    expect(h).toContain('Sunucu notu');
    expect(h).toContain('esas_no="2022/5000"');
    expect(h).toContain('karar_no="2023/100"');
    expect(h).toContain('chamber="H3"');
    expect(h).toContain('court_types=["yargitay"]');
    expect(h).toContain('Konu araması yapma');
  });

  it('başlıksız "2023/1234 E., 2024/567 K." mahkeme belirtilmemiş notuyla numaraları verir', () => {
    const h = referenceHints('2023/1234 E., 2024/567 K. sayılı karar ne diyor?');
    expect(h).toContain('(mahkeme belirtilmemiş)');
    expect(h).toContain('esas_no="2023/1234", karar_no="2024/567"');
    expect(h).not.toContain('chamber=');
  });

  it('istinaf dairesi kodu chamber olarak gönderilmez; mahkeme türü istinaf olur', () => {
    const h = referenceHints('Ankara BAM 5. Hukuk Dairesi 2020/10 E. 2021/20 K.');
    expect(h).not.toContain('chamber=');
    expect(h).toContain('court_types=["istinaf_hukuk"]');
  });
});

describe('referenceHints: madde atfı', () => {
  it('"TBK 125", "HMK m. 119", "6098 sayılı Kanun 27. madde" için get_legislation_article önerir', () => {
    for (const [text, lawNo, art] of [
      ['TBK 125 ne diyor?', '6098', '125'],
      ['HMK m. 119 dilekçe unsurları', '6100', '119'],
      ['6098 sayılı Kanun 27. madde', '6098', '27'],
    ] as const) {
      const h = referenceHints(text);
      expect(h).toContain(`law_no="${lawNo}", article_no="${art}"`);
      expect(h).toContain('search_legislation çağırma');
    }
  });

  it('atıf yoksa not yok; notlar en çok 2 karar + 3 madde ile sınırlı', () => {
    expect(referenceHints('Kira sözleşmesinin feshi için ne yapmalıyım?')).toBeNull();
    const h = referenceHints('TMK m. 2, TBK m. 49, HMK m. 119, CMK m. 100 ve TCK m. 53') ?? '';
    expect(h.match(/Madde atfı:/g)).toHaveLength(3);
  });
});

describe('turn frame ve golden önek', () => {
  it('not TUR BAĞLAMI içinde, KULLANICI MESAJI öncesinde yer alır', () => {
    const f = frame('TBK 125 ne diyor?');
    const note = f.indexOf('Sunucu notu');
    expect(note).toBeGreaterThan(f.indexOf('[KAYNAK DİZİNİ]'));
    expect(note).toBeLessThan(f.indexOf('[KULLANICI MESAJI]'));
  });

  it('atıfsız mesajda çerçeve değişmez ve not satırı düşer', () => {
    const f = frame('Kira tahliye taahhüdü geçerli mi?');
    expect(f).not.toContain('Sunucu notu');
    expect(f).not.toContain('{{');
  });

  it('chat.core öneki değişmez (sürüm 4, metin birebir)', () => {
    expect(PROMPTS['chat.core'].version).toBe(4);
    expect(chatInstructions()).toBe(PROMPTS['chat.core'].text);
    expect(chatInstructions()).not.toContain('Sunucu notu');
  });
});

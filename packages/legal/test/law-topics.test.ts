// #12: konu sözcüklerinden kanun ipucu (mevzuat araması kanun adında arar, madde içeriğinde değil).
import { describe, expect, it } from 'vitest';
import { inferLawNosFromQuery } from '../src/kunye/index.ts';

describe('inferLawNosFromQuery', () => {
  it.each([
    ['yaya geçidinde yayaya çarpan sürücünün kusuru', '2918'],
    ['kiracının tahliye taahhüdü geçerli mi', '6098'],
    ['işçinin fazla mesai ücreti', '4857'],
    ['cinsel saldırı suçunun unsurları', '5237'],
    ['tutuklama kararına itiraz', '5271'],
    ['ilamsız takipte ödeme emrine itiraz', '2004'],
    ['kişisel veri ihlali bildirimi', '6698'],
  ])('%s → %s', (q, law) => {
    expect(inferLawNosFromQuery(q)[0]).toBe(law);
  });

  it('en çok eşleşen kanun öne gelir ve en çok max kadar döner', () => {
    const r = inferLawNosFromQuery('kira sözleşmesinde tahliye ve haciz', 2);
    expect(r[0]).toBe('6098');
    expect(r.length).toBeLessThanOrEqual(2);
  });

  it('konu sözcüğü yoksa veya sözcük ortasında eşleşiyorsa boş döner', () => {
    expect(inferLawNosFromQuery('genel bir soru')).toEqual([]);
    expect(inferLawNosFromQuery('Kayıtlı bir sicil')).toEqual([]);
  });
});

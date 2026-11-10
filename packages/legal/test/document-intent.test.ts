// Belge niyeti kapısı: "belge yaz" açık istek, "belge yazma" yasak, kuşkuda neutral.
import { describe, expect, it } from 'vitest';
import { detectDocumentIntent } from '../src/intent/index.ts';

const intent = (t: string) => detectDocumentIntent(t).intent;

describe('belge niyeti: açık istek (draft)', () => {
  it.each([
    'Kira tespit davası için dilekçe yaz.',
    'Bana bir ihtarname hazırla',
    'Cevap dilekçesi hazırlar mısın?',
    'Şu olay için bir dilekçe yazabilir misin?',
    'İş sözleşmesi taslağı oluştur',
    'Bir vekaletname metni çıkar',
    'Bana bir ihtarname lazım.',
    'Mütalaa yazalım',
    'bu konuda belge oluştur lütfen',
    'Kira artış ihtarnamesi kaleme al',
  ])('%s', (t) => {
    expect(intent(t)).toBe('draft');
  });

  it('belge türü ipucu verir', () => {
    expect(detectDocumentIntent('ihtarname hazırla').kind).toBe('notice');
    expect(detectDocumentIntent('sözleşme taslağı oluştur').kind).toBe('contract');
    expect(detectDocumentIntent('mütalaa yaz').kind).toBe('opinion');
    expect(detectDocumentIntent('dilekçe yaz').kind).toBe('petition');
  });
});

describe('belge niyeti: açık yasak (forbid)', () => {
  it.each([
    'belge yazma, sadece açıkla',
    'Dilekçe yazma, bana anlat',
    'Belge hazırlama istemiyorum',
    'taslak istemiyorum, görüşünü söyle',
    'Dilekçe yazmana gerek yok',
    'Sadece görüş ver',
    'Bunu sohbet olarak anlat',
    'belge olmadan açıkla',
    'ihtarname değil, bilgi istiyorum',
    'Belge oluşturma. Bu davada hangi süre geçerli?',
  ])('%s', (t) => {
    expect(intent(t)).toBe('forbid');
  });

  it('yasak, aynı mesajdaki istek kalıbından önce gelir', () => {
    expect(intent('Dilekçe yaz ama belge yazma modunu açma')).toBe('forbid');
  });
});

describe('belge niyeti: belirtilmedi (neutral)', () => {
  it.each([
    'Kiracının tahliye taahhüdü geçerli mi?',
    'Dilekçe ne zaman verilir?',
    'Dilekçe vermem gerekiyor mu?',
    'Bir ihtarname gerekiyor mu?',
    'Bu dilekçeyi incele',
    'TBK m. 352 ne diyor?',
    'Dilekçe yazım kuralları nelerdir?',
    'Sözleşmenin feshinde ispat yükü kimde?',
    'Emin değilim, ne yapmalıyım?',
    'Yargıtay kararlarını araştır',
  ])('%s', (t) => {
    expect(intent(t)).toBe('neutral');
  });
});

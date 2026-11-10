// TZ matrisi sondası (KK-083-13/14): altın vakaların motor çıktısını kanonik JSON olarak basar.
// `determinism.test.ts` bunu farklı `TZ` ortamlarında alt süreçte çalıştırıp çıktıları karşılaştırır.
import { calculateDeadline, canonicalJson } from '../../src/deadline-engine/index.ts';
import { allGoldenCases, catalogRule, ctxFor, holidayData } from './helpers.ts';

const data = holidayData();
const out = allGoldenCases().map((c) => {
  const r = calculateDeadline(
    {
      startEvent: c.input.startEvent,
      eventDate: c.input.eventDate,
      serviceMethod: c.input.serviceMethod,
    },
    ctxFor(catalogRule(c.ruleCode, { verified: true }), {
      holidays: data,
      court: c.input.courtExempt ? { adminRecessExempt: true } : null,
    }),
  );
  return r.ok ? r.value : r;
});
process.stdout.write(canonicalJson(out));

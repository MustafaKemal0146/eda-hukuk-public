// Sahne motoru metinlerini katalogdan toplar (saf işlev; sunucu ve test aynı yolu kullanır).
import type { AnswerBlock, EngineText } from './engine/types.ts';
import type { Tx } from './text.ts';

export function buildEngineText(tx: Tx): EngineText {
  const rows = tx.a<{ label: string }>('mock.chat.rows').map((r) => r.label);
  return {
    question: tx.s('mock.chat.question'),
    answer: tx.a<AnswerBlock>('mock.chat.answer') as AnswerBlock[],
    chips: tx.o<EngineText['chips']>('mock.chat.chips'),
    pipe: {
      title: tx.s('mock.chat.pipeTitle'),
      meta0: tx.s('mock.chat.pipeMeta0'),
      parallel: tx.s('mock.chat.pipeParallel'),
      parallelRest: tx.s('mock.chat.pipeParallelRest'),
      meta: [...tx.a<string>('mock.chat.pipeMeta')],
      done: tx.s('mock.chat.pipeDone'),
      rows,
      times: [...tx.a<string>('mock.chat.times')],
    },
    sources: { none: tx.s('mock.chat.sources.none'), found: tx.s('mock.chat.sources.found') },
    studio: {
      saved: tx.s('mock.studio.saved'),
      unsaved: tx.s('mock.studio.unsaved'),
      words: tx.s('mock.studio.words'),
      fills: tx.s('mock.studio.fills'),
    },
    cal: {
      sumCap: tx.s('mock.cal.sumCap'),
      sumCapSel: tx.s('mock.cal.sumCapSel'),
      sumDay: tx.s('mock.cal.sumDay'),
      sumDaySel: tx.s('mock.cal.sumDaySel'),
    },
  };
}

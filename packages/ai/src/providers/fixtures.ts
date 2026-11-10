// Paketle derlenen mock senaryoları (020 §15.2). Yalnız MOCK_LLM ile kullanılır (kapı denetler).

import chatToolSearch from '../../fixtures/chat/chat_tool_search.json' with { type: 'json' };
import chatDefault from '../../fixtures/chat/default.json' with { type: 'json' };
import { MockFixture } from './mock.ts';

const FIXTURES: Record<string, Record<string, unknown>> = {
  chat: { default: chatDefault, chat_tool_search: chatToolSearch },
};

export function loadBundledFixture(task: string, scenario: string): MockFixture | null {
  const raw = FIXTURES[task]?.[scenario];
  return raw === undefined ? null : MockFixture.parse(raw);
}

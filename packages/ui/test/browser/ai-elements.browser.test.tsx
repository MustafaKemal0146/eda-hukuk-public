// @tk TK-33
// P05.13 AI Elements uyarlamaları (052 §2): ConversationView yalnız kullanıcı alttayken izler;
// mesaj <article aria-label> ve akan kapta aria-live yok; eylem düğmelerinin erişilebilir adı var.
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { ConversationView, Message, MessageActions } from '../../src/ai-elements/index.ts';
import { seriousViolations } from './axe.ts';

const LABELS = { scrollToLatest: 'En son yanıta git' };
const noop = (): void => undefined;

function Thread({ count }: { count: number }) {
  return (
    <ConversationView label="Sohbet" labels={LABELS} className="h-60">
      {Array.from({ length: count }, (_, i) => (
        <Message key={i} from={i % 2 ? 'assistant' : 'user'} label={`Mesaj ${i + 1}`}>
          <p className="h-20">Mesaj {i + 1}</p>
        </Message>
      ))}
    </ConversationView>
  );
}

const nextFrame = (): Promise<void> => new Promise((r) => setTimeout(r, 50));

describe('P05.13 (052 §2): ConversationView', () => {
  it('altta iken yeni içerik izlenir, yukarı kaydırınca "En son yanıta git" çıkar ve alta indirir', async () => {
    const screen = await render(<Thread count={6} />);
    const region = screen.container.querySelector<HTMLElement>('section[aria-label="Sohbet"]');
    if (!region) throw new Error('bölge yok');
    await screen.rerender(<Thread count={10} />);
    await nextFrame();
    expect(
      region.scrollHeight - region.scrollTop - region.clientHeight,
      `${region.scrollHeight} ${region.scrollTop} ${region.clientHeight}`,
    ).toBeLessThanOrEqual(48);

    region.scrollTop = 0;
    region.dispatchEvent(new Event('scroll'));
    await nextFrame();
    const button = screen.getByRole('button', { name: LABELS.scrollToLatest });
    await expect.element(button).toBeVisible();

    // Kullanıcı yukarıdayken gelen içerik konumu değiştirmez.
    await screen.rerender(<Thread count={12} />);
    await nextFrame();
    expect(region.scrollTop).toBe(0);

    await button.click();
    await nextFrame();
    expect(region.scrollHeight - region.scrollTop - region.clientHeight).toBeLessThanOrEqual(48);
    expect(screen.container.querySelector('[aria-live]')).toBeNull();
  });
});

describe('P05.13 (052 §2): Message ve MessageActions', () => {
  it('article aria-label, eylem adları ve axe ihlali yok', async () => {
    const screen = await render(
      <Message
        from="assistant"
        label="E.D.A. yanıtı"
        footer={
          <MessageActions
            labels={{
              group: 'Yanıt eylemleri',
              copy: 'Kopyala',
              regenerate: 'Yeniden üret',
              like: 'Beğen',
              dislike: 'Beğenme',
              export: 'Dışa aktar',
            }}
            onCopy={noop}
            onRegenerate={noop}
            onFeedback={noop}
            onExport={noop}
            feedback="down"
          />
        }
      >
        <p>Yanıt</p>
      </Message>,
    );
    await expect.element(screen.getByRole('article', { name: 'E.D.A. yanıtı' })).toBeVisible();
    for (const name of ['Kopyala', 'Yeniden üret', 'Beğen', 'Beğenme', 'Dışa aktar']) {
      await expect.element(screen.getByRole('button', { name, exact: true })).toBeVisible();
    }
    await expect
      .element(screen.getByRole('button', { name: 'Beğenme', exact: true }))
      .toHaveAttribute('aria-pressed', 'true');
    expect(await seriousViolations(screen.container)).toEqual([]);
  });
});

// SSE heartbeat (022 §5.1): son yazımdan bu yana `chat.heartbeatSec` geçtiyse `: keep-alive` yorum satırı.
export function withHeartbeat(
  body: ReadableStream<Uint8Array>,
  intervalMs: number,
): ReadableStream<Uint8Array> {
  const ping = new TextEncoder().encode(': keep-alive\n\n');
  let last = Date.now();
  let timer: ReturnType<typeof setInterval> | undefined;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      start(controller) {
        timer = setInterval(
          () => {
            if (Date.now() - last >= intervalMs) {
              controller.enqueue(ping);
              last = Date.now();
            }
          },
          Math.min(intervalMs, 5000),
        );
      },
      transform(chunk, controller) {
        last = Date.now();
        controller.enqueue(chunk);
      },
      flush() {
        clearInterval(timer);
      },
    }),
  );
}

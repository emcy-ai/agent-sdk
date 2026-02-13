/**
 * Parses an SSE stream from the Emcy chat API.
 * Yields parsed events as they arrive.
 */
export interface ParsedSseEvent {
  type: string;
  data: unknown;
}

export async function* parseSseStream(
  response: Response,
  signal?: AbortSignal,
): AsyncGenerator<ParsedSseEvent> {
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) break;

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Split on double newlines (SSE event boundary)
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';

      for (const eventBlock of events) {
        if (!eventBlock.trim()) continue;

        let eventType = '';
        let eventData = '';

        for (const line of eventBlock.split('\n')) {
          if (line.startsWith('event: ')) {
            eventType = line.slice('event: '.length);
          } else if (line.startsWith('data: ')) {
            eventData = line.slice('data: '.length);
          }
        }

        if (eventType && eventData) {
          try {
            const parsed = JSON.parse(eventData);
            yield { type: eventType, data: parsed };
          } catch {
            // Skip malformed JSON
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

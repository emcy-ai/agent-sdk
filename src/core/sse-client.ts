/**
 * Parses an SSE stream from the Emcy chat API.
 * Yields parsed events as they arrive.
 */
export interface ParsedSseEvent {
  type: string;
  data: unknown;
}

function* parseEventBlocks(input: string): Generator<ParsedSseEvent> {
  const normalized = input.replace(/\r\n/g, '\n');
  const eventBlocks = normalized.split('\n\n');

  for (const eventBlock of eventBlocks) {
    if (!eventBlock.trim()) continue;

    let eventType = '';
    const dataLines: string[] = [];

    for (const line of eventBlock.split('\n')) {
      if (line.startsWith('event: ')) {
        eventType = line.slice('event: '.length);
      } else if (line.startsWith('data: ')) {
        dataLines.push(line.slice('data: '.length));
      } else if (line === 'data:') {
        dataLines.push('');
      }
    }

    if (!eventType || dataLines.length === 0) {
      continue;
    }

    try {
      const parsed = JSON.parse(dataLines.join('\n'));
      yield { type: eventType, data: parsed };
    } catch {
      // Skip malformed JSON payloads.
    }
  }
}

export async function* parseSseStream(
  response: Response,
  signal?: AbortSignal,
): AsyncGenerator<ParsedSseEvent> {
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text().catch(() => '');
    yield* parseEventBlocks(text);
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) break;

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const normalized = buffer.replace(/\r\n/g, '\n');

      // Split on double newlines (SSE event boundary)
      const events = normalized.split('\n\n');
      buffer = events.pop() ?? '';

      for (const eventBlock of events) {
        yield* parseEventBlocks(eventBlock);
      }
    }

    if (buffer.trim()) {
      yield* parseEventBlocks(buffer);
    }
  } finally {
    reader.releaseLock();
  }
}

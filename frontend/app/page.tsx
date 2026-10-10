'use client';

import { useEffect, useRef, useState } from 'react';
import { MessageProcessor } from '@a2ui/web_core/v0_9';
import type { A2uiMessage } from '@a2ui/web_core/v0_9';
import type { ReactComponentImplementation } from '@a2ui/react/v0_9';
import { dynamicUiCatalog } from '@/components/catalog/catalog';
import { ChatHeader, type AgentStatus } from '@/components/chat/header';
import { EmptyState } from '@/components/chat/empty-state';
import { Composer } from '@/components/chat/composer';
import {
  AgentAnswer,
  AgentError,
  AgentLoading,
  UserMessage,
  type Step,
  type ToolCall,
  type Turn,
} from '@/components/chat/turn';

// One NDJSON line from /api/agent (see AgentEvent in app/api/agent/route.ts).
type AgentEvent =
  | { type: 'step'; step: Step }
  | { type: 'done'; text: string; a2uiMessages: A2uiMessage[]; toolCalls: ToolCall[] }
  | { type: 'error'; error: string };

// Yields each line of an NDJSON body as it arrives.
async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<AgentEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) if (line.trim()) yield JSON.parse(line);
  }
  if (buffer.trim()) yield JSON.parse(buffer);
}

// The backend is stateless and names every answer's surface "main". Give each
// turn's messages that turn's own surface id instead, so earlier answers stay
// rendered in the thread alongside new ones.
function retargetSurface(messages: A2uiMessage[], surfaceId: string): A2uiMessage[] {
  return messages.map(
    (message) =>
      Object.fromEntries(
        Object.entries(message).map(([key, value]) =>
          value && typeof value === 'object' && 'surfaceId' in value
            ? [key, { ...value, surfaceId }]
            : [key, value],
        ),
      ) as A2uiMessage,
  );
}

export default function Home() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [status, setStatus] = useState<AgentStatus>('checking');
  const [agent, setAgent] = useState<string | null>(null);
  const [processor] = useState(
    () => new MessageProcessor<ReactComponentImplementation>([dynamicUiCatalog]),
  );
  const latestTurnRef = useRef<HTMLDivElement>(null);
  const busy = turns.some((t) => t.status === 'loading');

  useEffect(() => {
    fetch('/api/agent')
      .then((res) => res.json())
      .then((data) => {
        setStatus(data.online ? 'online' : 'offline');
        setAgent(data.agent ?? null);
      })
      .catch(() => setStatus('offline'));
  }, []);

  // Bring the newest turn's question into view when it's asked and again when
  // its answer lands, so a tall answer is read from its top.
  const latest = turns.at(-1);
  useEffect(() => {
    latestTurnRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [latest?.id, latest?.status]);

  function updateTurn(next: Turn) {
    setTurns((prev) => prev.map((t) => (t.id === next.id ? next : t)));
  }

  // Asks `query` as a new turn, or re-asks it in place when `retryId` names
  // an earlier turn that failed.
  async function ask(query: string, retryId?: string) {
    if (busy) return;
    const id = retryId ?? crypto.randomUUID();
    const loading: Turn = { id, query, status: 'loading', steps: [] };
    setTurns((prev) => (retryId ? prev.map((t) => (t.id === id ? loading : t)) : [...prev, loading]));

    let res: Response;
    try {
      res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
    } catch (err) {
      console.error('Agent request failed:', err);
      setStatus('offline');
      updateTurn({ id, query, status: 'error', error: 'Could not reach the app server.' });
      return;
    }

    if (!res.ok || !res.body) {
      if (res.status === 502) setStatus('offline');
      const data: { error?: string } = await res.json().catch(() => ({}));
      updateTurn({ id, query, status: 'error', error: data.error ?? 'The agent request failed.' });
      return;
    }

    setStatus('online');
    try {
      for await (const event of readEvents(res.body)) {
        if (event.type === 'step') {
          setTurns((prev) =>
            prev.map((t) => (t.id === id && t.status === 'loading' ? { ...t, steps: [...t.steps, event.step] } : t)),
          );
        } else if (event.type === 'error') {
          updateTurn({ id, query, status: 'error', error: event.error });
          return;
        } else {
          let surface = null;
          if (event.a2uiMessages.length) {
            processor.processMessages(retargetSurface(event.a2uiMessages, id));
            surface = processor.model.getSurface(id) ?? null;
          }
          updateTurn({ id, query, status: 'done', text: event.text, surface, toolCalls: event.toolCalls });
          return;
        }
      }
    } catch (err) {
      console.error('Agent stream failed:', err);
    }
    updateTurn({ id, query, status: 'error', error: 'The answer was cut off before it finished.' });
  }

  function newChat() {
    for (const t of turns) {
      if (t.status === 'done' && t.surface) processor.model.deleteSurface(t.id);
    }
    setTurns([]);
  }

  return (
    <div className="flex min-h-screen flex-col bg-ground text-ink antialiased">
      <ChatHeader status={status} agent={agent} onNewChat={newChat} />

      <main className="mx-auto box-border flex w-full max-w-[880px] flex-1 flex-col gap-8 px-6 py-8">
        {turns.length === 0 ? (
          <EmptyState onAsk={ask} disabled={busy} />
        ) : (
          turns.map((turn) => (
            <div
              key={turn.id}
              ref={turn === latest ? latestTurnRef : undefined}
              className="flex scroll-mt-6 flex-col gap-8"
            >
              <UserMessage text={turn.query} />
              {turn.status === 'loading' && <AgentLoading steps={turn.steps} />}
              {turn.status === 'error' && (
                <AgentError message={turn.error} onRetry={() => ask(turn.query, turn.id)} />
              )}
              {turn.status === 'done' && <AgentAnswer turn={turn} />}
            </div>
          ))
        )}
      </main>

      <Composer busy={busy} onAsk={ask} />
    </div>
  );
}

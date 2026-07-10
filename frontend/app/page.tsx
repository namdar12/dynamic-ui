'use client';

import { useMemo, useRef, useState } from 'react';
import { MessageProcessor } from '@a2ui/web_core/v0_9';
import type { SurfaceModel } from '@a2ui/web_core/v0_9';
import { A2uiSurface } from '@a2ui/react/v0_9';
import type { ReactComponentImplementation } from '@a2ui/react/v0_9';
import { dynamicUiCatalog } from '@/components/catalog/catalog';

type ChatMessage = { role: 'user' | 'agent'; text: string };

export default function Home() {
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [surface, setSurface] = useState<SurfaceModel<ReactComponentImplementation> | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const processor = useMemo(() => {
    const p = new MessageProcessor<ReactComponentImplementation>([dynamicUiCatalog]);
    p.onSurfaceCreated((s) => setSurface(s));
    return p;
  }, []);
  const processorRef = useRef(processor);
  processorRef.current = processor;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim() || loading) return;

    const userQuery = query;
    setMessages((prev) => [...prev, { role: 'user', text: userQuery }]);
    setQuery('');
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: userQuery }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'The agent request failed.');
        return;
      }

      if (data.text) {
        setMessages((prev) => [...prev, { role: 'agent', text: data.text }]);
      }
      if (data.a2uiMessages?.length) {
        processorRef.current.processMessages(data.a2uiMessages);
      }
    } catch {
      setError('Could not reach the agent.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold">Dynamic UI Chatbot</h1>

      <div className="flex flex-col gap-2">
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'font-medium' : 'text-gray-700'}>
            <span className="mr-2 text-sm uppercase text-gray-400">{m.role}</span>
            {m.text}
          </div>
        ))}
      </div>

      {error && <div className="rounded bg-red-100 p-2 text-red-800">{error}</div>}

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          className="flex-1 rounded border p-2"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask a question about the data..."
          disabled={loading}
        />
        <button
          type="submit"
          className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
          disabled={loading}
        >
          {loading ? 'Asking...' : 'Ask'}
        </button>
      </form>

      <div className="rounded border p-4">
        {surface ? <A2uiSurface surface={surface} /> : (
          <p className="text-gray-400">Ask a question to see it rendered here.</p>
        )}
      </div>
    </main>
  );
}

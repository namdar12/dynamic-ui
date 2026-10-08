'use client';

import { useState } from 'react';
import { ArrowUpIcon } from './icons';

export function Composer({ busy, onAsk }: { busy: boolean; onAsk: (query: string) => void }) {
  const [query, setQuery] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q || busy) return;
    onAsk(q);
    setQuery('');
  }

  return (
    <footer className="sticky bottom-0 border-t border-line bg-surface px-6 pt-4 pb-5">
      <form onSubmit={handleSubmit} className="mx-auto flex max-w-[832px] flex-col gap-2">
        <label htmlFor="ask" className="sr-only">
          Ask a question about the data
        </label>
        <div
          className={`flex items-center gap-2 rounded-xl border py-1.5 pr-1.5 pl-4 focus-within:border-accent ${
            busy ? 'border-line bg-ground' : 'border-line-strong bg-surface'
          }`}
        >
          <input
            id="ask"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={busy}
            placeholder={busy ? 'Waiting for the agent…' : 'Ask about customers, orders or products'}
            className="h-11 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-caption disabled:text-caption"
          />
          {busy ? (
            <button
              type="submit"
              disabled
              className="min-h-11 flex-none cursor-not-allowed rounded-lg bg-line px-3.5 text-sm font-medium text-muted"
            >
              Asking…
            </button>
          ) : (
            <button
              type="submit"
              aria-label="Send question"
              className="inline-flex size-11 flex-none cursor-pointer items-center justify-center rounded-lg bg-accent text-white hover:bg-blue-700"
            >
              <ArrowUpIcon className="size-[18px]" />
            </button>
          )}
        </div>
        <p className="text-xs text-caption">
          Each question is answered on its own. The agent doesn&apos;t see earlier turns.
        </p>
      </form>
    </footer>
  );
}

import { ArrowRightIcon } from './icons';

// Describes the bundled mock-data server (mock-data/server.py). Update these
// if MCP_DATA_URL points at a different data service.
const ENTITIES = [
  { name: 'Customers', rows: 6, fields: 'name · email · city · tier' },
  { name: 'Orders', rows: 10, fields: 'total · status · quantity · date' },
  { name: 'Products', rows: 5, fields: 'name · category · price' },
];

const SUGGESTIONS = [
  'Which orders are over $100?',
  'Show me customers from Austin.',
  'Show me order 5 along with its customer.',
  'Chart revenue by order status.',
];

export function EmptyState({ onAsk, disabled }: { onAsk: (query: string) => void; disabled: boolean }) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-10">
      <div className="flex flex-col gap-3">
        <h1 className="max-w-[640px] text-[34px] leading-[1.15] font-semibold tracking-[-0.025em] text-balance">
          What do you want to know about the shop data?
        </h1>
        <p className="max-w-[560px] text-base leading-relaxed text-muted">
          Ask in plain English. Answers come back as tables, charts and cards built from live queries.
        </p>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-3">
        {ENTITIES.map((e) => (
          <div key={e.name} className="flex flex-col gap-1.5 rounded-xl border border-line bg-surface p-4">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium">{e.name}</span>
              <span className="font-mono text-[13px] text-muted">{e.rows} rows</span>
            </div>
            <span className="font-mono text-xs text-caption">{e.fields}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-[13px] font-medium text-muted">Try asking</h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              disabled={disabled}
              onClick={() => onAsk(s)}
              className="flex min-h-[52px] cursor-pointer items-center justify-between gap-3 rounded-[10px] border border-line bg-surface px-4 text-left text-[15px] hover:border-line-strong hover:bg-ground disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span>{s}</span>
              <ArrowRightIcon className="size-4 flex-none text-caption" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

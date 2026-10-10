import { A2uiSurface } from '@a2ui/react/v0_9';
import type { ReactComponentImplementation } from '@a2ui/react/v0_9';
import type { SurfaceModel } from '@a2ui/web_core/v0_9';
import { AlertIcon, CheckIcon, GridIcon } from './icons';

export type ToolCall = { name: string; args: Record<string, unknown> };

// A finished tool call reported while the answer is still being worked out.
export type Step = ToolCall & { count?: number; failed?: boolean };

export type Turn = { id: string; query: string } & (
  | { status: 'loading'; steps: Step[] }
  | { status: 'error'; error: string }
  | {
      status: 'done';
      text: string;
      surface: SurfaceModel<ReactComponentImplementation> | null;
      toolCalls: ToolCall[];
    }
);

// query_orders(filter: "total > 100", expand: "customer")
function formatCall({ name, args }: ToolCall) {
  const list = Object.entries(args)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join(', ');
  return `${name}(${list})`;
}

export function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[80%] rounded-[16px_16px_4px_16px] bg-ink px-4 py-3 text-[15px] leading-normal text-ground">
        {text}
      </p>
    </div>
  );
}

function AgentLabel() {
  return (
    <div className="flex items-center gap-2 text-[13px]">
      <span className="inline-flex size-6 items-center justify-center rounded-md bg-accent">
        <GridIcon className="size-3.5 text-white" />
      </span>
      <span className="font-medium">Agent</span>
    </div>
  );
}

export function AgentAnswer({ turn }: { turn: Extract<Turn, { status: 'done' }> }) {
  // describe_query is schema discovery, not data; show only the real queries.
  const queries = turn.toolCalls.filter((c) => c.name !== 'describe_query');
  return (
    <article className="flex flex-col gap-3">
      <AgentLabel />
      {turn.text && <p className="text-[15px] leading-relaxed">{turn.text}</p>}
      {turn.surface && (
        <section aria-label="Answer" className="overflow-hidden rounded-xl border border-line bg-surface">
          <div className="answer-surface p-5">
            <A2uiSurface surface={turn.surface} />
          </div>
          {queries.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line bg-ground px-5 py-3 text-xs text-caption">
              <span>Queried</span>
              {queries.map((c, i) => (
                <code key={i} className="font-mono break-all text-muted">
                  {formatCall(c)}
                </code>
              ))}
            </div>
          )}
        </section>
      )}
    </article>
  );
}

function SkeletonRow() {
  return (
    <div className="grid grid-cols-[2fr_3fr_2fr_1fr] gap-6 border-b border-subtle px-5 py-[15px] last:border-b-0">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-2.5 rounded bg-subtle" />
      ))}
    </div>
  );
}

function StepLabel({ step }: { step: Step }) {
  if (step.name === 'describe_query') {
    return <span>Read the {typeof step.args.entity === 'string' ? step.args.entity : 'data'} fields</span>;
  }
  return (
    <span className="min-w-0">
      {step.name.startsWith('query_') && 'Queried '}
      <code className="font-mono text-[13px] break-all text-ink">{formatCall(step)}</code>
      {step.count !== undefined && ` · ${step.count} ${step.count === 1 ? 'row' : 'rows'}`}
      {step.failed && <span className="text-red-700"> · failed</span>}
    </span>
  );
}

// What the agent is most likely doing now, given the last step it finished:
// no tool has run while Gemini reads the question; after a schema lookup it
// writes a query; after a query it is usually composing the UI.
function pendingLabel(steps: Step[]) {
  const last = steps.at(-1);
  if (!last) return 'Reading your question…';
  if (last.name === 'describe_query') return 'Planning the query…';
  return 'Building your answer…';
}

export function AgentLoading({ steps }: { steps: Step[] }) {
  return (
    <article aria-busy="true" className="flex flex-col gap-3">
      <AgentLabel />
      <ol role="status" className="flex flex-col gap-2">
        {steps.map((step, i) => (
          <li key={i} className="flex items-baseline gap-2.5 text-sm leading-relaxed text-muted">
            <span className="flex w-[26px] flex-none translate-y-0.5 justify-center" aria-hidden="true">
              <CheckIcon className="size-3.5 text-accent" />
            </span>
            <StepLabel step={step} />
          </li>
        ))}
        <li className="flex items-center gap-2.5 text-[15px] leading-relaxed text-muted">
          <span className="inline-flex w-[26px] flex-none gap-1" aria-hidden="true">
            {[0, 0.2, 0.4].map((delay) => (
              <span
                key={delay}
                className="size-1.5 rounded-full bg-accent"
                style={{ animation: `pulse-soft 1.2s ease-in-out ${delay}s infinite` }}
              />
            ))}
          </span>
          {pendingLabel(steps)}
        </li>
      </ol>
      <div
        aria-hidden="true"
        className="overflow-hidden rounded-xl border border-line bg-surface"
        style={{ animation: 'pulse-soft 1.8s ease-in-out infinite' }}
      >
        <div className="px-5 pt-[18px] pb-3.5">
          <div className="h-3.5 w-[200px] rounded bg-line" />
        </div>
        <div className="h-11 border-y border-line bg-ground" />
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </div>
    </article>
  );
}

export function AgentError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex gap-3.5 rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-red-900">
      <AlertIcon className="mt-0.5 size-5 flex-none text-red-700" />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-[15px] font-semibold">Couldn&apos;t get an answer</h2>
          <p className="text-sm leading-relaxed">
            {message} If the agent is down, start it with <code className="font-mono text-[13px]">uv run .</code> in{' '}
            <code className="font-mono text-[13px]">backend/</code>, then try again.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onRetry}
            className="min-h-11 cursor-pointer rounded-lg bg-red-700 px-4 text-sm font-medium text-white hover:bg-red-800"
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}

import { GridIcon } from './icons';

export type AgentStatus = 'checking' | 'online' | 'offline';

const STATUS_LABEL: Record<AgentStatus, string> = {
  checking: 'Checking agent…',
  online: 'Agent connected',
  offline: 'Agent offline',
};

export function ChatHeader({
  status,
  agent,
  onNewChat,
}: {
  status: AgentStatus;
  agent: string | null;
  onNewChat: () => void;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-6 py-2.5">
      <div className="flex items-center gap-2.5">
        <GridIcon className="size-[22px] text-ink" />
        <span className="text-[15px] font-semibold tracking-[-0.01em]">dynamic-ui</span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span
          role="status"
          className="inline-flex items-center gap-2 rounded-full border border-line bg-ground px-3 py-1.5 font-mono text-xs text-muted"
        >
          <span className={`size-[7px] rounded-full ${status === 'online' ? 'bg-green-600' : 'bg-zinc-400'}`} />
          {STATUS_LABEL[status]}
          {status !== 'checking' && agent && ` · ${agent}`}
        </span>
        <button
          type="button"
          onClick={onNewChat}
          className="min-h-11 cursor-pointer rounded-lg border border-line-strong bg-surface px-4 text-sm font-medium hover:bg-subtle"
        >
          New chat
        </button>
      </div>
    </header>
  );
}

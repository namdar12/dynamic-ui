import { NextRequest, NextResponse } from 'next/server';
import { A2AClient } from '@a2a-js/sdk/client';
import type { MessageSendParams, Part } from '@a2a-js/sdk';

// Where the Python agent serves A2A. Override with AGENT_URL when :8000 is taken
// (e.g. AGENT_URL=http://localhost:8010 npm run dev).
const AGENT_URL = process.env.AGENT_URL ?? 'http://localhost:8000';
const AGENT_CARD_URL = `${AGENT_URL}/.well-known/agent-card.json`;
const AGENT_HOST = new URL(AGENT_URL).host;
const A2UI_EXTENSION = 'https://a2ui.org/a2a-extension/a2ui/v0.9';
// Must match TOOL_CALLS_MIME_TYPE in backend/agent_executor.py.
const TOOL_CALLS_MIME_TYPE = 'application/vnd.dynamic-ui.tool-calls+json';
// Must match PROGRESS_MIME_TYPE in backend/agent_executor.py.
const PROGRESS_MIME_TYPE = 'application/vnd.dynamic-ui.progress+json';

type ToolCall = { name: string; args: Record<string, unknown> };
type Step = ToolCall & { count?: number; failed?: boolean };

// The response body is NDJSON: zero or more `step` lines as the agent works,
// then exactly one `done` or `error` line.
type AgentEvent =
  | { type: 'step'; step: Step }
  | { type: 'done'; text: string; a2uiMessages: object[]; toolCalls: ToolCall[] }
  | { type: 'error'; error: string };

let clientPromise: Promise<A2AClient> | null = null;

function getClient(): Promise<A2AClient> {
  if (!clientPromise) {
    const fetchWithExtensionHeader: typeof fetch = (url, init) => {
      const headers = new Headers(init?.headers);
      headers.set('X-A2A-Extensions', A2UI_EXTENSION);
      return fetch(url, { ...init, headers });
    };
    clientPromise = A2AClient.fromCardUrl(AGENT_CARD_URL, {
      fetchImpl: fetchWithExtensionHeader,
    });
  }
  return clientPromise;
}

export async function POST(request: NextRequest) {
  const { query } = await request.json();

  let client: A2AClient;
  try {
    client = await getClient();
  } catch {
    clientPromise = null;
    return NextResponse.json(
      { error: `Could not reach the agent server at ${AGENT_HOST}.` },
      { status: 502 },
    );
  }

  const sendParams: MessageSendParams = {
    message: {
      messageId: crypto.randomUUID(),
      role: 'user',
      parts: [{ kind: 'text', text: query } as Part],
      kind: 'message',
    },
  };

  const stream = client.sendMessageStream(sendParams);
  // Wait for the first event before replying, so an unreachable agent is
  // still a plain 502 rather than an error inside a 200 stream.
  let first: IteratorResult<StreamEvent>;
  try {
    first = await stream.next();
  } catch {
    return NextResponse.json(
      { error: `Could not reach the agent server at ${AGENT_HOST}.` },
      { status: 502 },
    );
  }

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AgentEvent) =>
        controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      let finished = false;
      try {
        for (let next = first; !next.done && !finished; next = await stream.next()) {
          const event = toAgentEvent(next.value);
          if (event) {
            send(event);
            finished = event.type !== 'step';
          }
        }
        if (!finished) send({ type: 'error', error: 'The agent stopped without answering.' });
      } catch {
        if (!finished) send({ type: 'error', error: 'Lost the connection to the agent mid-answer.' });
      }
      controller.close();
    },
  });

  return new Response(body, {
    headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' },
  });
}

type StreamEvent = ReturnType<A2AClient['sendMessageStream']> extends AsyncGenerator<infer E> ? E : never;

// Maps one A2A stream event to what the page needs, or null to skip it (the
// initial `submitted` task, and anything without a status).
function toAgentEvent(event: StreamEvent): AgentEvent | null {
  if (event.kind !== 'task' && event.kind !== 'status-update') return null;
  const { state, message } = event.status;
  const parts: Part[] = message?.parts ?? [];

  if (state === 'working') {
    const progress = parts.find(
      (part) => part.kind === 'data' && part.metadata?.mimeType === PROGRESS_MIME_TYPE,
    );
    return progress?.kind === 'data' ? { type: 'step', step: progress.data as Step } : null;
  }

  if (state === 'completed') {
    let text = '';
    const a2uiMessages: object[] = [];
    let toolCalls: ToolCall[] = [];
    for (const part of parts) {
      if (part.kind === 'text') {
        text += part.text;
      } else if (part.kind === 'data') {
        if (part.metadata?.mimeType === TOOL_CALLS_MIME_TYPE) {
          toolCalls = (part.data as { toolCalls: ToolCall[] }).toolCalls;
        } else {
          a2uiMessages.push(part.data as object);
        }
      }
    }
    return { type: 'done', text, a2uiMessages, toolCalls };
  }

  if (state === 'failed' || state === 'rejected' || state === 'canceled') {
    const text = parts.map((part) => (part.kind === 'text' ? part.text : '')).join('');
    return { type: 'error', error: text || 'The agent request failed.' };
  }

  return null;
}

// Health check for the header's status pill: is the agent answering at all?
export async function GET() {
  try {
    const res = await fetch(AGENT_CARD_URL, {
      cache: 'no-store',
      signal: AbortSignal.timeout(2000),
    });
    return NextResponse.json({ online: res.ok, agent: AGENT_HOST });
  } catch {
    return NextResponse.json({ online: false, agent: AGENT_HOST });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { A2AClient } from '@a2a-js/sdk/client';
import type { MessageSendParams, Part, SendMessageSuccessResponse, Task } from '@a2a-js/sdk';

const AGENT_CARD_URL = 'http://localhost:8000/.well-known/agent-card.json';
const A2UI_EXTENSION = 'https://a2ui.org/a2a-extension/a2ui/v0.9';

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
      { error: 'Could not reach the agent server at localhost:8000.' },
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

  let response: SendMessageSuccessResponse;
  try {
    response = (await client.sendMessage(sendParams)) as SendMessageSuccessResponse;
  } catch {
    return NextResponse.json(
      { error: 'Could not reach the agent server at localhost:8000.' },
      { status: 502 },
    );
  }

  const result = response.result as Task;
  const parts: Part[] =
    result.kind === 'task' ? result.status.message?.parts ?? [] : [];

  let text = '';
  const a2uiMessages: object[] = [];
  for (const part of parts) {
    if (part.kind === 'text') {
      text += part.text;
    } else if (part.kind === 'data') {
      a2uiMessages.push(part.data as object);
    }
  }

  return NextResponse.json({ text, a2uiMessages });
}

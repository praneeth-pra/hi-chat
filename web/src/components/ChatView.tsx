import { useLayoutEffect, useRef, type ReactNode } from 'react';

import type { Message } from '../api';
import { useScrollState } from '../scroll';
import { MessageItem } from './MessageItem';
import { IconArrowDown } from './icons';

export interface PendingReply {
  text: string;
  model: string;
  error: string | null;
  streaming: boolean;
}

interface Props {
  chatKey: string;
  loaded: boolean;
  messages: Message[];
  pending: PendingReply | null;
  busy: boolean;
  onRegenerate: () => void;
  onDeleteFrom: (messageId: string) => void;
  composer: ReactNode;
}

export function ChatView({
  chatKey,
  loaded,
  messages,
  pending,
  busy,
  onRegenerate,
  onDeleteFrom,
  composer
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { atBottom, scrollToBottom } = useScrollState(scrollRef);

  // Opening a chat shows its latest messages. This is the only automatic scroll:
  // new prompts and streamed replies never move the view.
  useLayoutEffect(() => {
    if (loaded) scrollToBottom(false);
  }, [chatKey, loaded, scrollToBottom]);

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const empty = messages.length === 0 && !pending;

  return (
    <div className={`chat-view ${empty ? 'chat-view-empty' : ''}`}>
      <div className="messages-scroll" ref={scrollRef} data-testid="messages-scroll">
        <div className="messages">
          {empty && loaded && <h1 className="greeting">How can I help you today?</h1>}
          {messages.map((m) => (
            <MessageItem
              key={m.id}
              message={m}
              canRegenerate={!busy && m.id === lastAssistant?.id && !pending}
              onRegenerate={onRegenerate}
              onDelete={busy ? undefined : () => onDeleteFrom(m.id)}
            />
          ))}
          {pending && (
            <MessageItem
              message={{
                id: 'pending',
                role: 'assistant',
                content: pending.text,
                model: pending.model
              }}
              streaming={pending.streaming}
              error={pending.error}
              canRegenerate={!pending.streaming}
              onRegenerate={onRegenerate}
            />
          )}
        </div>
      </div>
      {!atBottom && !empty && (
        <button
          type="button"
          className="jump-button"
          aria-label="Scroll to latest"
          onClick={() => scrollToBottom(true)}
        >
          <IconArrowDown />
          {pending?.streaming && <span>New reply below</span>}
        </button>
      )}
      <div className="composer-wrap">{composer}</div>
    </div>
  );
}

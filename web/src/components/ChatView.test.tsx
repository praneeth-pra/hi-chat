import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import type { Message } from '../api';
import { ChatView, type PendingReply } from './ChatView';

const msg = (id: string, role: Message['role'], content: string): Message => ({
  id,
  chatId: 'c1',
  role,
  content,
  model: role === 'assistant' ? 'llama' : null,
  createdAt: 0
});

const history = [msg('1', 'user', 'hi'), msg('2', 'assistant', 'hello')];

let scrollTo: ReturnType<typeof vi.fn>;

const view = (messages: Message[], pending: PendingReply | null = null, chatKey = 'c1') => (
  <ChatView
    chatKey={chatKey}
    loaded
    messages={messages}
    pending={pending}
    busy={Boolean(pending?.streaming)}
    onRegenerate={() => {}}
    onDeleteFrom={() => {}}
    composer={<div />}
  />
);

const setup = (messages: Message[]) => {
  scrollTo = vi.fn();
  Element.prototype.scrollTo = scrollTo as unknown as typeof Element.prototype.scrollTo;
  return render(view(messages));
};

afterEach(cleanup);

describe('ChatView scrolling', () => {
  it('jumps to the latest message when a chat is opened', () => {
    setup(history);
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it('does not scroll when a prompt is sent or a reply streams in', () => {
    const { rerender } = setup(history);
    scrollTo.mockClear();

    const withPrompt = [...history, msg('3', 'user', 'what is aws lambda')];
    rerender(view(withPrompt, { text: '', model: 'llama', error: null, streaming: true }));
    rerender(
      view(withPrompt, { text: 'AWS Lambda is', model: 'llama', error: null, streaming: true })
    );
    rerender(view([...withPrompt, msg('4', 'assistant', 'AWS Lambda is a service.')]));

    expect(scrollTo).not.toHaveBeenCalled();
    expect(screen.getByText('what is aws lambda')).toBeTruthy();
  });

  it('jumps again when switching to another chat', () => {
    const { rerender } = setup(history);
    scrollTo.mockClear();
    rerender(view([msg('9', 'user', 'other chat')], null, 'c2'));
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it('shows a greeting for an empty chat', () => {
    setup([]);
    expect(screen.getByText('How can I help you today?')).toBeTruthy();
  });
});

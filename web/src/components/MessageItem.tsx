import { memo, useState } from 'react';

import type { Message } from '../api';
import { copyText } from '../clipboard';
import { Markdown } from './Markdown';
import { IconCheck, IconCopy, IconRefresh, IconTrash } from './icons';

interface Props {
  message: Pick<Message, 'id' | 'role' | 'content' | 'model'>;
  streaming?: boolean;
  error?: string | null;
  canRegenerate?: boolean;
  onRegenerate?: () => void;
  onDelete?: () => void;
}

export const MessageItem = memo(function MessageItem({
  message,
  streaming,
  error,
  canRegenerate,
  onRegenerate,
  onDelete
}: Props) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';

  return (
    <div className={`message ${isUser ? 'message-user' : 'message-assistant'}`}>
      {!isUser && message.model && <div className="message-model">{message.model}</div>}
      <div className="message-body">
        {isUser ? (
          <div className="user-text">{message.content}</div>
        ) : message.content ? (
          <Markdown text={message.content} />
        ) : streaming ? (
          <div className="typing" aria-label="Thinking">
            <span />
            <span />
            <span />
          </div>
        ) : null}
        {error && <div className="message-error">{error}</div>}
      </div>
      {!streaming && message.content && (
        <div className="message-actions">
          <button
            type="button"
            title="Copy"
            aria-label="Copy"
            onClick={async () => {
              await copyText(message.content);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? <IconCheck /> : <IconCopy />}
          </button>
          {canRegenerate && onRegenerate && (
            <button type="button" title="Regenerate" aria-label="Regenerate" onClick={onRegenerate}>
              <IconRefresh />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              title="Delete this and later messages"
              aria-label="Delete"
              onClick={onDelete}
            >
              <IconTrash />
            </button>
          )}
        </div>
      )}
    </div>
  );
});

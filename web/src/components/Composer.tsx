import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { IconSend, IconStop } from './icons';

interface Props {
  busy: boolean;
  models: string[];
  model: string;
  onModelChange: (model: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  autoFocusKey?: string | null;
}

const MAX_HEIGHT = 240;

export function Composer({
  busy,
  models,
  model,
  onModelChange,
  onSend,
  onStop,
  autoFocusKey
}: Props) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [text]);

  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, [autoFocusKey]);

  const submit = () => {
    const value = text.trim();
    if (!value || busy) return;
    onSend(value);
    setText('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const options = models.includes(model) || !model ? models : [model, ...models];

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        ref={ref}
        value={text}
        rows={1}
        placeholder="Ask anything"
        aria-label="Message"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="composer-bar">
        <select
          className="model-select"
          aria-label="Model"
          value={model}
          onChange={(e) => onModelChange(e.target.value)}
        >
          {options.length === 0 && <option value="">No models</option>}
          {options.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        {busy ? (
          <button type="button" className="send-button" aria-label="Stop" onClick={onStop}>
            <IconStop />
          </button>
        ) : (
          <button
            type="submit"
            className="send-button"
            aria-label="Send"
            disabled={!text.trim() || !model}
          >
            <IconSend />
          </button>
        )}
      </div>
    </form>
  );
}

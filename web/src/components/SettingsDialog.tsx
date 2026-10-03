import { useEffect, useRef, useState } from 'react';

import type { Settings } from '../api';

export type Theme = 'system' | 'light' | 'dark';

interface Props {
  open: boolean;
  settings: Settings;
  models: string[];
  theme: Theme;
  authRequired: boolean;
  onThemeChange: (theme: Theme) => void;
  onSave: (settings: Settings) => Promise<void>;
  onLogout: () => void;
  onClose: () => void;
}

export function SettingsDialog({
  open,
  settings,
  models,
  theme,
  authRequired,
  onThemeChange,
  onSave,
  onLogout,
  onClose
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open) {
      setDraft(settings);
      if (!dialog.open) dialog.showModal?.();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open, settings]);

  return (
    <dialog ref={ref} className="settings" onClose={onClose}>
      <form
        method="dialog"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          try {
            await onSave(draft);
            onClose();
          } finally {
            setSaving(false);
          }
        }}
      >
        <h2>Settings</h2>

        <label>
          <span>Default model for new chats</span>
          <select
            value={draft.defaultModel}
            onChange={(e) => setDraft({ ...draft, defaultModel: e.target.value })}
          >
            {!models.includes(draft.defaultModel) && (
              <option value={draft.defaultModel}>{draft.defaultModel}</option>
            )}
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>System prompt</span>
          <textarea
            rows={5}
            placeholder="Optional instructions sent with every chat"
            value={draft.systemPrompt}
            onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })}
          />
        </label>

        <label>
          <span>Theme</span>
          <select value={theme} onChange={(e) => onThemeChange(e.target.value as Theme)}>
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>

        <div className="settings-actions">
          {authRequired && (
            <button type="button" className="link-button" onClick={onLogout}>
              Sign out
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

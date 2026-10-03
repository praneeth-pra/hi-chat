import { useEffect, useRef, useState } from 'react';

interface Props {
  open: boolean;
  instructions: string;
  onSave: (instructions: string) => Promise<void>;
  onClose: () => void;
}

/** Edits the context for one chat: instructions sent before its messages. */
export function InstructionsDialog({ open, instructions, onSave, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(instructions);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open) {
      setDraft(instructions);
      if (!dialog.open) dialog.showModal?.();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open, instructions]);

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
        <h2>Chat context</h2>
        <label>
          <span>Instructions and background for this chat</span>
          <textarea
            rows={8}
            autoFocus
            placeholder="For example: I'm preparing for an AWS interview. Answer like an interviewer and keep replies short."
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </label>
        <p className="muted small">
          Sent with every message in this chat, after the system prompt from Settings.
        </p>
        <div className="settings-actions">
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

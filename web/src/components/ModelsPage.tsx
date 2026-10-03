import { useEffect, useState } from 'react';

interface Props {
  models: string[];
  enabled: string[];
  defaultModel: string;
  error: string | null;
  onSave: (enabled: string[], defaultModel: string) => Promise<void>;
  onClose: () => void;
}

/** Lets the user choose which models appear in the chat's model picker. */
export function ModelsPage({ models, enabled, defaultModel, error, onSave, onClose }: Props) {
  const initial = () => new Set(enabled.filter((m) => models.includes(m)));
  const [selected, setSelected] = useState(initial);
  const [preferred, setPreferred] = useState(defaultModel);
  const [filter, setFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Re-sync when the model list arrives or settings change elsewhere.
  useEffect(() => {
    setSelected(new Set(enabled.filter((m) => models.includes(m))));
    setPreferred(defaultModel);
  }, [models, enabled.join('\n'), defaultModel]);

  const allShown = selected.size === 0;
  const isOn = (m: string) => allShown || selected.has(m);
  const visible = filter
    ? models.filter((m) => m.toLowerCase().includes(filter.toLowerCase()))
    : models;

  const toggle = (m: string) => {
    setSaved(false);
    setSelected((prev) => {
      // With nothing selected every model is shown, so the first untick starts from all.
      const next = new Set(prev.size === 0 ? models : prev);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next.size === models.length ? new Set() : next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const list = [...selected];
      const fallback = list.length && !list.includes(preferred) ? list[0] : preferred;
      await onSave(list, fallback);
      setPreferred(fallback);
      setSaved(true);
    } catch {
      // The app shows the error.
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="models-page">
      <div className="models-inner">
        <div className="models-header">
          <div>
            <h1>Models</h1>
            <p className="muted">
              Choose which models appear in the chat&apos;s model picker. The starred model is used
              for new chats.
            </p>
          </div>
          <button type="button" className="secondary" onClick={onClose}>
            Back to chat
          </button>
        </div>

        {error && <div className="notice">{error}</div>}

        <div className="models-toolbar">
          <input
            className="search"
            type="search"
            placeholder="Search models"
            aria-label="Search models"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setSaved(false);
              setSelected(new Set());
            }}
          >
            Show all
          </button>
        </div>

        <ul className="models-list" aria-label="Available models">
          {visible.map((m) => (
            <li key={m} className={isOn(m) ? 'on' : ''}>
              <label>
                <input type="checkbox" checked={isOn(m)} onChange={() => toggle(m)} />
                <span className="model-name">{m}</span>
              </label>
              <button
                type="button"
                className={`star ${preferred === m ? 'active' : ''}`}
                aria-label={preferred === m ? `${m} is the default` : `Make ${m} the default`}
                aria-pressed={preferred === m}
                disabled={!isOn(m)}
                onClick={() => {
                  setSaved(false);
                  setPreferred(m);
                }}
              >
                ★
              </button>
            </li>
          ))}
          {visible.length === 0 && (
            <li className="muted">{models.length ? 'No matching models' : 'No models loaded'}</li>
          )}
        </ul>

        <div className="models-footer">
          <span className="muted">
            {allShown
              ? `All ${models.length} models shown`
              : `${selected.size} of ${models.length} shown`}
          </span>
          <span className="spacer" />
          {saved && <span className="muted">Saved</span>}
          <button type="button" className="primary" disabled={saving} onClick={save}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

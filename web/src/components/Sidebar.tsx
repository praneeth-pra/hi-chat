import { useState } from 'react';

import type { Chat } from '../api';
import { IconPencil, IconPlus, IconSettings, IconTrash } from './icons';

interface Props {
  chats: Chat[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onOpenSettings: () => void;
}

const DAY = 24 * 60 * 60 * 1000;

export function groupChats(chats: Chat[], now = Date.now()) {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  const groups: { label: string; chats: Chat[] }[] = [
    { label: 'Today', chats: [] },
    { label: 'Yesterday', chats: [] },
    { label: 'Previous 7 days', chats: [] },
    { label: 'Older', chats: [] }
  ];
  for (const chat of chats) {
    const t = chat.updatedAt;
    const index =
      t >= startOfToday ? 0 : t >= startOfToday - DAY ? 1 : t >= startOfToday - 7 * DAY ? 2 : 3;
    groups[index].chats.push(chat);
  }
  return groups.filter((g) => g.chats.length);
}

export function Sidebar({
  chats,
  activeId,
  onSelect,
  onNew,
  onRename,
  onDelete,
  onOpenSettings
}: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [filter, setFilter] = useState('');

  const visible = filter
    ? chats.filter((c) => c.title.toLowerCase().includes(filter.toLowerCase()))
    : chats;

  const commit = (id: string) => {
    if (draft.trim()) onRename(id, draft.trim());
    setEditing(null);
  };

  return (
    <aside className="sidebar">
      <button type="button" className="new-chat" onClick={onNew}>
        <IconPlus /> New chat
      </button>
      <input
        className="search"
        type="search"
        placeholder="Search chats"
        aria-label="Search chats"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <nav className="chat-list" aria-label="Chats">
        {groupChats(visible).map((group) => (
          <div key={group.label} className="chat-group">
            <div className="chat-group-label">{group.label}</div>
            {group.chats.map((chat) =>
              editing === chat.id ? (
                <input
                  key={chat.id}
                  className="chat-rename"
                  autoFocus
                  value={draft}
                  aria-label="Chat title"
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => commit(chat.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commit(chat.id);
                    if (e.key === 'Escape') setEditing(null);
                  }}
                />
              ) : (
                <div
                  key={chat.id}
                  className={`chat-item ${chat.id === activeId ? 'active' : ''}`}
                  onClick={() => onSelect(chat.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && onSelect(chat.id)}
                >
                  <span className="chat-title">{chat.title}</span>
                  <span className="chat-item-actions">
                    <button
                      type="button"
                      aria-label="Rename chat"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDraft(chat.title);
                        setEditing(chat.id);
                      }}
                    >
                      <IconPencil width={15} height={15} />
                    </button>
                    <button
                      type="button"
                      aria-label="Delete chat"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete "${chat.title}"?`)) onDelete(chat.id);
                      }}
                    >
                      <IconTrash width={15} height={15} />
                    </button>
                  </span>
                </div>
              )
            )}
          </div>
        ))}
        {visible.length === 0 && (
          <div className="chat-empty">{filter ? 'No matching chats' : 'No chats yet'}</div>
        )}
      </nav>
      <button type="button" className="sidebar-footer" onClick={onOpenSettings}>
        <IconSettings /> Settings
      </button>
    </aside>
  );
}

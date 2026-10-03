import { useCallback, useEffect, useRef, useState } from 'react';

import {
  api,
  ApiError,
  streamMessage,
  streamRegenerate,
  type Chat,
  type Message,
  type Settings,
  type StreamHandlers
} from './api';
import { ChatView, type PendingReply } from './components/ChatView';
import { Composer } from './components/Composer';
import { Login } from './components/Login';
import { SettingsDialog, type Theme } from './components/SettingsDialog';
import { Sidebar } from './components/Sidebar';
import { IconPlus, IconSidebar } from './components/icons';

const THEME_KEY = 'hc-theme';

const readTheme = (): Theme => {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
};

type Session = 'loading' | 'login' | 'ready';

export default function App() {
  const [session, setSession] = useState<Session>('loading');
  const [authRequired, setAuthRequired] = useState(false);
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loaded, setLoaded] = useState(true);
  const [pending, setPending] = useState<PendingReply | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState('');
  const [settings, setSettings] = useState<Settings>({ defaultModel: '', systemPrompt: '' });
  const [notice, setNotice] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const abortRef = useRef<AbortController | null>(null);
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeId;

  const busy = Boolean(pending?.streaming);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  const handleError = useCallback((err: unknown) => {
    if (err instanceof ApiError && err.status === 401) setSession('login');
    else setNotice((err as Error).message);
  }, []);

  const loadAll = useCallback(async () => {
    const [chatList, prefs] = await Promise.all([api.chats(), api.settings()]);
    setChats(chatList);
    setSettings(prefs);
    setModel(prefs.defaultModel);
    api
      .models()
      .then((m) => setModels(m.models))
      .catch((err) => setNotice((err as Error).message));
  }, []);

  useEffect(() => {
    api
      .session()
      .then(async (s) => {
        setAuthRequired(s.authRequired);
        if (!s.authenticated) return setSession('login');
        await loadAll();
        setSession('ready');
      })
      .catch(handleError);
  }, [loadAll, handleError]);

  const refreshChats = useCallback(
    () => api.chats().then(setChats).catch(handleError),
    [handleError]
  );

  const openChat = useCallback(
    async (id: string | null) => {
      abortRef.current?.abort();
      setPending(null);
      setSidebarOpen(false);
      setActiveId(id);
      if (!id) {
        setMessages([]);
        setLoaded(true);
        setModel(settings.defaultModel);
        return;
      }
      setLoaded(false);
      const chat = chats.find((c) => c.id === id);
      if (chat?.model) setModel(chat.model);
      try {
        const list = await api.messages(id);
        if (activeRef.current === id) {
          setMessages(list);
          setLoaded(true);
        }
      } catch (err) {
        handleError(err);
      }
    },
    [chats, settings.defaultModel, handleError]
  );

  const runStream = useCallback(
    async (
      chatId: string,
      start: (handlers: StreamHandlers, signal: AbortSignal) => Promise<void>,
      tempUserId?: string
    ) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setPending({ text: '', model, error: null, streaming: true });
      const isActive = () => activeRef.current === chatId && !controller.signal.aborted;

      try {
        await start(
          {
            onUser: (saved) => {
              if (!isActive()) return;
              setMessages((list) => list.map((m) => (m.id === tempUserId ? saved : m)));
              // The server titles a chat from its first message; show it right away.
              refreshChats();
            },
            onDelta: (text) => {
              if (!isActive()) return;
              setPending((p) => (p ? { ...p, text: p.text + text } : p));
            },
            onDone: (saved) => {
              if (!isActive()) return;
              if (saved) setMessages((list) => [...list, saved]);
              setPending(null);
            },
            onError: (message, partial) => {
              if (!isActive()) return;
              if (partial) setMessages((list) => [...list, partial]);
              setPending({ text: '', model, error: message, streaming: false });
            }
          },
          controller.signal
        );
      } catch (err) {
        if (!controller.signal.aborted) {
          setPending({ text: '', model, error: (err as Error).message, streaming: false });
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        refreshChats();
      }
    },
    [model, refreshChats]
  );

  const send = useCallback(
    async (text: string) => {
      let chatId = activeId;
      try {
        if (!chatId) {
          const chat = await api.createChat(model);
          chatId = chat.id;
          setChats((list) => [chat, ...list]);
          setActiveId(chat.id);
          activeRef.current = chat.id;
        }
      } catch (err) {
        return handleError(err);
      }
      const tempId = `temp-${Date.now()}`;
      setMessages((list) => [
        ...list,
        {
          id: tempId,
          chatId: chatId!,
          role: 'user',
          content: text,
          model: null,
          createdAt: Date.now()
        }
      ]);
      const id = chatId!;
      await runStream(id, (h, signal) => streamMessage(id, text, model, h, signal), tempId);
    },
    [activeId, model, runStream, handleError]
  );

  const regenerate = useCallback(async () => {
    if (!activeId || busy) return;
    const id = activeId;
    setMessages((list) => (list.at(-1)?.role === 'assistant' ? list.slice(0, -1) : list));
    await runStream(id, (h, signal) => streamRegenerate(id, model, h, signal));
  }, [activeId, busy, model, runStream]);

  const stop = useCallback(() => {
    const id = activeRef.current;
    abortRef.current?.abort();
    setPending(null);
    // The server keeps whatever was generated before the stop; show it.
    if (id) {
      setTimeout(() => {
        if (activeRef.current === id) api.messages(id).then(setMessages).catch(handleError);
      }, 300);
    }
  }, [handleError]);

  const deleteFrom = useCallback(
    async (messageId: string) => {
      if (!activeId || !confirm('Delete this message and everything after it?')) return;
      try {
        await api.deleteFrom(activeId, messageId);
        setPending(null);
        setMessages(await api.messages(activeId));
      } catch (err) {
        handleError(err);
      }
    },
    [activeId, handleError]
  );

  const changeModel = useCallback(
    (next: string) => {
      setModel(next);
      if (activeId) {
        api
          .updateChat(activeId, { model: next })
          .then((chat) => setChats((list) => list.map((c) => (c.id === chat.id ? chat : c))))
          .catch(handleError);
      }
    },
    [activeId, handleError]
  );

  if (session === 'loading') return <div className="splash" />;
  if (session === 'login') {
    return (
      <Login
        onSuccess={async () => {
          await loadAll().catch(handleError);
          setSession('ready');
        }}
      />
    );
  }

  const activeChat = chats.find((c) => c.id === activeId);

  return (
    <div className={`app ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <Sidebar
        chats={chats}
        activeId={activeId}
        onSelect={openChat}
        onNew={() => openChat(null)}
        onRename={(id, title) =>
          api
            .updateChat(id, { title })
            .then((chat) => setChats((list) => list.map((c) => (c.id === id ? chat : c))))
            .catch(handleError)
        }
        onDelete={async (id) => {
          try {
            await api.deleteChat(id);
            setChats((list) => list.filter((c) => c.id !== id));
            if (id === activeId) openChat(null);
          } catch (err) {
            handleError(err);
          }
        }}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <div className="sidebar-scrim" onClick={() => setSidebarOpen(false)} />
      <main className="main">
        <header className="topbar">
          <button
            type="button"
            className="icon-button mobile-only"
            aria-label="Open chats"
            onClick={() => setSidebarOpen(true)}
          >
            <IconSidebar />
          </button>
          <div className="topbar-title">{activeChat?.title ?? 'New chat'}</div>
          <button
            type="button"
            className="icon-button mobile-only"
            aria-label="New chat"
            onClick={() => openChat(null)}
          >
            <IconPlus />
          </button>
        </header>
        {notice && (
          <div className="notice" role="alert">
            {notice}
            <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)}>
              ×
            </button>
          </div>
        )}
        <ChatView
          chatKey={activeId ?? 'new'}
          loaded={loaded}
          messages={messages}
          pending={pending}
          busy={busy}
          onRegenerate={regenerate}
          onDeleteFrom={deleteFrom}
          composer={
            <Composer
              busy={busy}
              models={models}
              model={model}
              onModelChange={changeModel}
              onSend={send}
              onStop={stop}
              autoFocusKey={activeId}
            />
          }
        />
      </main>
      <SettingsDialog
        open={settingsOpen}
        settings={settings}
        models={models}
        theme={theme}
        authRequired={authRequired}
        onThemeChange={setTheme}
        onSave={async (next) => {
          const saved = await api.saveSettings(next);
          setSettings(saved);
          if (!activeId) setModel(saved.defaultModel);
        }}
        onLogout={async () => {
          await api.logout().catch(() => undefined);
          setSettingsOpen(false);
          setSession('login');
        }}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}

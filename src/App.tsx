import { useEffect, useReducer, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { commands } from './bridge/commands';
import { events } from './bridge/events';
import { ChatPanel } from './chat/ChatPanel';
import {
  buildProviderMessages,
  conversationReducer,
  initialConversationState,
} from './chat/conversation';
import { FloatingBall } from './floating/FloatingBall';
import { defaultSettingsForm, type SettingsFormInput } from './settings/settings';
import { SettingsPanel } from './settings/SettingsPanel';
import './styles/app.css';

type WindowRole = 'floating' | 'chat' | 'settings';

function currentWindowRole(): WindowRole {
  try {
    const label = getCurrentWindow().label;
    if (label === 'chat') return 'chat';
    if (label === 'settings') return 'settings';
    return 'floating';
  } catch {
    return 'floating';
  }
}

function FloatingSurface() {
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    const unlisten = Promise.all([
      events.onChatDelta(() => setIsBusy(true)),
      events.onChatDone(() => setIsBusy(false)),
      events.onChatError(() => setIsBusy(false)),
    ]);
    return () => {
      void unlisten.then((listeners) => listeners.forEach((listener) => listener()));
    };
  }, []);

  return <FloatingBall isBusy={isBusy} onActivate={() => void commands.showChatPanel()} />;
}

function ChatSurface() {
  const [conversation, dispatch] = useReducer(conversationReducer, initialConversationState);

  useEffect(() => {
    const unlisten = Promise.all([
      events.onChatDelta((payload) => dispatch({ type: 'delta', ...payload })),
      events.onChatDone((payload) => dispatch({ type: 'done', ...payload })),
      events.onChatError((payload) =>
        dispatch({ type: 'error', requestId: payload.requestId, message: payload.message }),
      ),
    ]);
    return () => {
      void unlisten.then((listeners) => listeners.forEach((listener) => listener()));
    };
  }, []);

  async function sendMessage(content: string) {
    const requestId = await commands.startChat([
      ...buildProviderMessages(conversation.messages),
      { role: 'user', content },
    ]);
    dispatch({ type: 'send', requestId, content });
    return requestId;
  }

  async function stopMessage(requestId: string) {
    await commands.stopChat(requestId);
    dispatch({ type: 'stopped', requestId });
  }

  return (
    <ChatPanel
      messages={conversation.messages}
      status={conversation.status}
      activeRequestId={conversation.activeRequestId}
      error={conversation.error}
      onSend={sendMessage}
      onStop={stopMessage}
      onClear={() => dispatch({ type: 'clear' })}
      onCollapse={() => void commands.showFloatingBall()}
      onOpenSettings={() => void commands.showSettingsPanel()}
    />
  );
}

function SettingsSurface() {
  const [initialSettings, setInitialSettings] = useState<SettingsFormInput | null>(null);

  useEffect(() => {
    commands
      .getSettings()
      .then((settings) =>
        setInitialSettings({
          apiKey: '',
          baseUrl: settings.baseUrl,
          model: settings.model,
          globalShortcut: settings.globalShortcut,
          autostartEnabled: settings.autostartEnabled,
          floatingAlwaysOnTop: settings.floatingAlwaysOnTop,
        }),
      )
      .catch(() => setInitialSettings(defaultSettingsForm));
  }, []);

  if (!initialSettings) {
    return <p>加载设置...</p>;
  }

  return (
    <SettingsPanel
      initialSettings={initialSettings}
      onSave={async (settings) => {
        await commands.saveSettings(settings);
        await commands.showFloatingBall();
      }}
      onClose={() => void commands.showFloatingBall()}
    />
  );
}

export default function App() {
  const role = currentWindowRole();
  if (role === 'chat') return <ChatSurface />;
  if (role === 'settings') return <SettingsSurface />;
  return <FloatingSurface />;
}

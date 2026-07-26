import { useEffect, useReducer, useState } from 'react';
import { commands, type AppSettings } from './bridge/commands';
import { events } from './bridge/events';
import { ChatPanel } from './chat/ChatPanel';
import {
  buildProviderMessages,
  conversationReducer,
  initialConversationState,
} from './chat/conversation';
import { prefersReducedMotion } from './app/motion';
import { FloatingBall } from './floating/FloatingBall';
import { defaultSettingsForm, type SettingsFormInput } from './settings/settings';
import { SettingsPanel } from './settings/SettingsPanel';
import './styles/app.css';

type MainSurface = 'floating' | 'chat' | 'settings';

function settingsFormFromPublic(settings: AppSettings) {
  return {
    apiKey: '',
    baseUrl: settings.baseUrl,
    model: settings.model,
    globalShortcut: settings.globalShortcut,
    autostartEnabled: settings.autostartEnabled,
    floatingAlwaysOnTop: settings.floatingAlwaysOnTop,
  } satisfies SettingsFormInput;
}

export default function App() {
  const [surface, setSurface] = useState<MainSurface>('floating');
  const [settingsForm, setSettingsForm] = useState<SettingsFormInput>(defaultSettingsForm);
  const [conversation, dispatch] = useReducer(conversationReducer, initialConversationState);

  useEffect(() => {
    const unlisten = Promise.all([
      events.onSurfaceChanged(setSurface),
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
    const requestId = crypto.randomUUID();
    const providerMessages = [
      ...buildProviderMessages(conversation.messages),
      { role: 'user' as const, content },
    ];

    dispatch({ type: 'send', requestId, content });
    try {
      await commands.startChat(requestId, providerMessages);
    } catch (error) {
      dispatch({
        type: 'error',
        requestId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return requestId;
  }

  async function stopMessage(requestId: string) {
    await commands.stopChat(requestId);
    dispatch({ type: 'stopped', requestId });
  }

  async function openSettings() {
    const settings = await commands.getSettings().catch(() => null);
    setSettingsForm(settings ? settingsFormFromPublic(settings) : defaultSettingsForm);
    await commands.showSettingsPanel();
    setSurface('settings');
  }

  async function returnToChat() {
    await commands.showChatPanel(prefersReducedMotion());
    setSurface('chat');
  }

  if (surface === 'settings') {
    return (
      <SettingsPanel
        initialSettings={settingsForm}
        onSave={async (settings) => {
          await commands.saveSettings(settings);
          await returnToChat();
        }}
        onClose={returnToChat}
      />
    );
  }

  if (surface === 'chat') {
    return (
      <ChatPanel
        messages={conversation.messages}
        status={conversation.status}
        activeRequestId={conversation.activeRequestId}
        error={conversation.error}
        onSend={sendMessage}
        onStop={stopMessage}
        onClear={() => dispatch({ type: 'clear' })}
        onCollapse={() => {
          void commands
            .showFloatingBall(prefersReducedMotion())
            .then(() => setSurface('floating'))
            .catch((error) => console.error('收起对话面板失败', error));
        }}
        onOpenSettings={() => {
          void openSettings().catch((error) => console.error('打开设置失败', error));
        }}
      />
    );
  }

  return (
    <FloatingBall
      isBusy={conversation.status === 'streaming'}
      onActivate={() => {
        void commands
          .showChatPanel(prefersReducedMotion())
          .then(() => setSurface('chat'))
          .catch((error) => console.error('打开对话面板失败', error));
      }}
    />
  );
}

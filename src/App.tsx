import { useEffect, useReducer, useRef, useState } from 'react';
import { commands, type AppSettings } from './bridge/commands';
import { events } from './bridge/events';
import { AssistantPanel } from './chat/AssistantPanel';
import { deriveAssistantPhase, type AssistantPhase } from './chat/assistantSurface';
import {
  buildProviderMessages,
  conversationReducer,
  initialConversationState,
} from './chat/conversation';
import { prefersReducedMotion, RESPONSE_MIN_HEIGHT } from './app/motion';
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
  const expandedRequests = useRef(new Set<string>());
  const assistantPhase = deriveAssistantPhase(conversation);

  useEffect(() => {
    const unlisten = Promise.all([
      events.onSurfaceChanged(setSurface),
      events.onChatDelta((payload) => {
        dispatch({ type: 'delta', ...payload });
        if (payload.content && !expandedRequests.current.has(payload.requestId)) {
          expandedRequests.current.add(payload.requestId);
          void commands.resizeResponsePanel(RESPONSE_MIN_HEIGHT, prefersReducedMotion());
        }
      }),
      events.onChatDone((payload) => dispatch({ type: 'done', ...payload })),
      events.onChatError((payload) =>
        dispatch({ type: 'error', requestId: payload.requestId, message: payload.message }),
      ),
    ]);
    return () => {
      void unlisten.then((listeners) => listeners.forEach((listener) => listener()));
    };
  }, []);

  async function showAssistantPhase(phase: AssistantPhase) {
    const reducedMotion = prefersReducedMotion();
    if (phase === 'prompt') await commands.showPromptBar(reducedMotion);
    else if (phase === 'waiting') await commands.showWaitingBall(reducedMotion);
    else await commands.resizeResponsePanel(RESPONSE_MIN_HEIGHT, reducedMotion);
    setSurface('chat');
  }

  async function sendMessage(content: string) {
    const requestId = crypto.randomUUID();
    const providerMessages = [
      ...buildProviderMessages(conversation.messages),
      { role: 'user' as const, content },
    ];

    dispatch({ type: 'send', requestId, content });
    await commands.showWaitingBall(prefersReducedMotion());
    try {
      await commands.startChat(requestId, providerMessages);
    } catch (error) {
      dispatch({
        type: 'error',
        requestId,
        message: error instanceof Error ? error.message : String(error),
      });
      await commands.resizeResponsePanel(RESPONSE_MIN_HEIGHT, prefersReducedMotion());
    }
    return requestId;
  }

  async function stopMessage(requestId: string) {
    await commands.stopChat(requestId);
    dispatch({ type: 'stopped', requestId });
    const hasContent = conversation.messages.some(
      (message) => message.requestId === requestId && message.content.length > 0,
    );
    if (hasContent) await commands.resizeResponsePanel(RESPONSE_MIN_HEIGHT, prefersReducedMotion());
    else await commands.showPromptBar(prefersReducedMotion());
  }

  async function openSettings() {
    const settings = await commands.getSettings().catch(() => null);
    setSettingsForm(settings ? settingsFormFromPublic(settings) : defaultSettingsForm);
    await commands.showSettingsPanel();
    setSurface('settings');
  }

  async function returnToAssistant() {
    await showAssistantPhase(assistantPhase);
  }

  if (surface === 'settings') {
    return (
      <SettingsPanel
        initialSettings={settingsForm}
        onSave={async (settings) => {
          await commands.saveSettings(settings);
          await returnToAssistant();
        }}
        onClose={returnToAssistant}
      />
    );
  }

  if (surface === 'chat') {
    return (
      <AssistantPanel
        conversation={conversation}
        onSend={sendMessage}
        onStop={stopMessage}
        onClear={() => {
          expandedRequests.current.clear();
          dispatch({ type: 'clear' });
          void commands.showPromptBar(prefersReducedMotion());
        }}
        onCollapse={() => {
          void commands
            .showFloatingBall(prefersReducedMotion())
            .then(() => setSurface('floating'))
            .catch((error) => console.error('收起对话面板失败', error));
        }}
        onOpenSettings={() => {
          void openSettings().catch((error) => console.error('打开设置失败', error));
        }}
        onContentHeight={(height) => {
          void commands.resizeResponsePanel(height, prefersReducedMotion());
        }}
      />
    );
  }

  return (
    <FloatingBall
      isBusy={conversation.status === 'streaming'}
      onActivate={() => {
        void showAssistantPhase(assistantPhase).catch((error) =>
          console.error('打开助手表面失败', error),
        );
      }}
    />
  );
}

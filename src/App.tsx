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
  const conversationRef = useRef(conversation);
  conversationRef.current = conversation;
  const expandedRequests = useRef(new Set<string>());
  const assistantPhase = deriveAssistantPhase(conversation);

  async function syncNativePhase(phase: AssistantPhase) {
    const reducedMotion = prefersReducedMotion();
    if (phase === 'prompt') await commands.showPromptBar(reducedMotion);
    else if (phase === 'waiting') await commands.showWaitingBall(reducedMotion);
    else await commands.resizeResponsePanel(RESPONSE_MIN_HEIGHT, reducedMotion);
  }

  function stateAfter(action: Parameters<typeof conversationReducer>[1]) {
    const next = conversationReducer(conversationRef.current, action);
    conversationRef.current = next;
    dispatch(action);
    return next;
  }

  useEffect(() => {
    const unlisten = Promise.all([
      events.onSurfaceChanged(setSurface),
      events.onChatDelta((payload) => {
        const active = conversationRef.current.activeRequestId === payload.requestId;
        stateAfter({ type: 'delta', ...payload });
        if (active && payload.content) expandedRequests.current.add(payload.requestId);
      }),
      events.onChatDone((payload) => {
        if (conversationRef.current.activeRequestId !== payload.requestId) return;
        const next = stateAfter({ type: 'done', ...payload });
        if (deriveAssistantPhase(next) === 'prompt') void syncNativePhase('prompt');
      }),
      events.onChatError((payload) => {
        if (conversationRef.current.activeRequestId !== payload.requestId) return;
        stateAfter({ type: 'error', requestId: payload.requestId, message: payload.message });
      }),
    ]);
    return () => {
      void unlisten.then((listeners) => listeners.forEach((listener) => listener()));
    };
  }, []);

  async function showAssistantPhase(phase: AssistantPhase) {
    if (phase !== 'response') await syncNativePhase(phase);
    setSurface('chat');
  }

  async function sendMessage(content: string) {
    const requestId = crypto.randomUUID();
    const providerMessages = [
      ...buildProviderMessages(conversationRef.current.messages),
      { role: 'user' as const, content },
    ];

    stateAfter({ type: 'send', requestId, content });
    try {
      await syncNativePhase('waiting');
      await commands.startChat(requestId, providerMessages);
    } catch (error) {
      stateAfter({
        type: 'error',
        requestId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return requestId;
  }

  async function stopMessage(requestId: string) {
    await commands.stopChat(requestId);
    if (conversationRef.current.activeRequestId !== requestId) return;
    const next = stateAfter({ type: 'stopped', requestId });
    if (deriveAssistantPhase(next) === 'prompt') await syncNativePhase('prompt');
  }

  async function openSettings() {
    const settings = await commands.getSettings().catch(() => null);
    setSettingsForm(settings ? settingsFormFromPublic(settings) : defaultSettingsForm);
    await commands.showSettingsPanel();
    setSurface('settings');
  }

  async function returnToAssistant() {
    await showAssistantPhase(deriveAssistantPhase(conversationRef.current));
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
          stateAfter({ type: 'clear' });
          void syncNativePhase('prompt');
        }}
        onCollapse={() => {
          void commands.showFloatingBall(prefersReducedMotion())
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
        void showAssistantPhase(assistantPhase).catch((error) => console.error('打开助手表面失败', error));
      }}
    />
  );
}

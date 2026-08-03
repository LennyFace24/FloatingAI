import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { commands, type AppSettings, type MultimodalContentPart } from './bridge/commands';
import { events } from './bridge/events';
import { AssistantPanel } from './chat/AssistantPanel';
import { deriveAssistantPhase, type AssistantPhase } from './chat/assistantSurface';
import { modelSupportsVision } from './chat/visionSupport';
import {
  buildProviderMessages,
  conversationReducer,
  initialConversationState,
} from './chat/conversation';
import { prefersReducedMotion, RESPONSE_MIN_HEIGHT } from './app/motion';
import { FloatingBall } from './floating/FloatingBall';
import { defaultSettingsForm, type SettingsFormInput } from './settings/settings';
import './styles/app.css';

// 设置页非首屏：懒加载，冷启动不解析
const SettingsPanel = lazy(() =>
  import('./settings/SettingsPanel').then((module) => ({ default: module.SettingsPanel })),
);

type MainSurface = 'floating' | 'chat' | 'settings';

function settingsFormFromPublic(settings: AppSettings) {
  return {
    apiKey: settings.apiKey ?? '',
    baseUrl: settings.baseUrl,
    model: settings.model,
    globalShortcut: settings.globalShortcut,
    autostartEnabled: settings.autostartEnabled,
    floatingAlwaysOnTop: settings.floatingAlwaysOnTop,
    sttBaseUrl: settings.sttBaseUrl,
    sttModel: settings.sttModel,
    sttApiKey: settings.sttApiKey ?? '',
    sttLanguage: settings.sttLanguage,
    sttProvider: settings.sttProvider,
  } satisfies SettingsFormInput;
}

export default function App() {
  const [surface, setSurface] = useState<MainSurface>('floating');
  // 设置页→输入条交叉淡化：设置页保持挂载淡出、输入条叠加淡入，动画后卸载
  const [leavingSettings, setLeavingSettings] = useState(false);
  const [settingsForm, setSettingsForm] = useState<SettingsFormInput>(defaultSettingsForm);
  const settingsFormRef = useRef(settingsForm);
  settingsFormRef.current = settingsForm;
  const conversationRef = useRef(initialConversationState);
  const [conversation, setConversation] = useState(initialConversationState);
  const surfaceRef = useRef<MainSurface>('floating');
  const assistantPhase = deriveAssistantPhase(conversation);

  // surface 切换后通知 Rust 渲染完成（双 rAF 确保当前帧已提交到 WebView2），
  // Rust 据此才开始窗口动画——否则动画期间显示的是旧 surface 内容。
  useEffect(() => {
    let frame1 = 0;
    let frame2 = 0;
    frame1 = requestAnimationFrame(() => {
      frame2 = requestAnimationFrame(() => {
        void commands.surfaceReady().catch(() => undefined);
      });
    });
    return () => {
      cancelAnimationFrame(frame1);
      cancelAnimationFrame(frame2);
    };
  }, [surface]);

  async function syncNativePhase(phase: AssistantPhase) {
    const reducedMotion = prefersReducedMotion();
    if (phase === 'prompt') await commands.showPromptBar(reducedMotion);
    else if (phase === 'waiting') await commands.showWaitingBall(reducedMotion);
    else await commands.showResponsePanel(RESPONSE_MIN_HEIGHT, reducedMotion);
  }

  function dispatchConversation(action: Parameters<typeof conversationReducer>[1]) {
    const next = conversationReducer(conversationRef.current, action);
    conversationRef.current = next;
    setConversation(next);
    return next;
  }

  useEffect(() => {
    const unlisten = Promise.all([
      events.onSurfaceChanged((next) => {
        // 设置页→输入条：触发交叉淡化（设置页淡出 + 输入条淡入），动画后卸载设置页
        if (next === 'chat' && surfaceRef.current === 'settings') {
          setLeavingSettings(true);
          // 与 Rust 窗口形变时长（380ms）同步，淡化结束后卸载设置页
          window.setTimeout(() => setLeavingSettings(false), 380);
        }
        surfaceRef.current = next;
        setSurface(next);
      }),
      events.onSurfaceShowRequested(() => {
        void showAssistantPhase(deriveAssistantPhase(conversationRef.current));
      }),
      events.onChatDelta((payload) => {
        dispatchConversation({ type: 'delta', ...payload });
      }),
      events.onChatDone((payload) => {
        if (conversationRef.current.activeRequestId !== payload.requestId) return;
        const next = dispatchConversation({ type: 'done', ...payload });
        if (deriveAssistantPhase(next) === 'prompt') void syncNativePhase('prompt');
      }),
      events.onChatError((payload) => {
        if (conversationRef.current.activeRequestId !== payload.requestId) return;
        dispatchConversation({ type: 'error', requestId: payload.requestId, message: payload.message });
      }),
    ]);
    return () => {
      void unlisten.then((listeners) => listeners.forEach((listener) => listener()));
    };
  }, []);

  async function showAssistantPhase(phase: AssistantPhase) {
    // 先切 surface 再调 Rust 命令：Rust 动画会等 surface_ready，
    // 而 surfaceReady effect 依赖 surface 变化触发——若等命令返回才 setSurface，
    // 命令与 surfaceReady 互相等待（死锁）。先设 surface，命令返回后无需再设。
    setSurface('chat');
    await syncNativePhase(phase);
  }

  async function sendMessage(content: string | MultimodalContentPart[]) {
    const requestId = crypto.randomUUID();
    // 提取文本与图片 data URI（本地展示用）
    const textPart = Array.isArray(content)
      ? content
          .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
          .map((part) => part.text)
          .join(' ')
          .trim()
      : content;
    const imageUrl = Array.isArray(content)
      ? content.find((part): part is { type: 'image_url'; image_url: { url: string } } => part.type === 'image_url')
          ?.image_url.url
      : undefined;

    // 带图消息：模型不支持图片时拦截——先入列用户消息并进入 loading，
    // 再 dispatch error（错误入列 assistant 消息，带入后续上下文）。
    if (Array.isArray(content) && !modelSupportsVision(settingsForm.model)) {
      dispatchConversation({
        type: 'send',
        requestId,
        content: textPart || '[图片]',
        imageUrl,
      });
      try {
        await syncNativePhase('waiting');
      } finally {
        dispatchConversation({
          type: 'error',
          requestId,
          message: `当前模型（${settingsForm.model}）不支持图片输入，请更换支持视觉的模型或移除图片。`,
        });
        await syncNativePhase('response').catch(() => undefined);
      }
      return requestId;
    }

    const providerMessages = [
      ...buildProviderMessages(conversationRef.current.messages),
      { role: 'user' as const, content },
    ];

    dispatchConversation({
      type: 'send',
      requestId,
      content: textPart || '[图片]',
      imageUrl,
    });
    try {
      await syncNativePhase('waiting');
      await commands.startChat(requestId, providerMessages);
    } catch (error) {
      dispatchConversation({
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
    const next = dispatchConversation({ type: 'stopped', requestId });
    if (deriveAssistantPhase(next) === 'prompt') await syncNativePhase('prompt');
  }

  async function openSettings() {
    const settings = await commands.getSettings().catch(() => null);
    setSettingsForm(settings ? settingsFormFromPublic(settings) : defaultSettingsForm);
    await commands.showSettingsPanel(prefersReducedMotion());
    setSurface('settings');
  }

  async function returnToAssistant() {
    const phase = deriveAssistantPhase(conversationRef.current);
    const messages = conversationRef.current.messages;
    // 历史记录较多/含图片时，渲染（KaTeX、图片解码）可能耗时：
    // 先切到悬浮球（无动画延迟），等渲染完成再展开——避免动画期间卡顿/渲染不完全。
    const heavy =
      messages.length > 15 ||
      messages.some((message) => message.imageUrl || message.content.includes('```') || message.content.includes('$'));
    if (heavy) {
      // 立即显示悬浮球（前端 + Rust 同步）
      setSurface('floating');
      await commands.showFloatingBall(prefersReducedMotion()).catch(() => undefined);
      // 双 rAF：确保 React commit 完成、重内容（KaTeX/图片）布局渲染完
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
    }
    await showAssistantPhase(phase);
  }

  if (surface === 'settings') {
    return (
      <Suspense fallback={<div className="settings-loading" role="status">加载设置…</div>}>
        <SettingsPanel
          initialSettings={settingsForm}
          onSave={async (settings) => {
            await commands.saveSettings(settings);
            await returnToAssistant();
          }}
          onClose={returnToAssistant}
        />
      </Suspense>
    );
  }

  if (surface === 'chat') {
    return (
      <>
        {leavingSettings ? (
          // 交叉淡化：设置页淡出层（不交互，pointer-events 关）
          <div className="settings-fade-out" aria-hidden="true">
            <SettingsPanel
              initialSettings={settingsFormRef.current}
              onSave={async () => {}}
              onClose={() => {}}
            />
          </div>
        ) : null}
        <div className={leavingSettings ? 'prompt-fade-in' : undefined}>
          <AssistantPanel
            conversation={conversation}
            onSend={sendMessage}
            onStop={stopMessage}
            onClear={() => {
              dispatchConversation({ type: 'clear' });
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
        </div>
      </>
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

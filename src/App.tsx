import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { commands, type AppSettings } from './bridge/commands';
import { events } from './bridge/events';
import { AssistantPanel } from './chat/AssistantPanel';
import { useChatSession } from './chat/useChatSession';
import type { AssistantPhase } from './chat/assistantSurface';
import { prefersReducedMotion, RESPONSE_MIN_HEIGHT } from './app/motion';
import { FloatingBall } from './floating/FloatingBall';
import { defaultSettingsForm, type SettingsFormInput } from './settings/settings';
import './styles/app.css';

// 设置页非首屏：懒加载，冷启动不解析
const SettingsPanel = lazy(() =>
  import('./settings/SettingsPanel').then((module) => ({ default: module.SettingsPanel })),
);

type MainSurface = 'floating' | 'chat' | 'settings';

function settingsFormFromPublic(settings: AppSettings): SettingsFormInput {
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
  };
}

export default function App() {
  const [surface, setSurface] = useState<MainSurface>('floating');
  // 设置页→输入条交叉淡化：设置页保持挂载淡出、输入条叠加淡入，动画后卸载
  const [leavingSettings, setLeavingSettings] = useState(false);
  const [settingsForm, setSettingsForm] = useState<SettingsFormInput>(defaultSettingsForm);
  const settingsFormRef = useRef(settingsForm);
  settingsFormRef.current = settingsForm;
  const surfaceRef = useRef<MainSurface>('floating');

  async function syncNativePhase(phase: AssistantPhase) {
    const reducedMotion = prefersReducedMotion();
    if (phase === 'prompt') await commands.showPromptBar(reducedMotion);
    else if (phase === 'waiting') await commands.showWaitingBall(reducedMotion);
    else await commands.showResponsePanel(RESPONSE_MIN_HEIGHT, reducedMotion);
  }

  // 聊天会话状态（conversation + 事件 + 发送/停止）
  const { conversation, assistantPhase, sendMessage, stopMessage, clear } = useChatSession({
    model: settingsForm.model,
    onShowPhase: syncNativePhase,
  });
  const assistantPhaseRef = useRef(assistantPhase);
  assistantPhaseRef.current = assistantPhase;
  // surface 切换后通知 Rust 渲染完成。双 rAF 确保当前帧提交到 WebView2；
  // 再等一次 requestIdleCallback（主线程任务排空）——重历史（KaTeX/图片/大 DOM）
  // 的渲染跨多帧，空闲回调表示渲染稳定，Rust 此时才启动动画，避免「渲染一半」。
  useEffect(() => {
    let frame1 = 0;
    let frame2 = 0;
    let idle: number | undefined;
    const notify = () => void commands.surfaceReady().catch(() => undefined);
    frame1 = requestAnimationFrame(() => {
      frame2 = requestAnimationFrame(() => {
        if (typeof requestIdleCallback === 'function') {
          idle = requestIdleCallback(notify, { timeout: 1000 });
        } else {
          notify();
        }
      });
    });
    return () => {
      cancelAnimationFrame(frame1);
      cancelAnimationFrame(frame2);
      if (idle !== undefined && typeof cancelIdleCallback === 'function') cancelIdleCallback(idle);
    };
  }, [surface]);

  // surface 事件监听（交叉淡化触发）
  useEffect(() => {
    const unlisten = Promise.all([
      events.onSurfaceChanged((next) => {
        if (next === 'chat' && surfaceRef.current === 'settings') {
          setLeavingSettings(true);
          window.setTimeout(() => setLeavingSettings(false), 380);
        }
        surfaceRef.current = next;
        setSurface(next);
      }),
      events.onSurfaceShowRequested(() => {
        // 用 ref 读最新 phase（事件回调闭包捕获的 assistantPhase 是挂载时的旧值）
        void showAssistantPhase(assistantPhaseRef.current);
      }),
    ]);
    return () => {
      void unlisten.then((listeners) => listeners.forEach((listener) => listener()));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function showAssistantPhase(phase: AssistantPhase) {
    // 先切 surface 再调 Rust 命令：Rust 动画会等 surface_ready，
    // 而 surfaceReady effect 依赖 surface 变化触发——若等命令返回才 setSurface，
    // 命令与 surfaceReady 互相等待（死锁）。先设 surface，命令返回后无需再设。
    setSurface('chat');
    await syncNativePhase(phase);
  }

  async function openSettings() {
    const settings = await commands.getSettings().catch(() => null);
    setSettingsForm(settings ? settingsFormFromPublic(settings) : defaultSettingsForm);
    await commands.showSettingsPanel(prefersReducedMotion());
    setSurface('settings');
  }

  async function returnToAssistant() {
    await showAssistantPhase(assistantPhase);
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
              clear();
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

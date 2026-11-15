import { useCallback, useEffect } from 'react';
import { CLIENT_ID_HEADER, getClientId } from '@/lib/client-id';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useTtsStore } from '@/store/useTtsStore';

/**
 * 朗读 hook（doc/tts.md §7）：POST /api/tts 合成 → 逐段 Blob 串行播放。
 *
 * 互斥与中断模型：模块级单例 runtime + 递增 runId 令牌——每次 speak/stop 都
 * 自增 runId，旧播放循环在下一个检查点看到令牌变更即退出；同一时刻至多一条
 * 消息在朗读，点正在朗读的消息 = 停止。消息卸载（切会话/删消息）时停掉本条，
 * 避免声音残留。
 */

interface TtsRuntime {
  runId: number;
  audio: HTMLAudioElement | null;
  urls: string[];
  controller: AbortController | null;
  /** 正在播放段的解除挂起句柄：stop 后 runId 已变，resolve 让旧循环退出而非悬挂 */
  cancelCurrent: (() => void) | null;
}

const runtime: TtsRuntime = {
  runId: 0,
  audio: null,
  urls: [],
  controller: null,
  cancelCurrent: null,
};

/** 硬停：中止请求、暂停音频、释放 Blob URL、令牌自增使进行中的循环退出 */
function stopRuntime() {
  runtime.runId += 1;
  runtime.controller?.abort();
  runtime.controller = null;
  runtime.audio?.pause();
  runtime.audio = null;
  runtime.cancelCurrent?.();
  runtime.cancelCurrent = null;
  for (const url of runtime.urls) URL.revokeObjectURL(url);
  runtime.urls = [];
}

function base64ToBytes(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return buffer;
}

function playSegment(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const audio = new Audio(url);
    const finish = () => {
      runtime.cancelCurrent = null;
      resolve();
    };
    runtime.cancelCurrent = finish;
    runtime.audio = audio;
    audio.onended = finish;
    audio.onerror = () => {
      runtime.cancelCurrent = null;
      reject(new Error('音频播放失败'));
    };
    // autoplay 策略拒绝时以 reject 暴露（移动端手势约束，doc/tts.md §8 挂账）
    audio.play().catch(() => {
      runtime.cancelCurrent = null;
      reject(new Error('浏览器拒绝了音频播放'));
    });
  });
}

async function speak(messageId: string, text: string): Promise<void> {
  stopRuntime();
  const runId = runtime.runId;
  const controller = new AbortController();
  runtime.controller = controller;
  useTtsStore.getState().start(messageId);

  try {
    const tts = useSettingsStore.getState().settings.tts;
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [CLIENT_ID_HEADER]: getClientId() },
      body: JSON.stringify({ text, engine: tts.engine, voice: tts.voice }),
      signal: controller.signal,
    });
    if (runId !== runtime.runId) return;
    if (!res.ok) {
      // 错误体 { error, message }：message 中文可直显（doc/tts.md §6）
      const payload = (await res.json().catch(() => null)) as { message?: unknown } | null;
      if (runId !== runtime.runId) return;
      const message =
        typeof payload?.message === 'string' && payload.message
          ? payload.message
          : `朗读失败（HTTP ${res.status}）`;
      useTtsStore.getState().fail(message);
      return;
    }

    const data = (await res.json()) as { segments?: unknown };
    if (runId !== runtime.runId) return;
    const rawSegments = Array.isArray(data.segments) ? data.segments : [];
    const urls: string[] = [];
    for (const seg of rawSegments) {
      const base64 =
        seg && typeof seg === 'object' && typeof (seg as { base64?: unknown }).base64 === 'string'
          ? (seg as { base64: string }).base64
          : '';
      if (!base64) throw new Error('朗读响应缺少音频数据');
      urls.push(URL.createObjectURL(new Blob([base64ToBytes(base64)], { type: 'audio/wav' })));
    }
    runtime.urls = urls;
    if (urls.length === 0) throw new Error('朗读响应没有音频段');

    useTtsStore.getState().beginPlayback(urls.length);
    for (let i = 0; i < urls.length; i += 1) {
      if (runId !== runtime.runId) return;
      useTtsStore.getState().progress(i);
      await playSegment(urls[i]);
    }
    if (runId !== runtime.runId) return;
    // 播完：释放资源并回空闲（stopRuntime 再自增一次令牌无副作用）
    stopRuntime();
    useTtsStore.getState().clear();
  } catch (err) {
    if (runId !== runtime.runId) return; // 被打断：不算错误，状态已由 stop 流程清理
    if (err instanceof DOMException && err.name === 'AbortError') return;
    const message = err instanceof Error ? err.message : String(err);
    useTtsStore.getState().fail(message);
  }
}

export interface UseTtsResult {
  /** null = 本条消息不在朗读；其余为当前阶段（供按钮换图标） */
  phase: 'loading' | 'playing' | 'error' | null;
  segmentIndex: number;
  segmentCount: number;
  /** 本条消息的失败原因（他条失败不串台） */
  errorMessage: string;
  /** 点按：空闲/失败态开始朗读，播放/加载态停止 */
  toggle: (text: string) => void;
}

export function useTts(messageId: string): UseTtsResult {
  const state = useTtsStore();
  const isMine = state.messageId === messageId;

  const toggle = useCallback(
    (text: string) => {
      const current = useTtsStore.getState();
      if (current.messageId === messageId && current.phase !== 'error') {
        stopRuntime();
        useTtsStore.getState().clear();
        return;
      }
      void speak(messageId, text);
    },
    [messageId],
  );

  // 消息卸载（切会话/删消息/重渲染摘除）时停掉本条朗读
  useEffect(
    () => () => {
      if (useTtsStore.getState().messageId === messageId) {
        stopRuntime();
        useTtsStore.getState().clear();
      }
    },
    [messageId],
  );

  return {
    phase: isMine ? state.phase : null,
    segmentIndex: state.segmentIndex,
    segmentCount: state.segmentCount,
    errorMessage: isMine ? state.errorMessage : '',
    toggle,
  };
}

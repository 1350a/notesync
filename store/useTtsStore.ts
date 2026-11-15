import { create } from 'zustand';

/**
 * 朗读播放状态（doc/tts.md §7）：全局单例——同一时刻至多一条消息在朗读，
 * 跨消息互斥判断靠 messageId。音频元素/Blob/请求中止等运行时资源不进 React
 * 状态，由 hooks/useTts.ts 的模块级单例持有。
 */

/** 朗读播放阶段：loading=合成请求中；playing=分段播放中；error=失败待重试 */
export type TtsPhase = 'loading' | 'playing' | 'error';

interface TtsState {
  /** 正在朗读/刚失败的消息标识（ChatList 内 index 键）；null = 空闲 */
  messageId: string | null;
  phase: TtsPhase;
  /** 分段进度（0 起）：长回复朗读时让用户感知推进 */
  segmentIndex: number;
  segmentCount: number;
  /** 失败原因（上游 message 直显，按钮 title 展示） */
  errorMessage: string;
  start: (messageId: string) => void;
  beginPlayback: (segmentCount: number) => void;
  progress: (segmentIndex: number) => void;
  fail: (message: string) => void;
  clear: () => void;
}

export const useTtsStore = create<TtsState>((set) => ({
  messageId: null,
  phase: 'loading',
  segmentIndex: 0,
  segmentCount: 0,
  errorMessage: '',

  start: (messageId) => set({ messageId, phase: 'loading', segmentIndex: 0, segmentCount: 0, errorMessage: '' }),
  beginPlayback: (segmentCount) => set({ phase: 'playing', segmentCount }),
  progress: (segmentIndex) => set({ segmentIndex }),
  fail: (errorMessage) => set({ phase: 'error', errorMessage }),
  clear: () => set({ messageId: null, phase: 'loading', segmentIndex: 0, segmentCount: 0, errorMessage: '' }),
}));

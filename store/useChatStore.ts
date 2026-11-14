import { getHistoryStorage } from '@/lib/history/storage.ts';
import { normalizeTitle } from '@/lib/history/title.ts';
import type { SessionMeta } from '@/lib/history/types.ts';
import { createLocalStorageUIStorage } from '@/lib/ui/storage.ts';
import { create } from 'zustand';

// 主题偏好已迁移至 useSettingsStore（持久化 + 三态），本 store 只留会话级 UI 态

interface ChatState {
  isSettingsOpen: boolean;
  isSidebarOpen: boolean;
  /** 新建对话信号：每次递增，聊天页监听变化后清空当前会话 */
  newChatSignal: number;
  /** 历史会话列表（meta 表快照，按 updatedAt 倒序；不含消息体） */
  sessions: SessionMeta[];
  /**
   * 环境是否支持本地保存。初始乐观 true：SSR 无 indexedDB，若按实测值初始化会让
   * 首帧与客户端不一致而触发 hydration 警告；实测值由 mount 后的 refreshSessions 写入
   */
  historySupported: boolean;
  /**
   * 当前打开的会话 id；null = 尚无 id 的新对话。
   * 真源放这里而不是 useChat 的 ref：zustand 的 getState() 是同步读，满足落盘时序
   * "先 flush 再改 id"的要求，同时让侧栏能做当前项高亮与"删的是当前会话"判定
   * （doc/chat-history.md §7.1）
   */
  currentSessionId: string | null;
  /** 待打开的目标会话；为 null 且 openSessionSignal 变化 = 丢弃当前会话（不落盘） */
  pendingSessionId: string | null;
  openSessionSignal: number;
  /**
   * 改名广播（doc/chat-history.md §8.1）：useChat 的 sessionMetaRef 是内存态真源，
   * 侧栏改名后必须让它同步，否则下一次 flushSession 会用旧标题把库里的新标题覆盖回去
   */
  renamedSession: { id: string; title: string } | null;
  renameSignal: number;
  setSettingsOpen: (open: boolean) => void;
  /** 侧栏开合统一入口：内存态与持久化原子同步（doc/mobile-ux.md §2） */
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  /** mount 后从存储恢复侧栏上次状态（首帧一律收起，避免 SSR hydration 闪烁） */
  hydrateUI: () => void;
  startNewChat: () => void;
  /** 重读历史列表（meta 表）并同步环境能力 */
  refreshSessions: () => Promise<void>;
  /** 请求打开某个历史会话：由聊天页消费信号后调 useChat 载入 */
  openSession: (id: string) => void;
  /** 请求丢弃当前会话（不落盘）：用于"当前会话已被删除"场景 */
  requestNewChat: () => void;
  clearPendingSession: () => void;
  setCurrentSessionId: (id: string | null) => void;
  /** 删除会话：若删的是当前会话，先切断归属再删库，避免随后的落盘把它重建 */
  removeSession: (id: string) => Promise<void>;
  /** 会话改名：规整后写库并广播；标题为空/未变化返回 false（不写库） */
  renameSession: (id: string, title: string) => Promise<boolean>;
}

const uiStorage = createLocalStorageUIStorage();

export const useChatStore = create<ChatState>((set, get) => ({
  isSettingsOpen: false,
  // 默认收起：SSR 与客户端首帧一致；上次状态由 hydrateUI 在 mount 后恢复（带过渡动画）
  isSidebarOpen: false,
  newChatSignal: 0,
  sessions: [],
  // 乐观 true，避免 SSR/首帧与客户端不一致（见接口注释）
  historySupported: true,
  currentSessionId: null,
  pendingSessionId: null,
  openSessionSignal: 0,
  renamedSession: null,
  renameSignal: 0,

  setSettingsOpen: (open) => set({ isSettingsOpen: open }),
  setSidebarOpen: (open) => {
    set({ isSidebarOpen: open });
    uiStorage.save({ sidebarOpen: open });
  },
  toggleSidebar: () =>
    set((state) => {
      const open = !state.isSidebarOpen;
      uiStorage.save({ sidebarOpen: open });
      return { isSidebarOpen: open };
    }),
  hydrateUI: () => {
    const { sidebarOpen } = uiStorage.load();
    if (sidebarOpen) set({ isSidebarOpen: true });
  },
  startNewChat: () => set((state) => ({ newChatSignal: state.newChatSignal + 1 })),

  // 读库失败已在实现层收敛成空数组，这里不再兜：侧栏渲染不能因为一次读失败而崩
  refreshSessions: async () => {
    const storage = getHistoryStorage();
    set({ historySupported: storage.supported });
    const sessions = await storage.listSessions();
    set({ sessions });
  },

  openSession: (id) =>
    set((state) => ({
      pendingSessionId: id,
      openSessionSignal: state.openSessionSignal + 1,
    })),

  requestNewChat: () =>
    set((state) => ({
      // 先切断归属：随后的落盘读到 null 即不会重建待弃的会话
      currentSessionId: null,
      pendingSessionId: null,
      openSessionSignal: state.openSessionSignal + 1,
    })),

  clearPendingSession: () => set({ pendingSessionId: null }),

  setCurrentSessionId: (id) => set({ currentSessionId: id }),

  removeSession: async (id) => {
    const { currentSessionId, openSessionSignal } = get();
    if (currentSessionId === id) {
      set({ currentSessionId: null, pendingSessionId: null, openSessionSignal: openSessionSignal + 1 });
    }
    await getHistoryStorage().deleteSession(id);
    await get().refreshSessions();
  },

  renameSession: async (id, title) => {
    // 规整在写库前做一次：空标题、纯空白一律拒绝，不产生"无标题会话"
    const normalized = normalizeTitle(title);
    if (!normalized) return false;
    if (get().sessions.find((item) => item.id === id)?.title === normalized) return false;
    const ok = await getHistoryStorage().renameSession(id, normalized);
    if (!ok) return false;
    // 先广播再刷新列表：当前会话的内存 meta 要跟着改，否则下一次落盘会用旧标题覆盖
    set((state) => ({
      renamedSession: { id, title: normalized },
      renameSignal: state.renameSignal + 1,
    }));
    await get().refreshSessions();
    return true;
  },
}));

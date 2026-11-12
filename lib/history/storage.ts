/**
 * 会话历史存储的进程内单例工厂（doc/chat-history.md §2.5、§4）。
 *
 * 为什么需要单例：IDB 的 open() 有连接成本，且 meta / records / blobs 三张表必须在
 * 同一个 database 连接上操作。store、hooks、设置页三处都会取存储，各建一个实例会
 * 各自持有一条连接、各自跑一遍版本升级，既浪费也可能撞上 blocked 事件。
 *
 * 降级口径（§4）：IDB 不可用（隐私模式 / 禁用站点数据 / SSR）时返回空实现，
 * 其 supported === false —— 消费方据此提示「本次对话不会留存」，会话本体由
 * hooks/useChat 的内存态照常承担，聊天功能不受影响。
 */
import {
  createIndexedDbHistoryStorage,
  isIndexedDbAvailable,
  requestPersistentStorage,
} from './indexeddb.ts';
import { createNoopHistoryStorage } from './memory.ts';
import type { HistoryStorage } from './types.ts';

let cached: HistoryStorage | null = null;
let persistRequested = false;

/** 取存储实例（首次调用时探测环境并缓存） */
export function getHistoryStorage(): HistoryStorage {
  if (!cached) {
    cached = isIndexedDbAvailable() ? createIndexedDbHistoryStorage() : createNoopHistoryStorage();
  }
  return cached;
}

/**
 * 环境是否支持本地保存。
 *
 * 注意：SSR 阶段这里恒为 false（无 indexedDB），因此**不要在 render 期间调用**并据此
 * 分支渲染，否则客户端首帧与 SSR 输出不一致会触发 hydration 警告。请在 mount 后的
 * effect 里取，或读 store 里由 effect 写入的 historySupported。
 */
export function isHistorySupported(): boolean {
  return getHistoryStorage().supported;
}

/**
 * 申请持久化存储（§3.3）：首次写入成功后调用一次即可。
 * 结果不阻塞任何流程——它只决定浏览器会不会在磁盘紧张时清掉本站数据。
 */
export function ensurePersistentStorage(): void {
  const storage = getHistoryStorage();
  if (persistRequested || !storage.supported) return;
  persistRequested = true;
  void requestPersistentStorage();
}

/** 测试用：清空单例，等价于"重新打开站点" */
export function resetHistoryStorageForTest(): void {
  cached = null;
  persistRequested = false;
}

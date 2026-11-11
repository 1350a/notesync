/**
 * 客户端身份标识（无登录体系下的匿名 user_id 替代，协议见 doc/user-settings.md §4）。
 *
 * 服务端需要区分请求来源（少量并发下的日志追溯、将来按客户端配额），
 * 用浏览器内自生成 UUID 充当客户端 ID，随 X-Client-Id 头上行；
 * 服务端仅记录不存储。
 */
export const CLIENT_ID_STORAGE_KEY = 'notesync-client-id';
export const CLIENT_ID_HEADER = 'X-Client-Id';

/** 上游终端用户标识（请求体 user 字段）：与客户端 ID 是两回事，见 doc/user-settings.md §4.1 */
export const USER_ID_STORAGE_KEY = 'notesync-user-id';

/** 生成 UUID v4：非 secure context（如局域网 http 访问）没有 crypto.randomUUID，用 getRandomValues 手工拼接 */
function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

/**
 * 读取或首次生成客户端 ID；SSR 环境返回空串（调用方据此跳过该请求头）。
 * 隐私模式下 localStorage 可能不可用：退化为每次调用随机 ID（仅本次会话内可追溯）。
 */
export function getClientId(): string {
  if (typeof window === 'undefined') return '';
  try {
    const existing = window.localStorage.getItem(CLIENT_ID_STORAGE_KEY);
    if (existing) return existing;
    const generated = generateId();
    window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, generated);
    return generated;
  } catch (err) {
    console.warn('[client-id] 客户端标识读写失败，本次使用临时 ID', err);
    return generateId();
  }
}

/**
 * 读取或首次生成上游终端用户标识（doc/user-settings.md §4.1）。
 * 纯随机 UUID，绝不含任何可识别信息——该值会到达上游厂商侧。
 */
export function getUserId(): string {
  if (typeof window === 'undefined') return '';
  try {
    const existing = window.localStorage.getItem(USER_ID_STORAGE_KEY);
    if (existing) return existing;
    const generated = generateId();
    window.localStorage.setItem(USER_ID_STORAGE_KEY, generated);
    return generated;
  } catch (err) {
    console.warn('[client-id] 用户标识读写失败，本次使用临时 ID', err);
    return generateId();
  }
}

/** 重置用户标识（设置页入口，合规可撤销要求）；返回新值便于 UI 确认 */
export function resetUserId(): string {
  if (typeof window === 'undefined') return '';
  const generated = generateId();
  try {
    window.localStorage.setItem(USER_ID_STORAGE_KEY, generated);
  } catch (err) {
    console.warn('[client-id] 用户标识重置失败，本次使用临时 ID', err);
  }
  return generated;
}

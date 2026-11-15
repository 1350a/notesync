/**
 * 适配器工厂
 */
import type { ToolMode } from '../types.ts';
import { NativeAdapter } from './native.ts';
import { TextAdapter } from './text.ts';
import type { ToolAdapter } from './types.ts';

const nativeAdapter = new NativeAdapter();
const textAdapter = new TextAdapter();

export function createAdapter(mode: ToolMode): ToolAdapter {
  return mode === 'native' ? nativeAdapter : textAdapter;
}

export type { ToolAdapter };

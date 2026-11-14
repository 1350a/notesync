'use client';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import type { ChatMsg } from '@/lib/chat/messages';
import { stripAbortedSuffix } from '@/lib/chat/messages';
import { rehypeSanitizeMarkdown } from '@/lib/markdown/sanitize';
import type { DiagnoseRequestEvent } from '@/lib/diagnose/types';
import DiagnosisCard from './DiagnosisCard';
import MessageActions, { MessageEditor } from './MessageActions';
import ToolTrace from './ToolTrace';

/**
 * 「已中止」徽标：细分隔线 + 停止图标 + 灰字（doc/chat-history.md §8.3）。
 * 取代旧版拼在正文里的斜体行——正文数据不变（后缀仍唯一由 useChat 写入），
 * 渲染层剥离后转徽标，旧库遗留的斜体后缀同样命中。
 */
function AbortedMark() {
  return (
    <div className="mt-0.5 flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
      <span className="h-px w-6" style={{ backgroundColor: 'var(--border)' }} aria-hidden />
      <span className="inline-flex items-center gap-1.5 text-[11px]">
        <svg className="h-3 w-3" viewBox="0 0 24 24" aria-hidden>
          <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
        </svg>
        已中止
      </span>
    </div>
  );
}

/** 思考过程预览字数：展开后先只看开头，避免大段推理性内容一次铺满屏幕 */
const THINKING_PREVIEW_CHARS = 400;

/**
 * OCR 徽章文案按发送时刻记录的引擎分流（doc/browser-local-ocr.md §6.2）：
 * 云端引擎下「原图未离开浏览器」不成立，绝不允许出现；无引擎字段的旧消息
 * 中性兜底，不猜引擎（历史数据无从判定，宁可少说不可说错）
 */
function ocrBadgeCopy(engine: ChatMsg['ocrEngine']): { label: string; title: string } {
  if (engine === 'cloud') {
    return {
      label: '云端转文字',
      title: '图片已上传至云端 OCR 转写后发送（图片像素已外发）：',
    };
  }
  if (engine === 'local') {
    return {
      label: '本地转文字',
      title: '图片已在浏览器内 OCR 转文字后发送，原图未离开浏览器：',
    };
  }
  return { label: 'OCR转文字', title: '图片已经 OCR 转文字后发送：' };
}

/**
 * 思考过程三级展示（批 3-B）：
 * ① 默认折叠，只有「思考过程」一行；
 * ② 展开后先显示前 {@link THINKING_PREVIEW_CHARS} 字 + 省略号 + 「共 N 字」；
 * ③ 超过预览字数时再给「展开完整推理」，点过才显示全文。
 * 折叠时重置全文态，下次展开仍从预览进入，不留下「一次点开永远全展开」的跳级。
 */
function ThinkingBlock({ reasoning }: { reasoning: string }) {
  const [open, setOpen] = useState(false);
  const [fullyOpen, setFullyOpen] = useState(false);
  const total = reasoning.length;
  const collapsible = total > THINKING_PREVIEW_CHARS;

  const toggleOpen = () => {
    if (open) {
      setFullyOpen(false);
      setOpen(false);
      return;
    }
    setOpen(true);
  };

  const collapsed = collapsible && !fullyOpen;
  const shown = collapsed ? reasoning.slice(0, THINKING_PREVIEW_CHARS) : reasoning;

  return (
    <div
      className="mb-2 rounded-xl px-3 py-2"
      style={{ border: '1px solid var(--border)', backgroundColor: 'var(--panel-soft)' }}
    >
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={open}
        className="text-xs font-medium outline-none"
        style={{ color: 'var(--text-muted)' }}
      >
        {open ? '▾' : '▸'} 思考过程
        {collapsible && !open ? `（共 ${total} 字）` : null}
      </button>
      {open && (
        <>
          <pre
            className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed"
            style={{ color: 'var(--text-secondary)' }}
          >
            {shown}
            {collapsed ? '…' : ''}
          </pre>
          {collapsible && (
            <div className="mt-1 flex items-center gap-2">
              {collapsed && (
                <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  共 {total} 字，已显示前 {THINKING_PREVIEW_CHARS} 字
                </span>
              )}
              <button
                type="button"
                onClick={() => setFullyOpen((v) => !v)}
                className="text-[11px] font-medium outline-none"
                style={{ color: 'var(--text-muted)' }}
              >
                {fullyOpen ? '收起完整推理' : '展开完整推理'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function ChatList({
  messages,
  loading,
  onDiagnoseAction,
  onRegenerate,
  onEditResend,
}: {
  messages: ChatMsg[];
  loading: boolean;
  /** 掌握度回路回调（明白了/还不懂/继续），由页面层接 useChat；缺省不渲染回路按钮 */
  onDiagnoseAction?: (event: DiagnoseRequestEvent, label: string) => void;
  /** 重新生成最后一条回答 */
  onRegenerate?: () => void;
  /** 编辑某条 user 消息并重发 */
  onEditResend?: (index: number, text: string) => void;
}) {
  // 就地编辑的目标下标：null = 不在编辑态。只允许一条同时编辑，切走即放弃草稿
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  // 滚动跟随收口在页面层（app/chat/page.tsx）：用户操作优先的条件式吸底（doc/mobile-ux.md §3）
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 pb-4">
      {messages.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
          <span className="text-4xl">💬</span>
          <h2 className="text-lg font-medium" style={{ color: 'var(--text-secondary)' }}>
            开始对话
          </h2>
          <p className="max-w-md text-sm" style={{ color: 'var(--text-muted)' }}>
            输入问题并发送，模型回复会显示在这里。
          </p>
        </div>
      )}

      {messages.map((m, i) => {
        // 中止标记在渲染入口剥一次：正文渲染、复制源共用同一口径（doc/chat-history.md §8.3）；
        // user 消息不会有中止后缀（abort 分支只写最后一条 assistant）
        const isUser = m.role === 'user';
        const { text: renderContent, aborted } = isUser
          ? { text: m.content, aborted: false }
          : stripAbortedSuffix(m.content);
        const ocrBadge = m.ocrTexts && m.ocrTexts.length > 0 ? ocrBadgeCopy(m.ocrEngine) : null;
        return (
          <div
            key={i}
            // 无边框扁平排版：user 只留一块语义主色填充，assistant 完全去壳（无底、无框、无阴影），
            // 正文直接贴齐内容列左缘；圆角收小到 8px 一类，避免"悬浮卡片"观感。
            // 外层 wrapper 承载 group/对齐/宽度，气泡只是其中一块：操作条得以放在气泡外（§8.3）
            className={
              isUser
                ? 'group flex flex-col items-end gap-1 self-end'
                : 'group flex w-full flex-col items-start gap-1 self-start text-sm'
            }
            style={isUser ? { maxWidth: '85%' } : undefined}
          >
            <div
              className={
                isUser
                  ? 'max-w-full rounded-lg rounded-br-sm px-3.5 py-2.5 text-sm'
                  : 'w-full text-sm'
              }
              style={
                isUser
                  ? {
                      backgroundColor: 'var(--primary)',
                      color: 'var(--primary-foreground)',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }
                  : {
                      backgroundColor: 'transparent',
                      color: 'var(--text)',
                      wordBreak: 'break-word',
                    }
              }
            >
              {m.role === 'assistant' && m.reasoning ? <ThinkingBlock reasoning={m.reasoning} /> : null}
              {m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0 ? (
                <ToolTrace calls={m.toolCalls} />
              ) : null}

              {m.role === 'assistant' ? (
                // ask_user 待回答的问题由输入区问题面板（AskUserPanel）承载，不再渲染气泡卡片；
                // 正文只渲染模型前导文本，前导为空时不渲染空泡
                m.awaitingQuestions && !renderContent ? null : (
                  <>
                    {renderContent ? (
                      <div className="markdown-body text-sm">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm, remarkMath]}
                          rehypePlugins={[rehypeRaw, rehypeSanitizeMarkdown, rehypeKatex]}
                        >
                          {renderContent}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      // 无正文且未中止时才给占位号：中止后空正文只摆徽标，不再摆 "…"
                      !aborted && (
                        <div className="markdown-body text-sm">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm, remarkMath]}
                            rehypePlugins={[rehypeRaw, rehypeSanitizeMarkdown, rehypeKatex]}
                          >
                            …
                          </ReactMarkdown>
                        </div>
                      )
                    )}
                    {aborted && <AbortedMark />}
                    {m.diagnosis ? <DiagnosisCard result={m.diagnosis} onAction={onDiagnoseAction} /> : null}
                  </>
                )
              ) : (
                <>
                  {m.files && m.files.length > 0 ? (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {m.files.map((file, idx) => (
                        <span
                          key={`file-${idx}`}
                          className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px]"
                          style={{
                            border: '1px solid var(--border)',
                            backgroundColor: 'var(--bg-deep)',
                            color: 'var(--text-secondary)',
                          }}
                          title={`${file.name}（${file.text.length} 字符）`}
                        >
                          <span className="max-w-[160px] truncate">{file.name}</span>
                          <span style={{ color: 'var(--text-muted)' }}>
                            {file.text.length >= 1000
                              ? `${(file.text.length / 1000).toFixed(1)}k`
                              : file.text.length}
                            字符
                          </span>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {m.images && m.images.length > 0 ? (
                    <div className="mb-2 flex flex-wrap gap-2">
                      {m.images.map((src, idx) => {
                        // 存库时被配额淘汰的槽位是空串：命中过期登记就摆占位，
                        // 未登记则整槽不渲染（避免历史会话里出现莫名其妙的灰块）
                        if (!src) {
                          if (!m.expiredImages?.includes(idx)) return null;
                          return (
                            <div
                              key={`img-${idx}`}
                              className="flex h-24 w-24 items-center justify-center rounded-lg text-[11px]"
                              style={{
                                border: '1px dashed var(--border)',
                                backgroundColor: 'var(--bg-deep)',
                                color: 'var(--text-muted)',
                              }}
                              title="附件超出本地存储预算已被清理，仅保留占位"
                            >
                              图片已过期
                            </div>
                          );
                        }
                        return (
                          // 消息里的图片是上传时读出的 data URL，next/image 优化器无法处理内联 src；
                          // 气泡内缩略图固定 96px，走优化器无收益且会多一次 /_next/image 代理
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={`img-${idx}`}
                            src={src}
                            alt={`上传图片 ${idx + 1}`}
                            className="h-24 w-24 rounded-lg object-cover"
                            style={{ border: '1px solid var(--border)' }}
                          />
                        );
                      })}
                    </div>
                  ) : null}
                  {ocrBadge ? (
                    <div className="mb-2">
                      <span
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px]"
                        style={{
                          border: '1px solid var(--border)',
                          backgroundColor: 'var(--bg-deep)',
                          color: 'var(--text-secondary)',
                        }}
                        title={`${ocrBadge.title}\n${m.ocrTexts?.join('\n---\n')}`}
                      >
                        🖼️→📄 {ocrBadge.label}（{m.ocrTexts?.length} 张）
                      </span>
                    </div>
                  ) : null}
                  {editingIndex === i ? (
                    <MessageEditor
                      initial={m.content}
                      onCancel={() => setEditingIndex(null)}
                      onSubmit={(text) => {
                        setEditingIndex(null);
                        onEditResend?.(i, text);
                      }}
                    />
                  ) : m.content ? (
                    <div>{m.content}</div>
                  ) : null}
                </>
              )}
            </div>

            {/* 操作条：气泡外、正文下方一行图标（doc/chat-history.md §8.3）。生成中整条隐藏 */}
            {editingIndex !== i && !loading ? (
              <MessageActions
                role={m.role}
                canRegenerate={m.role === 'assistant' && i === messages.length - 1 && Boolean(onRegenerate)}
                disabled={loading}
                copyText={(isUser ? m.content : renderContent) || undefined}
                onEdit={isUser && onEditResend ? () => setEditingIndex(i) : undefined}
                onRegenerate={onRegenerate}
              />
            ) : null}
          </div>
        );
      })}

      {loading && (
        <div className="flex justify-start">
          {/* 与消息同一套扁平口径：加载态去掉边框与卡片底色，只留脉动点 + 文案 */}
          <div
            className="flex items-center gap-2 py-1 text-sm"
            style={{ color: 'var(--text-secondary)' }}
          >
            <span
              className="inline-block h-2 w-2 animate-pulse rounded-full"
              style={{ backgroundColor: 'var(--primary)' }}
            />
            <span
              className="inline-block h-2 w-2 animate-pulse rounded-full"
              style={{ backgroundColor: 'var(--primary)' }}
            />
            <span className="ml-1">模型思考中…</span>
          </div>
        </div>
      )}
    </div>
  );
}

import { AI_GENERATED_NOTICE } from '@/lib/ui/notices';

/**
 * 聊天输入区下方的常驻 AI 生成提示（单行小字）。
 *
 * 纯展示组件：不引入 state、不发请求、不读 store，任何页面都能直接摆。
 * 视觉约束：
 * - 次要文本色（text-muted-foreground，带透明度弱化），不新增颜色变量；
 * - text-[10px] + leading-tight + 负外边距，贴着输入框底部，不撑开布局；
 * - 文案约 22 字，320px 窄屏下单行仍可容纳（10px × 22 ≈ 220px），不换行不溢出。
 */
export default function AiGeneratedNotice() {
  return (
    <p className="-mt-1 select-none px-2 text-center text-[10px] leading-tight text-muted-foreground/80">
      {AI_GENERATED_NOTICE}
    </p>
  );
}

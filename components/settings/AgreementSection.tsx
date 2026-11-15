'use client';

const ITEMS = [
  '本项目不设账号系统，不收集任何个人信息；用户设置仅保存在本浏览器。',
  '模型 API Key 仅保存在服务端环境变量（.env.local），不会下发到浏览器。',
  '对话内容由你所配置的模型服务提供商处理，受其服务条款与隐私政策约束。',
  '可在「数据管理」中随时清除本浏览器内的全部本地数据。',
];

export default function AgreementSection() {
  return (
    <ul className="list-disc space-y-2 py-2 pl-5 text-sm leading-relaxed text-muted-foreground">
      {ITEMS.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

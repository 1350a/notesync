import LocalTestPanel from './_components/local-test-panel';

export default function LocalPage() {
  return (
    <div className="px-4 py-6 md:p-8 max-w-4xl mx-auto w-full">
      <div className="text-center mb-6 md:mb-10 mt-4">
        <h1 className="text-3xl font-bold mb-2">本地推理能力页</h1>
        <p className="text-muted-foreground">
          嵌入与检索完全在浏览器内完成，语料与查询向量均不上传服务器
        </p>
      </div>
      <LocalTestPanel />
    </div>
  );
}

NoteSync 错题认知诊断引擎 v{{VERSION}} — standalone 发布产物
====================================================

运行要求：Node.js ≥ 22.6（无需 npm install，依赖已随包携带）

启动：
  1. 把本包自带的 .env.example 复制一份改名为 .env 并填入 API key
     （或直接用系统环境变量配置）；不配 key 不影响服务本身启动，
     对应能力（云端对话/OCR/TTS）按协议降级。
  2. Windows 双击 start.bat；macOS / Linux 终端执行 sh start.sh
     （等价手动命令：node server.js，PORT=8080 可改端口）
  3. .env参数详见 https://github.com/1350a/notesync/blob/main/doc/help-about-.env.md

本产物为跨平台构建（纯 JS + WebAssembly，无原生二进制），
Windows / Linux / macOS 均可运行。

本变体（full）：包含完整 public/models（浏览器端本地推理模型），
本地 OCR、本地推理、PDF 解析均离线开箱即用。

安全说明：产物不含任何密钥与环境变量文件（.env 已剔除）。

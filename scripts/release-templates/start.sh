#!/bin/sh
# NoteSync v{{VERSION}} 一键启动（macOS / Linux / Git Bash）
cd "$(dirname "$0")" || exit 1

# 检查一：直接在压缩包预览里运行时，同级文件并不存在
if [ ! -f server.js ]; then
    echo "必须需要解压后运行"
    exit 1
fi

# 检查二：Node.js 存在性与版本（需 >= 22.6）
if ! command -v node >/dev/null 2>&1; then
    echo "未检测到 Node.js，请先安装 22.6 或以上版本：https://nodejs.org/"
    exit 1
fi
NODEV=$(node -v | sed 's/^v//')
MAJOR=$(printf '%s' "$NODEV" | cut -d. -f1)
MINOR=$(printf '%s' "$NODEV" | cut -d. -f2)
MINOR=${MINOR:-0}
if [ "$MAJOR" -lt 22 ] || { [ "$MAJOR" -eq 22 ] && [ "$MINOR" -lt 6 ]; }; then
    echo "Node.js 版本过低（检测到 v$NODEV），需要 22.6 或以上：https://nodejs.org/"
    exit 1
fi

echo "Node v$NODEV，启动服务（Ctrl+C 停止，浏览器访问 http://127.0.0.1:3000，PORT 环境变量可改端口）..."
exec node server.js

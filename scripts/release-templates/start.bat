@echo off
rem NoteSync v{{VERSION}} 一键启动（Windows；本文件为 UTF-8 无 BOM + chcp 65001）
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"

rem 检查一：直接在压缩包预览里运行时，同级文件并不存在
if not exist "%~dp0server.js" (
    echo 必须需要解压后运行
    pause
    exit /b 1
)

rem 检查二：Node.js 存在性与版本（需 >= 22.6）
set "NODEV="
for /f "delims=" %%v in ('node -v 2^>nul') do set "NODEV=%%v"
if not defined NODEV (
    echo 未检测到 Node.js，请先安装 22.6 或以上版本：https://nodejs.org/
    pause
    exit /b 1
)
set "NODEV=%NODEV:v=%"
for /f "tokens=1,2 delims=." %%a in ("%NODEV%") do set "MAJOR=%%a" & set "MINOR=%%b"
if not defined MINOR set "MINOR=0"
if %MAJOR% LSS 22 goto version_bad
if %MAJOR% EQU 22 if %MINOR% LSS 6 goto version_bad
goto version_ok

:version_bad
echo Node.js 版本过低（检测到 v%NODEV%），需要 22.6 或以上：https://nodejs.org/
pause
exit /b 1

:version_ok
echo Node v%NODEV%，启动服务（Ctrl+C 停止，浏览器访问 http://127.0.0.1:3000，PORT 环境变量可改端口）...
call node server.js
pause

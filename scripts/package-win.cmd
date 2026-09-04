@echo off
REM ============================================================================
REM  疾风引擎 (gale-engine) Windows NSIS 安装包一键构建脚本
REM ============================================================================
REM  适用场景：GitHub 直连不可达 / 内网 / 国内网络环境。
REM
REM  背景：electron-builder 的 app-builder.exe (Go 二进制) 在下载 winCodeSign /
REM        nsis / nsis-resources 三个构建依赖时，默认硬编码走 GitHub。在 GitHub
REM        数据被封的沙箱或国内网络下会卡在 EOF。
REM
REM  解决：electron-builder 的 Go 二进制【确实会读取】环境变量
REM        ELECTRON_BUILDER_BINARIES_MIRROR（注意必须带结尾斜杠）。npmmirror 提供
REM        与 GitHub 同构的嵌套路径：
REM          {MIRROR}{name}-{ver}/{name}-{ver}.7z
REM        故本脚本将镜像指向 npmmirror，绕过 GitHub 下载阻塞。
REM
REM  依赖：node_modules 中需包含 7zip-bin（提供 7za.exe，app-builder 解压 .7z 时
REM        通过 PATH 查找）。若 node_modules 被清空，先 `npm install`。
REM ============================================================================

setlocal

REM 1) 让 app-builder 能找到 7za.exe 解压 .7z
set "PATH=%CD%\node_modules\7zip-bin\win\x64;%PATH%"

REM 2) 关键：镜像地址，必须带结尾斜杠，否则 host 与路径会被错误拼接
set "ELECTRON_BUILDER_BINARIES_MIRROR=https://cdn.npmmirror.com/binaries/electron-builder-binaries/"

REM 3) 关闭 WorkBuddy 安全删除拦截，允许 Vite 清空 out/ 目录
set "CODEBUDDY_SAFE_DELETE_ENABLED=0"

REM 4) 若本机有本地镜像服务，可改用：set "ELECTRON_BUILDER_BINARIES_MIRROR=http://127.0.0.1:8731/"
REM    （注意结尾斜杠，且服务需提供嵌套目录 {name}-{ver}/{name}-{ver}.7z）

call npm run package

endlocal

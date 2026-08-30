<#
  publish-release.ps1 — 本地手动发布安装包到 GitHub Releases
  ============================================================
  适用场景：CI 不可用、或想在当前机器直接发布已打好的 tag。
  前置条件：
    1. 已 `git remote add origin <你的GitHub仓库>` 并 `git push --tags`
    2. 已 `gh auth login`（拥有该仓库的写权限）
    3. 已 `git tag vX.Y.Z` 且版本与 package.json 一致

  用法：
    pwsh scripts/publish-release.ps1                 # 默认发布 package.json 当前版本
    pwsh scripts/publish-release.ps1 -Exe "release\疾风引擎-0.1.0-setup.exe"
#>

param(
  [string]$Exe = ""
)

$ErrorActionPreference = 'Stop'

# 读取 package.json 中的版本
$version = (node -p "require('./package.json').version")
if (-not $version) { throw "无法从 package.json 读取 version" }
$tag = "v$version"

# 若未指定安装包路径，按约定文件名拼出
if (-not $Exe) {
  $Exe = "release/疾风引擎-$version-setup.exe"
}

# 安装包不存在则先构建（使用国内镜像，避免 GitHub 拉取失败）
if (-not (Test-Path $Exe)) {
  Write-Host "[publish] 安装包不存在，先执行 npm run package 构建..."
  $env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://cdn.npmmirror.com/binaries/electron-builder-binaries/"
  cmd /c "npm run package"
  if (-not (Test-Path $Exe)) { throw "构建后仍找不到安装包：$Exe" }
}

# 创建 Release 并上传资产
Write-Host "[publish] 创建 Release $tag 并上传 $Exe ..."
gh release create $tag $Exe --title "疾风引擎 $version" --notes "疾风引擎 $version Windows 安装包（NSIS）。双击 setup.exe 按向导安装即可。"

Write-Host "[publish] 完成：$tag -> $Exe"
Write-Host "[publish] 下载地址：https://github.com/$(gh repo view --json nameWithOwner -q .nameWithOwner)/releases/tag/$tag"

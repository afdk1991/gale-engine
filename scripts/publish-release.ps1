<#
  publish-release.ps1 — 本地手动发布安装包到 GitHub Releases
  ============================================================
  适用场景：CI 不可用、或想在当前机器直接发布已打好的 tag。

  前置条件：
    1. 已 `git remote add origin <你的GitHub仓库>` 并 `git push --tags`
    2. 已 `gh auth login`（拥有该仓库的写权限）
    3. 已 `git tag vX.Y.Z` 且版本与 package.json 一致

  用法：
    pwsh scripts/publish-release.ps1 -DryRun              # 预演：只检查资产与说明，不发布
    pwsh scripts/publish-release.ps1                     # 发布 package.json 当前版本（x64）
    pwsh scripts/publish-release.ps1 -Arch arm64         # 指定架构
    pwsh scripts/publish-release.ps1 -Exe "release\gale-engine-0.1.9-x64-setup.exe"

  ★ 为什么必须一起上传 latest.yml / .blockmap：
    electron-updater 靠 Release 里的 `latest.yml` 判断「有没有新版本」并获取下载地址。
    若只上传 exe，应用内「设置 → 检查更新」将永远看不到该版本 —— 自动更新静默失效。
    `.blockmap` 用于差分下载（只下载变化部分），缺失只会退化为全量下载。
    本脚本会自动带上这三者，并在缺失时明确告警。
#>

param(
  [string]$Exe = "",
  [string]$Arch = "",
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

# ── 1. 版本与 tag ────────────────────────────────────────────────
$version = (node -p "require('./package.json').version")
if (-not $version) { throw "无法从 package.json 读取 version" }
$tag = "v$version"

if (-not $Arch) { $Arch = if ($env:BUILD_ARCH) { $env:BUILD_ARCH } else { 'x64' } }

# ── 2. 定位安装包（不存在则先构建）─────────────────────────────
function Find-Installer([string]$ver) {
  $exact = "release/gale-engine-$ver-$Arch-setup.exe"
  if (Test-Path $exact) { return (Resolve-Path $exact).Path }
  # 兜底：按版本号匹配目录内任意 arch 产物
  $c = Get-ChildItem -Path "release" -Filter "gale-engine-$ver-*-setup.exe" -ErrorAction SilentlyContinue |
       Select-Object -First 1
  if ($c) { return $c.FullName }
  return $null
}

if ($Exe) {
  if (-not (Test-Path $Exe)) { throw "指定的安装包不存在：$Exe" }
  $Exe = (Resolve-Path $Exe).Path
} else {
  $Exe = Find-Installer $version
  if (-not $Exe -and -not $DryRun) {
    Write-Host "[publish] 安装包不存在，先执行 npm run package 构建..."
    $env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://cdn.npmmirror.com/binaries/electron-builder-binaries/"
    cmd /c "npm run package"
    $Exe = Find-Installer $version
  }
  if (-not $Exe) { throw "找不到安装包（release/gale-engine-$version-*-setup.exe）" }
}

# ── 3. 收集必须同属一个 Release 的资产 ──────────────────────────
$assets = @($Exe)

$latestYml = Join-Path (Split-Path $Exe -Parent) 'latest.yml'
if (Test-Path $latestYml) {
  $assets += (Resolve-Path $latestYml).Path
} else {
  Write-Warning "[publish] 未找到 latest.yml —— 自动更新将失效！请确认 electron-builder.yml 配有 publish 段，且 release/ 未被中间步骤清理。"
}

$blockmap = "$Exe.blockmap"
if (Test-Path $blockmap) {
  $assets += (Resolve-Path $blockmap).Path
} else {
  Write-Warning "[publish] 未找到 $(Split-Path $Exe -Leaf).blockmap —— 差分更新不可用（不影响全量下载）。"
}

# ── 4. 生成发版说明（CHANGELOG 对应版本章节 + 下载表）────────────
$extractor = "scripts/extract-changelog.py"
$notesFile = Join-Path $env:TEMP "gale-release-notes-$version.md"
$assetListFile = Join-Path $env:TEMP "gale-assets-$version.txt"

$py = $null
foreach ($c in @('python', 'python3')) {
  $cmd = Get-Command $c -ErrorAction SilentlyContinue
  if ($cmd) { $py = $cmd.Source; break }
}

if ($py -and (Test-Path $extractor)) {
  Write-Host "[publish] 从 CHANGELOG 生成发版说明..."
  # 无 BOM 写出，避免 python 侧把 BOM 当成首个文件名字符
  $assetNames = $assets | ForEach-Object { Split-Path $_ -Leaf }
  [System.IO.File]::WriteAllLines($assetListFile, $assetNames, (New-Object System.Text.UTF8Encoding($false)))

  # 用 --out 让 python 直接落盘：不经过控制台管道，规避代码页导致的中文乱码
  & $py $extractor --tag $tag --changelog CHANGELOG.md `
      --assets-file $assetListFile --mode release --out $notesFile
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $notesFile)) {
    Write-Warning "[publish] 发版说明生成失败，回退为简单说明。"
    $notesFile = $null
  }
} else {
  Write-Warning "[publish] 未找到 python 或 $extractor，回退为简单说明。"
  $notesFile = $null
}

if (-not $notesFile) {
  $notesFile = Join-Path $env:TEMP "gale-release-notes-$version.md"
  [System.IO.File]::WriteAllText(
    $notesFile,
    "疾风引擎 $version Windows 安装包（NSIS）。双击 setup.exe 按向导安装即可。",
    (New-Object System.Text.UTF8Encoding($false)))
}

# ── 5. 预演模式：到此为止，绝不写远端 ───────────────────────────
if ($DryRun) {
  Write-Host ""
  Write-Host "[dry-run] 版本        : $version   (tag $tag)"
  Write-Host "[dry-run] 架构        : $Arch"
  Write-Host "[dry-run] 安装包      : $Exe"
  Write-Host "[dry-run] 待上传资产  :"
  $assets | ForEach-Object {
    $fi = Get-Item $_
    Write-Host ("  - {0}  ({1:N1} MB)" -f $fi.Name, ($fi.Length / 1MB))
  }
  Write-Host "[dry-run] 发版说明    : $notesFile"
  Write-Host ""
  Write-Host "[dry-run] 说明内容预览（前 20 行）："
  Get-Content $notesFile -TotalCount 20 -Encoding UTF8 | ForEach-Object { Write-Host "  $_" }
  Write-Host ""
  $hasYml = ($assets | Where-Object { $_ -like '*latest.yml' }).Count -gt 0
  if ($hasYml) {
    Write-Host "[dry-run] 结论：latest.yml 已在待上传列表内，自动更新链路完整 ✅"
  } else {
    Write-Host "[dry-run] 结论：缺少 latest.yml，自动更新会失效 ❌"
  }
  Write-Host "[dry-run] 未执行任何远端写操作。去掉 -DryRun 即真正发布。"
  exit 0
}

# ── 6. 创建或更新 Release ───────────────────────────────────────
$repo = (gh repo view --json nameWithOwner -q .nameWithOwner)

$existing = ""
try { $existing = (gh release view $tag --json tagName -q .tagName 2>$null) } catch { $existing = "" }

if ($existing) {
  Write-Host "[publish] Release $tag 已存在，覆盖资产并更新说明..."
  gh release upload $tag @assets --clobber
  if ($LASTEXITCODE -ne 0) { throw "gh release upload 失败（exit $LASTEXITCODE）" }
  gh release edit $tag --notes-file $notesFile
  if ($LASTEXITCODE -ne 0) { throw "gh release edit 失败（exit $LASTEXITCODE）" }
} else {
  Write-Host "[publish] 创建 Release $tag 并上传 $($assets.Count) 个文件..."
  gh release create $tag @assets --title "疾风引擎 $version" --notes-file $notesFile
  if ($LASTEXITCODE -ne 0) { throw "gh release create 失败（exit $LASTEXITCODE）" }
}

# ── 7. 结果 ─────────────────────────────────────────────────────
Write-Host ""
Write-Host "[publish] 完成：$tag"
Write-Host "[publish] 已上传资产："
$assets | ForEach-Object { Write-Host "  - $(Split-Path $_ -Leaf)" }
Write-Host "[publish] 发版说明：$notesFile"
Write-Host "[publish] 下载地址：https://github.com/$repo/releases/tag/$tag"
Write-Host "[publish] 提醒：发布后请复查 Latest 归属（gh release list），确认不是被旧版本抢走。"

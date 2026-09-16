#!/usr/bin/env python3
"""从 CHANGELOG.md 抽取指定版本的章节，生成 GitHub Release 发版说明。

背景：release.yml 原用 softprops/action-gh-release 的 generate_release_notes，
仓库无 PR 时只会生成一行 "Full Changelog" 链接，导致 Release body 为空。
electron-updater 会把 Release body 作为 releaseNotes 展示在更新弹窗里，
因此每次发版必须有实质说明。

用法：
    python scripts/extract-changelog.py --tag v0.1.9 --changelog CHANGELOG.md \
        [--dist dist] [--assets-file assets.txt] [--mode release|backfill] \
        [--repo OWNER/REPO]

产物输出到 stdout，供 action-gh-release 的 body_path 使用。

--dist DIR          扫描该目录下的安装包，自动生成下载表
--assets-file FILE  从文件读取资产名（每行一个）生成下载表，用于本地回填
--mode release      常规发版（默认）
--mode backfill     历史补发：额外附「代码来源说明」
"""

from __future__ import annotations

import argparse
import os
import re
import sys

# 标题形如：## v0.1.9 — 2026-09-16（...）
#          ## v0.1.5 / v0.1.4 — 2026-09-06（...）
_H2 = re.compile(r"^##\s+(.*?)\s*$")
# 版本段与日期之间的分隔符可能是 em dash / en dash / 连字符
_SEP = re.compile(r"\s+[\u2014\u2013-]\s+")

INSTALLER_EXTS = (".exe", ".dmg", ".AppImage", ".deb", ".appx", ".msi", ".zip")

_PLATFORM_BY_EXT = {
    ".exe": "Windows",
    ".msi": "Windows",
    ".appx": "Windows",
    ".dmg": "macOS",
    ".AppImage": "Linux",
    ".deb": "Linux",
    ".zip": "通用",
}

# 平台排序权重（下载表按 平台 → 架构 稳定排列）
_PLATFORM_ORDER = {"Windows": 0, "macOS": 1, "Linux": 2, "通用": 3}
_ARCH_ORDER = {"x64": 0, "arm64": 1}


def parse_sections(changelog_text: str) -> list[tuple[str, str]]:
    """把 CHANGELOG 拆成 [(标题, 正文), ...]。"""
    sections: list[tuple[str, str]] = []
    current_title: str | None = None
    buf: list[str] = []

    for line in changelog_text.splitlines():
        m = _H2.match(line)
        if m:
            if current_title is not None:
                sections.append((current_title, "\n".join(buf).strip()))
            current_title = m.group(1).strip()
            buf = []
        elif current_title is not None:
            buf.append(line)

    if current_title is not None:
        sections.append((current_title, "\n".join(buf).strip()))

    return sections


def strip_trailing_rules(text: str) -> str:
    """去掉正文尾部的分隔线（章节间的 `---` 会被一并收进来）。"""
    lines = text.rstrip().splitlines()
    while lines and (not lines[-1].strip() or lines[-1].strip() == "---"):
        lines.pop()
    return "\n".join(lines)


def find_section(sections: list[tuple[str, str]], version: str) -> str | None:
    """按版本号精确匹配章节。

    标题中的版本段可能含多个版本（如 "v0.1.5 / v0.1.4"），
    需按 token 精确比较，避免 v0.1.1 误命中 v0.1.10。
    """
    want = f"v{version}"
    for title, body in sections:
        ver_part = _SEP.split(title, maxsplit=1)[0]
        tokens = [t.strip() for t in ver_part.split("/")]
        if want in tokens:
            return strip_trailing_rules(body)
    return None


def collect_assets(dist_dir: str | None, assets_file: str | None) -> list[str]:
    names: list[str] = []

    if assets_file and os.path.isfile(assets_file):
        # utf-8-sig：容忍 Windows PowerShell 的 `Set-Content -Encoding utf8` 写入的 BOM，
        # 否则首行资产名会带上 \ufeff 而匹配不到扩展名、被静默丢弃。
        with open(assets_file, encoding="utf-8-sig") as fh:
            names.extend(ln.strip().lstrip("\ufeff").strip() for ln in fh if ln.strip())

    if dist_dir and os.path.isdir(dist_dir):
        names.extend(sorted(os.listdir(dist_dir)))

    # 去重保序，仅保留安装包类文件（排除 .blockmap / .yml / .zsync 等更新元数据）
    seen: set[str] = set()
    installers: list[str] = []
    for name in names:
        if name in seen:
            continue
        seen.add(name)
        if name.endswith(INSTALLER_EXTS):
            installers.append(name)
    return installers


def split_asset(name: str) -> tuple[str, str]:
    """gale-engine-0.1.9-x64-setup.exe -> (Windows, x64)"""
    ext = next((e for e in INSTALLER_EXTS if name.endswith(e)), "")
    platform = _PLATFORM_BY_EXT.get(ext, "通用")

    # 去掉扩展名后按 '-' 切分，架构通常紧跟在版本号之后
    stem = name[: -len(ext)] if ext else name
    parts = stem.split("-")
    # 缺省 x64：本项目所有产物要么显式带架构，要么为 x64 默认命名
    # （如补发包的 gale-engine-0.1.3-setup.exe）。
    arch = "x64"
    for token in parts:
        if token in ("x64", "x86_64", "amd64", "arm64", "aarch64", "ia32"):
            arch = {"x86_64": "x64", "amd64": "x64", "aarch64": "arm64"}.get(token, token)
            break
    return platform, arch


def render_download_table(assets: list[str], tag: str, repo: str) -> str:
    if not assets:
        return ""

    rows = []
    for name in assets:
        platform, arch = split_asset(name)
        url = f"https://github.com/{repo}/releases/download/{tag}/{name}"
        rows.append((platform, arch, name, url))

    rows.sort(key=lambda r: (_PLATFORM_ORDER.get(r[0], 9), _ARCH_ORDER.get(r[1], 9), r[2]))

    lines = ["## 下载", "", "| 平台 | 架构 | 文件 |", "| --- | --- | --- |"]
    for platform, arch, name, url in rows:
        lines.append(f"| {platform} | {arch} | [{name}]({url}) |")
    lines.append("")
    return "\n".join(lines)


def build_backfill_note(tag: str) -> str:
    """历史补发版本的代码来源说明。

    事实依据（可用 git 复核）：
      v0.1.0 → 0cd1fa3 (pkg 0.1.0)
      v0.1.1 → 5c3b347 (pkg 0.2.0)
      v0.1.2 → 3ce6b8a (pkg 0.3.0)
      v0.1.3 → 16d4368 (pkg 0.4.0)
      v0.1.4 → 1237027 (pkg 0.5.0)   ← 与 v0.1.5 同一 commit
      v0.1.5 → 1237027 (pkg 0.5.0)
      v0.1.6 → 38a3250 (pkg 0.5.0)
      v0.1.7 → 5f7497a (pkg 0.1.7)   ← 此后才是真实 0.1.x
    """
    return "\n".join(
        [
            "> ### ⚠️ 关于本安装包的代码来源",
            ">",
            f"> 本包由 **当前 `master` 源码**构建，仅将版本号钉定为 `{tag}`。**并非该版本的历史快照。**",
            ">",
            "> 原因：仓库历史上 `v0.1.1`–`v0.1.6` 从未作为真实版本存在——它们实际指向",
            "> `0.2.0`/`0.3.0`/`0.4.0`/`0.5.0` 时期的 commit（`v0.1.4` 与 `v0.1.5` 甚至指向",
            "> 同一个 commit）。若按 tag 构建，分发出去的将是那一时期的旧代码。",
            "> 为不发布历史旧代码，本项目统一改为基于当前真实代码构建。",
            ">",
            "> **因此本包功能与最新版一致**（含磁盘修复、一键优化、DLL 能力库、运行时提权等",
            "> 后续所有模块）。下方版本说明仅记录**该版本号在更新日志中代表的能力增量**，",
            "> 供版本追溯参考。",
            ">",
            "> 👉 **日常使用请下载最新版**，无需特意选择旧版本号。",
            "",
        ]
    )


def main() -> int:
    # Windows runner 上 Python 的 stdout 默认走 locale 编码（如 cp1252），
    # 输出中文会直接 UnicodeEncodeError 导致发版说明生成失败。
    # CI 里本脚本的输出被重定向到文件，必须强制 UTF-8。
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):  # pragma: no cover - 极旧解释器/非标准流
        pass

    parser = argparse.ArgumentParser()
    parser.add_argument("--tag", required=True, help="如 v0.1.9")
    parser.add_argument("--changelog", default="CHANGELOG.md")
    parser.add_argument("--dist", default=None)
    parser.add_argument("--assets-file", default=None)
    parser.add_argument("--mode", choices=("release", "backfill"), default="release")
    parser.add_argument("--repo", default=os.environ.get("GITHUB_REPOSITORY", "afdk1991/gale-engine"))
    parser.add_argument(
        "--out",
        default=None,
        help="写入指定文件（UTF-8 无 BOM）而不是 stdout。"
        "PowerShell 直接调用时建议用它，避免控制台代码页导致的乱码。",
    )
    args = parser.parse_args()

    version = args.tag[1:] if args.tag.startswith("v") else args.tag

    body = ""
    if os.path.isfile(args.changelog):
        with open(args.changelog, encoding="utf-8") as fh:
            body = find_section(parse_sections(fh.read()), version) or ""

    if not body:
        print(
            f"[warn] CHANGELOG 中未找到 v{version} 章节，使用兜底说明",
            file=sys.stderr,
        )
        body = (
            f"本次发布对应版本 `v{version}`，CHANGELOG 中暂无独立章节。\n\n"
            "> 完整版本历史见仓库 [CHANGELOG.md]"
            f"(https://github.com/{args.repo}/blob/master/CHANGELOG.md)。"
        )

    parts = [f"## 疾风引擎 {args.tag}", "", body.strip(), ""]

    if args.mode == "backfill":
        parts += ["---", "", build_backfill_note(args.tag)]

    assets = collect_assets(args.dist, args.assets_file)
    table = render_download_table(assets, args.tag, args.repo)
    if table:
        parts += ["---", "", table]

    parts += [
        "---",
        "",
        "已安装用户可在「设置 → 关于」中检查更新，或直接下载上方安装包覆盖安装。",
        "",
        f"完整版本历史：[CHANGELOG.md](https://github.com/{args.repo}/blob/master/CHANGELOG.md)",
        "",
    ]

    md = "\n".join(parts)

    if args.out:
        # UTF-8 无 BOM：GitHub 会把 BOM 渲染成一个多余字符
        with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(md)
        # 走 stdout 而非 stderr：PowerShell 在 $ErrorActionPreference='Stop' 下
        # 可能把原生命令的 stderr 当作错误处理。消息保持 ASCII 以免代码页问题。
        print(f"[ok] wrote {args.out} ({len(md)} chars)")
    else:
        sys.stdout.write(md)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

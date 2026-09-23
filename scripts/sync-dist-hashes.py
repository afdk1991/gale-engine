#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
发版后同步「版本号 + 安装包 sha256」到各分发通道。

背景（为什么要这个脚本）：
  scoop / homebrew 的清单里写死了安装包的 sha256。发版时若只把 version 和 url
  从 0.1.9 改成 0.1.10 而忘记重算哈希，用户执行 `scoop install` / `brew install`
  会下载新包、用旧哈希校验，直接报 checksum mismatch 装不上 —— 而且这个错误
  只在用户机器上暴露，本地完全测不出来。本项目此前没有任何工具负责这一步。

用法：
  python scripts/sync-dist-hashes.py                 # 按 package.json 版本同步（会联网下载产物算哈希）
  python scripts/sync-dist-hashes.py --version 0.1.10
  python scripts/sync-dist-hashes.py --dry-run       # 只打印将要做的改动，不落盘
  python scripts/sync-dist-hashes.py --hash-from-latest  # 产物尚未发布时，用当前 latest 版本占位（仅调试用）

依赖：Python 3 标准库 + gh CLI（仅用于读取 release 产物清单）。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import urllib.request

REPO = "afdk1991/gale-engine"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 各通道需要的产物（相对 release 资源名）。scoop 用 Windows NSIS，homebrew 用 macOS dmg。
ASSETS = {
    "scoop": [
        "gale-engine-{v}-x64-setup.exe",
        "gale-engine-{v}-arm64-setup.exe",
    ],
    "homebrew": [
        "gale-engine-{v}-arm64.dmg",
        "gale-engine-{v}-x64.dmg",
    ],
}


def log(msg: str = "") -> None:
    print(msg)


def read(path: str) -> str:
    with open(os.path.join(ROOT, path), encoding="utf-8") as f:
        return f.read()


def write(path: str, content: str) -> None:
    with open(os.path.join(ROOT, path), "w", encoding="utf-8", newline="") as f:
        f.write(content)


def current_version() -> str:
    pkg = json.loads(read("package.json"))
    return pkg["version"]


def release_assets(tag: str) -> dict[str, str]:
    """返回 {资源文件名: 下载直链}，release 不存在时返回空 dict。"""
    r = subprocess.run(
        ["gh", "release", "view", tag, "--json", "assets", "--repo", REPO],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        return {}
    data = json.loads(r.stdout or "{}")
    return {a["name"]: a["url"] for a in data.get("assets", []) if a.get("name")}


def sha256_of(url: str) -> str:
    """流式下载并计算 sha256，不落盘（安装包单个 ~80MB）。"""
    digest = hashlib.sha256()
    req = urllib.request.Request(url, headers={"User-Agent": "gale-engine-release-tool"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        for chunk in iter(lambda: resp.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def patch_scoop(version: str, hashes: dict[str, str], dry: bool) -> list[str]:
    path = "scoop/gale-engine.json"
    doc = json.loads(read(path))
    changes = []
    if doc.get("version") != version:
        changes.append(f"version: {doc.get('version')} -> {version}")
        doc["version"] = version
    arch = doc.get("architecture", {})
    key_map = {"64bit": f"gale-engine-{version}-x64-setup.exe",
               "arm64": f"gale-engine-{version}-arm64-setup.exe"}
    for key, filename in key_map.items():
        if key not in arch:
            continue
        url = f"https://github.com/{REPO}/download/v{version}/{filename}" \
              .replace(f"{REPO}/download", f"{REPO}/releases/download")
        if arch[key].get("url") != url:
            changes.append(f"{key}.url -> v{version}")
            arch[key]["url"] = url
        new_hash = f"sha256:{hashes[filename]}"
        if arch[key].get("hash") != new_hash:
            old = (arch[key].get("hash") or "")[:7 + 12]
            changes.append(f"{key}.hash: {old}... -> {new_hash[:19]}...")
            arch[key]["hash"] = new_hash
    if changes and not dry:
        write(path, json.dumps(doc, ensure_ascii=False, indent=2) + "\n")
    return changes


def patch_homebrew(version: str, hashes: dict[str, str], dry: bool) -> list[str]:
    path = "homebrew/gale-engine.rb"
    text = read(path)
    changes = []
    new_ver = re.sub(r'version "([^"]+)"', f'version "{version}"', text, count=1)
    if new_ver != text:
        old = re.search(r'version "([^"]+)"', text).group(1)
        changes.append(f"version: {old} -> {version}")
        text = new_ver
    for arch, filename in (("arm64", f"gale-engine-{version}-arm64.dmg"),
                           ("x64", f"gale-engine-{version}-x64.dmg")):
        pattern = re.compile(r'("' + arch + r'"\s*=>\s*")([0-9a-f]{64})(")')
        match = pattern.search(text)
        if not match:
            continue
        if match.group(2) != hashes[filename]:
            changes.append(f"sha256[{arch}]: {match.group(2)[:12]}... -> {hashes[filename][:12]}...")
            text = pattern.sub(lambda m: m.group(1) + hashes[filename] + m.group(3), text, count=1)
    if changes and not dry:
        write(path, text)
    return changes


def patch_landing(version: str, dry: bool) -> list[str]:
    """只改「指向当前版本」的引用，不动更新日志里的历史条目。"""
    path = "landing/index.html"
    text = read(path)
    changes = []

    def sub_count(pattern: str, repl: str, label: str) -> None:
        nonlocal text
        new, n = re.subn(pattern, repl, text)
        if n:
            changes.append(f"{label} × {n}")
            text = new

    # 下载直链：/releases/download/v<任意版本>/... -> 当前版本
    sub_count(r"(releases/download/v)[0-9]+\.[0-9]+\.[0-9]+(/gale-engine-)[0-9]+\.[0-9]+\.[0-9]+",
              lambda m: m.group(1) + version + m.group(2) + version,
              "下载直链")
    # 脚本里的版本常量
    sub_count(r"(var V = ')[0-9]+\.[0-9]+\.[0-9]+(')", lambda m: m.group(1) + version + m.group(2), "var V")
    # Hero 徽标与页脚
    sub_count(r'(<span class="badge">v)[0-9]+\.[0-9]+\.[0-9]+', lambda m: m.group(1) + version, "hero 徽标")
    sub_count(r"(<div>v)[0-9]+\.[0-9]+\.[0-9]+( · MIT License)",
              lambda m: m.group(1) + version + m.group(2), "页脚版本")

    if changes and not dry:
        write(path, text)
    return changes


def main() -> int:
    ap = argparse.ArgumentParser(description="同步发版版本号与安装包 sha256")
    ap.add_argument("--version", default=None, help="目标版本，默认取 package.json")
    ap.add_argument("--dry-run", action="store_true", help="只打印改动，不写文件")
    args = ap.parse_args()

    version = args.version or current_version()
    tag = f"v{version}"
    log(f"目标版本: {version}（{tag}）  dry-run={args.dry_run}")
    log("")

    assets = release_assets(tag)
    if not assets:
        log(f"❌ GitHub Release {tag} 不存在或没有产物。")
        log("   请先完成发版（打 tag → CI 构建 → Release 发布），再运行本脚本。")
        log("   提示：现在跑只会得到 404 的下载链接和无法校验的哈希。")
        return 1

    needed = [n.format(v=version) for group in ASSETS.values() for n in group]
    missing = [n for n in needed if n not in assets]
    if missing:
        log("❌ 以下产物在 Release 中缺失：")
        for n in missing:
            log(f"   - {n}")
        log(f"   Release 现有产物：{', '.join(sorted(assets)) or '(空)'}")
        return 1

    log("计算 sha256（流式下载，不落盘）：")
    hashes = {}
    for name in needed:
        digest = sha256_of(assets[name])
        hashes[name] = digest
        log(f"   {digest}  {name}")
    log("")

    plan = {
        "scoop/gale-engine.json": patch_scoop(version, hashes, args.dry_run),
        "homebrew/gale-engine.rb": patch_homebrew(version, hashes, args.dry_run),
        "landing/index.html": patch_landing(version, args.dry_run),
    }
    for path, changes in plan.items():
        log(f"── {path}")
        if not changes:
            log("   （已是最新，无需改动）")
        for c in changes:
            log(f"   • {c}")
    log("")
    if args.dry_run:
        log("dry-run 结束，未写入任何文件。去掉 --dry-run 才会落盘。")
    else:
        log("✅ 同步完成。请核对 git diff 后提交。")
    return 0


if __name__ == "__main__":
    sys.exit(main())

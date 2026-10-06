# frozen_string_literal: true

cask "gale-engine" do
  version "0.1.12"

  arch = Hardware::CPU.arm? ? "arm64" : "x64"
  sha256_map = {
    "arm64" => "f2a498f36c15733b0d24c7c287c0e55097df5391889bf489ef00a9af1118e119",
    "x64"   => "536ec196ea898016a2b647925afcc40c62d4852dce2e0a856658fe0dd65dabcc",
  }

  on_arm do
    sha256 sha256_map["arm64"]
  end
  on_intel do
    sha256 sha256_map["x64"]
  end

  url "https://github.com/afdk1991/gale-engine/releases/download/v#{version}/gale-engine-#{version}-#{arch}.dmg"
  name "疾风引擎"
  desc "跨平台系统优化加速软件 - 硬件监控 / 进程管理 / 垃圾清理 / 游戏模式 / 服务管理"
  homepage "https://gy.mixm.top"

  # 未签名 DMG：安装后需右键 → 打开（或 xattr -d com.apple.quarantine）
  app "疾风引擎.app"

  zap trash: [
    "~/Library/Preferences/com.galeengine.app.plist",
    "~/Library/Application Support/疾风引擎",
    "~/Library/Caches/com.galeengine.app",
  ]
end

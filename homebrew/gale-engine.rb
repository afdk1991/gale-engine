# frozen_string_literal: true

cask "gale-engine" do
  version "0.5.4"

  arch = Hardware::CPU.arm? ? "arm64" : "x64"
  sha256_map = {
    "arm64" => "bd310847eaa12172c58a7199e505378586bc0fa82a1225ce4626a985bb6cd860",
    "x64"   => "98e799348a9ae4635792efc18e0aea1706fdf9fca040f22a8e371da4af1e8ba1",
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
  homepage "https://github.com/afdk1991/gale-engine"

  # 未签名 DMG：安装后需右键 → 打开（或 xattr -d com.apple.quarantine）
  app "疾风引擎.app"

  zap trash: [
    "~/Library/Preferences/com.galeengine.app.plist",
    "~/Library/Application Support/疾风引擎",
    "~/Library/Caches/com.galeengine.app",
  ]
end

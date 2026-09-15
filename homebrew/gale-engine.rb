# frozen_string_literal: true

cask "gale-engine" do
  version "0.1.8"

  arch = Hardware::CPU.arm? ? "arm64" : "x64"
  sha256_map = {
    "arm64" => "490e01ce83344b1f327332801066d3af4ad8192587e0048cc1534545dc2d82e2",
    "x64"   => "f4f7bda34fcac7ad0cf4561e92cd0106d3c557e0bff429b869c348cba9852ef9",
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

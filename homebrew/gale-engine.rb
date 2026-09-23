# frozen_string_literal: true

cask "gale-engine" do
  version "0.1.10"

  arch = Hardware::CPU.arm? ? "arm64" : "x64"
  sha256_map = {
    "arm64" => "550df2ba65d0cff579d4ae38e8b329bdf86c8c7d00476f43ea247a2e2bf3008f",
    "x64"   => "a131205de2bb0f1a67cc3c2afcb1f08fa526a7a047bc03f6cd1289036d437286",
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

# 疾风引擎 — Windows 代码签名接入指南

> 作用：消除 Windows SmartScreen「未知发布者」拦截，提升安装包可信度。
> 当前状态：**未签名**（无证书）。CI 与本地构建均已预留签名通道，配置证书后自动生效，无需改 `electron-builder.yml` 或 `release.yml`。

## 一、为什么需要签名

- 未签名的 NSIS 安装包在 Windows 上运行会被 SmartScreen 弹出「Windows 已保护你的电脑 / 未知发布者」警告，普通用户易放弃安装。
- Authenticode 签名 = 用受信任 CA 颁发的代码签名证书对 `gale-engine-*-setup.exe` 进行数字签名，证明发布者身份且文件未被篡改。

## 二、证书选型

| 类型 | 特点 | 适用 |
|---|---|---|
| **EV 代码签名证书**（Extended Validation） | 硬件 Token / 云签名；签发即获 Microsoft 信任，**SmartScreen 信誉即时生效**，无累加下载门槛 | 推荐，首次发布即无拦截 |
| **标准（OV/IV）代码签名证书** | 软证书（.pfx/.p12）；SmartScreen 需积累一定下载量才建立信誉（初期仍可能提示，随安装量下降） | 预算有限、可接受过渡期提示 |

> 合规要点：证书必须由 Microsoft 受信任的根 CA 颁发（如 DigiCert、Sectigo、GlobalSign、Certum 等）。自签名证书无法去除 SmartScreen 警告。
> 注意 2023 年起 Microsoft 已不再信任纯软件 OV 证书的「即时 SmartScreen 信誉」，新账号建议直接选 EV 或接受 OV 的信誉积累期。

## 三、获取证书（以 EV 为例）

1. 向 CA 提交企业/个人身份验证材料，完成 KYC。
2. 选择**云签名服务**（如 DigiCert ONE、Sectigo eSigner）或接收物理 **USB Token（eToken/SafeNet）**。
3. 将证书导出为 `.pfx` / `.p12`（含私钥），记录导出密码。

## 四、配置到仓库 Secrets（CI 自动签名）

在 GitHub 仓库 `Settings → Secrets and variables → Actions → New repository secret` 添加两项：

- `CSC_LINK`：`.pfx`/`.p12` 证书的 **base64 内容**（推荐，避免把二进制塞进仓库），例如：
  ```powershell
  # 本地生成 base64（仅你本机执行，勿提交文件）
  [convert]::ToBase64String([io.file]::ReadAllBytes(".\gale-engine-code-signing.pfx")) | Out-File -NoNewline csc_link.txt
  # 把 csc_link.txt 内容粘贴为 Secret CSC_LINK
  ```
  或直接填仓库内已加密路径（不推荐，二进制进仓库有泄露风险）。
- `CSC_KEY_PASSWORD`：证书导出密码。

> `.github/workflows/release.yml` 的「构建并打包安装包」步骤已注入这两项 Secrets。
> 为空时 `electron-builder.yml` 的 `forceCodeSigning: false` 保证**仍正常产出未签名包**，构建不失败。

## 五、本地签名（可选，发版前自测）

```powershell
$env:CSC_LINK = "X:\path\gale-engine-code-signing.pfx"      # 或 base64 字符串
$env:CSC_KEY_PASSWORD = "你的证书密码"
scripts\package-win.cmd                                     # 产出已签名安装包
# 校验：Get-AuthenticodeSignature .\release\gale-engine-*-setup.exe
```

## 六、验证签名

- 本地：`Get-AuthenticodeSignature release\gale-engine-*-setup.exe` → `Status=Valid`、`SignerCertificate` 显示你的主体名。
- 右键 exe → 属性 → 「数字签名」选项卡可见签名者与时间戳。
- 建议在无信誉积累的 OV 证书情况下，先在干净虚拟机点装确认 SmartScreen 表现。

## 七、时间戳（重要）

electron-builder 默认在签名时请求 RFC3161 时间戳服务（如 Sectigo / DigiCert TSA）。时间戳保证**证书过期后签名依然有效**。若 CI 无法访问外网 TSA，可显式配置：

```yaml
# electron-builder.yml 顶层或 win 段
win:
  sign: ...   # 默认签名器已内置 TSA；如需自定义 TSA：
```

> 当前使用 electron-builder 内置签名器，时间戳走默认 TSA，无需额外配置。

## 八、常见问题

- **SmartScreen 仍提示**：OV 证书需积累下载信誉（或改用 EV 即时信誉）；确认证书来自受信任 CA 且未过期。
- **CI 报 `code signing failed`**：检查 `CSC_LINK` 是否为合法 base64/路径、`CSC_KEY_PASSWORD` 是否正确；windows-latest Runner 需能访问 TSA。
- **本地能签、CI 不能签**：确认 Secrets 已添加到**本仓库**且名称与 `release.yml` 中 `secrets.CSC_LINK` 完全一致。
- **不想签名也能发版**：不配置 Secrets 即可，构建照常产出未签名包（当前默认行为）。

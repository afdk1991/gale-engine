# 能力库清单（capabilities/manifest.json）

这个目录实现本项目的「DLL」语义中最关键的一条：**模块化——替换某个模块即可修复或升级该功能，无需重新编译整个程序**。

应用启动后会读取远端清单并做严格校验；清单里新增一项能力、调整某段文案、下线某个能力，**都不需要重新发版应用**。清单地址默认指向本仓库 `master` 上的 `capabilities/manifest.json`，可用环境变量 `GALE_CAPABILITY_FEED` 覆盖（便于内网/自建源）。

## ⚠️ 安全边界（不可放宽）

**远端清单不能下发可执行代码。** 它只能做两件事：

1. **覆盖内置能力的元信息** —— `label` / `description` / `defaultEnabled`。
   `needsAdmin` 有意**不允许**被远端修改：提权边界只能由本地代码定义。
   内置能力的**实现不可被替换**，命中内置 id 且带 `recipe` 的条目会被直接拒绝。
2. **用「配方」（recipe）编排既有能力** —— 只能引用下方白名单里的调用名，参数逐字段校验，未知调用一律拒绝。

若要做真正的代码级热更新，必须先具备签名校验与沙箱，属于后续里程碑。

## 清单结构

```json
{
  "schema": 1,
  "libraryVersion": "0.1.0",
  "generatedAt": "2026-09-16T00:00:00Z",
  "capabilities": [ /* RemoteCapabilityDef[] */ ]
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `schema` | ✅ | 结构版本，本机只接受 `1`；不匹配则整份清单作废并回落内置 |
| `libraryVersion` | ✅ | 形如 `1` / `1.2` / `1.2.3`。**必须严格大于当前生效版本才会被接受**（防降级攻击） |
| `generatedAt` | — | 生成时间，仅展示 |
| `capabilities` | ✅ | 条目数组，上限 200 条 |

单条能力：

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✅ | `^[a-z][a-z0-9-]{2,47}$`；与内置 id 相同表示「只覆盖元信息」 |
| `label` | ✅ | 展示名，≤40 字符 |
| `description` | — | 说明，≤200 字符 |
| `needsAdmin` | — | **只许收紧、不许放宽**：配方里含需提权步骤之一时该项自动为 `true`，显式写 `false` 无效；写 `true` 可主动收紧。内置项忽略此字段（提权边界只能由本地代码定义，由类型 `OptCapabilityMetaPatch` 在编译期保证） |
| `defaultEnabled` | — | 是否默认纳入一键优化。**远端新能力默认 `false`**，需显式设 `true` 才默认勾选 |
| `enabled` | — | 设 `false` 可将远端能力下线（内置能力不会因此变得不可用） |
| `minAppVersion` | — | 低于该应用版本时忽略此条，并如实记录在「被拒条目」中 |
| `recipe` | — | 配方步骤数组，上限 8 步；出现未知调用则**整条拒绝**（不产出「半截能力」） |

其他硬性防护：清单体积上限 256 KB；JSON 不合法、schema 不符、无任何可用条目 → 整份作废，回落内置。

## 配方白名单

白名单的**权威来源**是代码里的 `createRecipeRuntime()`（`electron/services/capabilityFeed.ts`）。当前可用调用：

| 调用名 | 需提权 | 参数 |
|---|---|---|
| `optimizer.cleanupKind` | — | `kind`: `temp` \| `recycle` \| `browser` |
| `disk.deepCleanup` | — | `ids`: 字符串数组；id 由本机权威清单解析，**远端给不出任意路径** |
| `toolbox.flushDns` | — | 无 |
| `toolbox.emptyRecycleBin` | — | 无 |
| `toolbox.clearClipboard` | — | 无 |
| `disk.repairSystemFiles` | ✅ | `kind`: `sfc` \| `dism-restore` |
| `dll.scan` | — | 无 |
| `dll.repairMissing` | ✅ | `kinds`: `sfc` \| `dism-restore` \| `vcredist-x64` \| `vcredist-x86` 的子集 |

新增白名单调用需要改代码并发版——这是刻意的：**能力边界只能由主程序扩大，不能由远端扩大**。

## 版本发布流程

1. 修改 `capabilities/manifest.json`，**提升 `libraryVersion`**（只增不减）。
2. 提交到 `master`。
3. 用户在「优化中心 → 能力库」点「检查能力库更新」→ 发现新版本 → 应用生效（无需重启应用；应用重启后仍生效，已落盘）。

## 校验与回退

- 拉取失败 / 校验不过 → 保持当前生效版本不变，并在界面显示失败原因（不静默吞掉）。
- 界面会列出**被拒条目及原因**，便于清单作者定位问题。
- 「回退到内置能力库」可一键清除本地缓存的远端清单。

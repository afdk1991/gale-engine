import { getCurrentInstance, onUnmounted, ref, type Ref } from 'vue'

/** 反馈提示的存活时长 */
export const FLASH_TTL_MS = 3000

/** 提示语气：ok=成功（绿）/ bad=失败（红）/ info=中性 */
export type FlashTone = 'ok' | 'bad' | 'info'

/** 提示键：字符串（如服务名 / 规则名 / `profile:Domain`）或数字（如进程 PID） */
export type FlashKey = string | number

export interface UseFlash {
  /** key → 提示文案（模板里直接 `feedback[key]` 读取） */
  feedback: Ref<Record<FlashKey, string>>
  /** 取该 key 的提示语气（用于 `:class="{ bad: tone(key) === 'bad' }"`） */
  tone: (key: FlashKey) => FlashTone
  /** 写入一条提示，并在 TTL 后自动清除；不传 tone 时按文案自动推断 */
  flash: (key: FlashKey, message: string, tone?: FlashTone) => void
  /** 立即清空全部提示 */
  clear: () => void
}

/** 明确的失败/成功措辞 */
const OK_RE = /成功/
const BAD_RE = /失败|拒绝|错误|无效|异常|不支持|无权限|需要管理员|未安装|无法|✗/

/**
 * 按文案推断语气。
 *
 * 这只是**兜底**：能拿到结构化结果时（如 `r.ok`）应显式传 tone。
 * 之所以不再让各页面各自写 `msg.includes('拒绝') || msg.includes('失败')`：
 * 那种写法极易写错（本项目 Firewall 页就曾把 `!p.enabled === msg.includes('拒绝')`
 * 当成判断，语义完全反了），且各页口径不一、漏判严重。
 */
export function inferTone(message: string): FlashTone {
  const m = String(message ?? '')
  if (OK_RE.test(m)) return 'ok'
  if (BAD_RE.test(m)) return 'bad'
  return 'info'
}

/**
 * 页面操作反馈（成功/失败提示）的统一实现。
 *
 * 抽出来的三个原因：
 *  1. **定时器必须随组件卸载清理**。原先 Process / Firewall / Services / Tasks 各自
 *     写了一份 `setTimeout(…, 3000)` 且都不清理，组件卸载后回调仍会写 ref。
 *  2. **语气判断要统一**。原先各页各自 `includes('拒绝')`，容易写错且漏判。
 *  3. 键（key）格式容易在脚本与模板之间写岔——例如 Tasks 页脚本用 `path|name`、
 *     模板用 `path+name`，导致按钮永不置灰、提示永不显示。统一由调用方传入同一个
 *     key 生成函数，避免两处各写一遍。
 */
export function useFlash(ttlMs: number = FLASH_TTL_MS): UseFlash {
  const feedback = ref<Record<FlashKey, string>>({})
  const tones = ref<Record<FlashKey, FlashTone>>({})
  const timers = new Map<FlashKey, ReturnType<typeof setTimeout>>()

  const tone = (key: FlashKey): FlashTone => tones.value[key] ?? 'info'

  const flash = (key: FlashKey, message: string, t: FlashTone = inferTone(message)): void => {
    const prev = timers.get(key)
    if (prev !== undefined) clearTimeout(prev)
    feedback.value = { ...feedback.value, [key]: message }
    tones.value = { ...tones.value, [key]: t }
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key)
        const nextMsg = { ...feedback.value }
        delete nextMsg[key]
        feedback.value = nextMsg
        const nextTone = { ...tones.value }
        delete nextTone[key]
        tones.value = nextTone
      }, ttlMs)
    )
  }

  const clear = (): void => {
    for (const t of timers.values()) clearTimeout(t)
    timers.clear()
    feedback.value = {}
    tones.value = {}
  }

  // 卸载时清掉所有待触发的定时器，避免卸载后仍写 ref。
  // 仅在组件 setup 内注册：直接在组件外调用（如单测）时 Vue 会告警，故先探测。
  if (getCurrentInstance()) onUnmounted(clear)

  return { feedback, tone, flash, clear }
}

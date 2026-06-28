/**
 * safePrompt — 跨平台文本输入弹窗
 *
 * Tauri WKWebView 中 window.prompt() 不可靠（不弹窗、不支持中文输入），
 * 桌面端用简易 DOM overlay 替代；Web 端保留原生 window.prompt。
 */

let activeResolve: ((value: string | null) => void) | null = null

export async function safePrompt(message: string, defaultValue = ''): Promise<string | null> {
  // ponytail: Tauri v2 的全局变量是 __TAURI_INTERNALS__，不是 __TAURI__（v1）
  // 用 isTauriRuntime() 正确兼容 Tauri v2
  const { isTauriRuntime } = await import('./tauriEnv')
  if (!isTauriRuntime()) {
    return window.prompt(message, defaultValue)
  }

  // 清理上一个未关闭的弹窗
  dismissSafePrompt()

  return new Promise<string | null>((resolve) => {
    activeResolve = resolve

    const overlay = document.createElement('div')
    overlay.id = 'jc-safe-prompt-overlay'
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.35);backdrop-filter:blur(2px);'

    const box = document.createElement('div')
    box.style.cssText = 'background:var(--paper,#f5f0e8);border-radius:12px;padding:20px 24px;min-width:320px;max-width:90vw;box-shadow:0 8px 32px rgba(0,0,0,0.18);display:flex;flex-direction:column;gap:12px;'

    const label = document.createElement('label')
    label.textContent = message
    label.style.cssText = 'font-size:14px;color:var(--ink1,#333);font-weight:600;'

    const input = document.createElement('input')
    input.type = 'text'
    input.value = defaultValue
    input.style.cssText = 'width:100%;padding:8px 12px;border:1px solid var(--border,#d5c787);border-radius:8px;font-size:14px;outline:none;background:var(--bg,#fff);color:var(--ink1,#333);'
    input.onkeydown = (e) => {
      if (e.key === 'Enter') finish(input.value)
      if (e.key === 'Escape') finish(null)
    }

    const actions = document.createElement('div')
    actions.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;'

    const cancelBtn = document.createElement('button')
    cancelBtn.textContent = '取消'
    cancelBtn.style.cssText = 'padding:6px 16px;border:1px solid var(--border,#ccc);border-radius:8px;background:transparent;color:var(--ink2,#666);cursor:pointer;font-size:13px;'
    cancelBtn.onclick = () => finish(null)

    const okBtn = document.createElement('button')
    okBtn.textContent = '确定'
    okBtn.style.cssText = 'padding:6px 20px;border:none;border-radius:8px;background:var(--olive,#6B8E23);color:#fff;cursor:pointer;font-size:13px;font-weight:600;'
    okBtn.onclick = () => finish(input.value)

    actions.append(cancelBtn, okBtn)
    box.append(label, input, actions)
    overlay.appendChild(box)

    const finish = (value: string | null) => {
      if (activeResolve === resolve) {
        activeResolve = null
        overlay.remove()
        resolve(value)
      }
    }

    overlay.onclick = (e) => {
      if (e.target === overlay) finish(null)
    }

    document.body.appendChild(overlay)
    setTimeout(() => input.focus(), 50)
  })
}

export function dismissSafePrompt(): void {
  if (activeResolve) {
    const resolve = activeResolve
    activeResolve = null
    resolve(null)
    document.getElementById('jc-safe-prompt-overlay')?.remove()
  }
}

/**
 * tts.ts — 消息朗读（Web Speech API，零依赖）
 * 使用浏览器内置 SpeechSynthesis
 */

export type TtsState = 'idle' | 'speaking' | 'paused'

let currentUtterance: SpeechSynthesisUtterance | null = null
let state: TtsState = 'idle'
let onStateChange: ((s: TtsState) => void) | null = null

function stripHtml(html: string): string {
  const div = document.createElement('div')
  div.innerHTML = html
  return div.textContent || div.innerText || ''
}

function getBestVoice(): SpeechSynthesisVoice | null {
  const voices = speechSynthesis.getVoices()
  if (!voices.length) return null

  // 优先中文语音
  const zhVoice = voices.find(v => v.lang.startsWith('zh-CN') || v.lang.startsWith('zh-TW') || v.lang.startsWith('zh'))
  if (zhVoice) return zhVoice

  // 其次英文
  const enVoice = voices.find(v => v.lang.startsWith('en-US') || v.lang.startsWith('en-GB'))
  if (enVoice) return enVoice

  return voices[0]
}

function setState(s: TtsState) {
  state = s
  onStateChange?.(s)
}

/**
 * 朗读文本（提取纯文本后朗读）
 */
export function speakText(html: string): boolean {
  if (!('speechSynthesis' in window)) return false

  // 停止当前朗读
  stopSpeaking()

  const text = stripHtml(html)
  if (!text.trim()) return false

  // 确保 voices 已加载
  if (!speechSynthesis.getVoices().length) {
    speechSynthesis.addEventListener('voiceschanged', () => {
      doSpeak(text)
    }, { once: true })
  } else {
    doSpeak(text)
  }
  return true
}

function doSpeak(text: string) {
  const utterance = new SpeechSynthesisUtterance(text)
  const voice = getBestVoice()
  if (voice) utterance.voice = voice
  utterance.rate = 1.0
  utterance.pitch = 1.0
  utterance.volume = 1.0

  utterance.onstart = () => setState('speaking')
  utterance.onend = () => {
    setState('idle')
    currentUtterance = null
  }
  utterance.onerror = () => {
    setState('idle')
    currentUtterance = null
  }
  utterance.onpause = () => setState('paused')
  utterance.onresume = () => setState('speaking')

  currentUtterance = utterance
  speechSynthesis.speak(utterance)
}

/**
 * 暂停朗读
 */
export function pauseSpeaking() {
  if (state === 'speaking') {
    speechSynthesis.pause()
  }
}

/**
 * 恢复朗读
 */
export function resumeSpeaking() {
  if (state === 'paused') {
    speechSynthesis.resume()
  }
}

/**
 * 停止朗读
 */
export function stopSpeaking() {
  speechSynthesis.cancel()
  setState('idle')
  currentUtterance = null
}

/**
 * 获取当前朗读状态
 */
export function getTtsState(): TtsState {
  return state
}

/**
 * 注册状态变化回调
 */
export function onTtsStateChange(cb: (s: TtsState) => void) {
  onStateChange = cb
}

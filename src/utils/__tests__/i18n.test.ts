import assert from 'node:assert/strict'
import { test } from 'node:test'

import { getLocale, setLocale, t, toggleLocale } from '@/i18n'

function withLocalStorage(values: Record<string, string>, fn: () => void) {
  const store = new Map<string, string>(Object.entries(values))
  const previous = (globalThis as any).localStorage
  ;(globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
  }
  try {
    fn()
  } finally {
    ;(globalThis as any).localStorage = previous
  }
}

test('locale defaults to Chinese and persists explicit English selection', () => {
  withLocalStorage({}, () => {
    assert.equal(getLocale(), 'zh-CN')
    setLocale('en-US')
    assert.equal(getLocale(), 'en-US')
    assert.equal(t('rail.help'), 'Help / Tutorials')
  })
})

test('toggleLocale switches language and updates rail label text', () => {
  withLocalStorage({ jc_locale: 'zh-CN' }, () => {
    assert.equal(toggleLocale(), 'en-US')
    assert.equal(t('rail.userCenter'), 'Account')
    assert.equal(toggleLocale(), 'zh-CN')
    assert.equal(t('rail.userCenter'), '用户中心')
  })
})

test('skill rail exposes the official Skill Manager label', () => {
  withLocalStorage({ jc_locale: 'zh-CN' }, () => {
    assert.equal(t('rail.skillsManage'), 'Skill管理')
  })

  withLocalStorage({ jc_locale: 'en-US' }, () => {
    assert.equal(t('rail.skillsManage'), 'Skill Manager')
  })
})

test('translation falls back to Chinese text when an English key is missing', () => {
  withLocalStorage({ jc_locale: 'en-US' }, () => {
    assert.equal(t('help.desktopLocal'), '桌面版保留本地 Ollama、文件、画布和编辑区能力。')
  })
})

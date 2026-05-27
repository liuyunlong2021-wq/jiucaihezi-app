<script setup lang="ts">
/**
 * LocalCapabilitySetup.vue — 本地能力中心
 *
 * 首次启动弹窗 + 设置页内嵌
 * 统一管理浏览器、文件系统、Shell、项目、ffmpeg 等本地能力
 */
import { ref, computed, onMounted } from 'vue'
import { getLocalCapabilities, markSkipped, markSetupWizardDone, shouldShowSetupWizard, type LocalCapability } from '@/utils/localCapabilities'
import { isTauriRuntime } from '@/utils/tauriEnv'

const props = withDefaults(defineProps<{
  /** modal 模式（首次引导）vs inline 模式（设置页内嵌） */
  mode?: 'modal' | 'inline'
}>(), { mode: 'inline' })

const emit = defineEmits<{
  (e: 'close'): void
}>()

const capabilities = ref<Array<LocalCapability & { status: 'ready' | 'pending' | 'unavailable' }>>([])
const loading = ref(true)
const isTauri = isTauriRuntime()

const readyCount = computed(() => capabilities.value.filter(c => c.status === 'ready').length)
const allReady = computed(() => capabilities.value.every(c => c.status === 'ready'))

async function loadCapabilities() {
  loading.value = true
  const caps = getLocalCapabilities()
  const result: typeof capabilities.value = []
  for (const c of caps) {
    const ready = await c.check().catch(() => false)
    result.push({
      ...c,
      status: ready ? 'ready' : isTauri ? 'pending' : 'unavailable',
    })
  }
  capabilities.value = result
  loading.value = false
}

async function handleSetup(cap: LocalCapability & { status: string }) {
  cap.status = 'pending'
  try {
    await cap.setup()
    // 重新检测
    const ready = await cap.check().catch(() => false)
    cap.status = ready ? 'ready' : 'unavailable'
  } catch {
    cap.status = 'unavailable'
  }
}

function handleSkip(cap: LocalCapability & { status: string }) {
  markSkipped(cap.id)
  cap.status = 'unavailable'
}

function handleClose() {
  if (allReady.value) {
    markSetupWizardDone()
  }
  emit('close')
}

onMounted(loadCapabilities)
</script>

<template>
  <div class="lcs" :class="{ modal: mode === 'modal' }">
    <div v-if="mode === 'modal'" class="lcs-overlay" @click.self="handleClose">
      <div class="lcs-panel">
        <div class="lcs-header">
          <div>
            <h2 class="lcs-title">🔧 本地能力中心</h2>
            <p class="lcs-subtitle">一次设置，全部就绪。随时可在设置中重新配置。</p>
          </div>
          <button class="lcs-close" @click="handleClose">
            <span class="mso">close</span>
          </button>
        </div>
        <div class="lcs-body">
          <div v-if="loading" class="lcs-loading">检测中...</div>
          <template v-else>
            <div class="lcs-progress">
              <div class="lcs-progress-bar">
                <div class="lcs-progress-fill" :style="{ width: (readyCount / capabilities.length * 100) + '%' }"></div>
              </div>
              <span class="lcs-progress-text">{{ readyCount }}/{{ capabilities.length }} 项已就绪</span>
            </div>
            <div v-for="cap in capabilities" :key="cap.id" class="lcs-item" :class="cap.status">
              <div class="lcs-item-icon">
                <span class="mso" style="font-size:20px">
                  {{ cap.status === 'ready' ? 'check_circle' : cap.status === 'pending' ? 'pending' : 'info' }}
                </span>
              </div>
              <div class="lcs-item-info">
                <div class="lcs-item-name">
                  {{ cap.name }}
                  <span v-if="cap.critical" class="lcs-critical">必需</span>
                </div>
                <div class="lcs-item-desc">{{ cap.description }}</div>
              </div>
              <div class="lcs-item-actions">
                <button
                  v-if="cap.status === 'pending'"
                  class="lcs-btn primary"
                  @click="handleSetup(cap)"
                >
                  去设置
                </button>
                <span v-else-if="cap.status === 'ready'" class="lcs-status ready">✅</span>
                <span v-else class="lcs-status">-</span>
                <button
                  v-if="cap.status !== 'ready' && !cap.critical"
                  class="lcs-btn skip"
                  @click="handleSkip(cap)"
                >
                  跳过
                </button>
              </div>
            </div>
          </template>
        </div>
        <div class="lcs-footer">
          <button class="lcs-btn primary large" @click="handleClose" :disabled="!allReady">
            {{ allReady ? '开始使用' : '继续（可稍后设置）' }}
          </button>
        </div>
      </div>
    </div>

    <!-- inline 模式：设置页内嵌 -->
    <div v-else class="lcs-inline">
      <h3>本地能力</h3>
      <p class="lcs-subtitle">管理韭菜盒子的本地工具和权限</p>
      <div v-if="loading" class="lcs-loading">检测中...</div>
      <div v-else class="lcs-list">
        <div v-for="cap in capabilities" :key="cap.id" class="lcs-item" :class="cap.status">
          <div class="lcs-item-icon">
            <span class="mso" style="font-size:20px">
              {{ cap.status === 'ready' ? 'check_circle' : cap.status === 'pending' ? 'pending' : 'info' }}
            </span>
          </div>
          <div class="lcs-item-info">
            <div class="lcs-item-name">{{ cap.name }}</div>
            <div class="lcs-item-desc">{{ cap.description }}</div>
          </div>
          <button
            v-if="cap.status === 'pending'"
            class="lcs-btn primary"
            @click="handleSetup(cap)"
          >
            配置
          </button>
          <span v-else-if="cap.status === 'ready'" class="lcs-status ready">✅ 已就绪</span>
          <span v-else class="lcs-status">❌ 不可用</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lcs-overlay {
  position: fixed; inset: 0; z-index: 10001;
  background: rgba(0,0,0,.45);
  display: flex; align-items: center; justify-content: center;
}
.lcs-panel {
  width: 480px; max-height: 80vh;
  background: var(--paper); border-radius: 16px;
  box-shadow: 0 16px 48px rgba(0,0,0,.2);
  display: flex; flex-direction: column; overflow: hidden;
}
.lcs-header {
  display: flex; justify-content: space-between; align-items: flex-start;
  padding: 20px 20px 12px;
}
.lcs-title { font-size: 18px; font-weight: 700; color: var(--ink1); margin: 0; }
.lcs-subtitle { font-size: 12px; color: var(--ink3); margin: 4px 0 0; }
.lcs-close {
  border: none; background: none; color: var(--ink3); cursor: pointer;
  padding: 4px; border-radius: 6px;
}
.lcs-close:hover { color: var(--ink1); background: var(--surface); }
.lcs-body { padding: 0 20px; overflow-y: auto; flex: 1; }
.lcs-loading { text-align: center; padding: 24px; color: var(--ink3); }
.lcs-progress { margin-bottom: 12px; }
.lcs-progress-bar {
  height: 4px; border-radius: 2px; background: var(--line);
  overflow: hidden; margin-bottom: 4px;
}
.lcs-progress-fill {
  height: 100%; border-radius: 2px;
  background: var(--olive); transition: width .4s;
}
.lcs-progress-text { font-size: 11px; color: var(--ink3); }
.lcs-item {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 0; border-bottom: 1px solid var(--line);
}
.lcs-item:last-child { border-bottom: none; }
.lcs-item-icon { flex-shrink: 0; }
.lcs-item-icon .mso { color: var(--ink3); }
.lcs-item.ready .lcs-item-icon .mso { color: #4caf50; }
.lcs-item.pending .lcs-item-icon .mso { color: var(--olive); }
.lcs-item-info { flex: 1; min-width: 0; }
.lcs-item-name { font-size: 13px; font-weight: 600; color: var(--ink1); display: flex; align-items: center; gap: 6px; }
.lcs-item-desc { font-size: 11px; color: var(--ink3); margin-top: 2px; }
.lcs-critical {
  font-size: 9px; padding: 1px 5px; border-radius: 4px;
  background: rgba(229,57,53,.1); color: #e53935; font-weight: 700;
}
.lcs-item-actions { flex-shrink: 0; display: flex; gap: 6px; align-items: center; }
.lcs-btn {
  padding: 4px 12px; border-radius: 6px; border: none;
  font-size: 11px; font-weight: 600; cursor: pointer; font-family: inherit;
  transition: all .12s;
}
.lcs-btn.primary { background: var(--olive); color: #fff; }
.lcs-btn.primary:hover { filter: brightness(1.1); }
.lcs-btn.skip { background: transparent; color: var(--ink3); border: 1px solid var(--line); }
.lcs-btn.skip:hover { border-color: var(--ink3); }
.lcs-btn.large { padding: 8px 24px; font-size: 13px; border-radius: 8px; }
.lcs-btn:disabled { opacity: .5; cursor: default; }
.lcs-status { font-size: 12px; color: var(--ink3); }
.lcs-status.ready { color: #4caf50; }
.lcs-footer {
  padding: 12px 20px 16px; border-top: 1px solid var(--line);
  display: flex; justify-content: flex-end;
}
.lcs-inline { padding: 8px 0; }
.lcs-inline h3 { margin: 0 0 4px; font-size: 15px; }
</style>

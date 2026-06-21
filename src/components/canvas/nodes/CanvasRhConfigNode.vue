<script setup lang="ts">
/**
 * CanvasRhConfigNode — Phase F1，对齐 T8 RhConfigNode.tsx
 * RH 全局配置：API Key / 余额 / 渠道选择
 */
import { ref, computed } from 'vue'
import { useCanvasStore } from '@/stores/canvasStore'
import {
  getGlobalRhApiKey, setGlobalRhApiKey,
  getGlobalRhUseGateway, setGlobalRhUseGateway,
} from '@/stores/canvasRhToolsStore'
import { fetchRhAppInfo } from '@/canvas/services/canvasGeneration'

const props = defineProps<{ id: string; data: any; selected?: boolean }>()
const canvasStore = useCanvasStore()
const d = computed(() => props.data || {})

function patch(p: Record<string, any>) { canvasStore.updateNodeData(props.id, p) }

const useGateway = computed({
  get: () => getGlobalRhUseGateway(),
  set: (v: boolean) => { setGlobalRhUseGateway(v); patch({ useGateway: v }) },
})
const rhApiKey = computed({
  get: () => getGlobalRhApiKey(),
  set: (v: string) => { setGlobalRhApiKey(v); patch({ rhApiKey: v }) },
})

const balance = ref<number | null>(d.value.walletBalance ?? null)
const lastChecked = ref<number>(d.value.lastChecked ?? 0)
const testing = ref(false)
const testError = ref<string | null>(null)

async function handleTest() {
  testError.value = null
  if (!rhApiKey.value.trim()) { testError.value = '请先填入 API Key'; return }
  testing.value = true
  try {
    const info = await fetchRhAppInfo('0')
    const bal = info?.balance ?? info?.walletBalance ?? info?.credits ?? null
    balance.value = typeof bal === 'number' ? bal : null
    lastChecked.value = Date.now()
    patch({ walletBalance: balance.value, lastChecked: lastChecked.value })
  } catch (e: any) { testError.value = e?.message || '验证失败'; balance.value = null }
  finally { testing.value = false }
}

const balanceLow = computed(() => balance.value !== null && balance.value < 100)
</script>

<template>
  <div class="rc" :class="{ sel: selected }" :style="{ borderColor: selected ? '#a78bfa' : 'var(--border)' }">
    <div class="rc-hd">
      <div class="rc-hd-ic" style="background:rgba(139,92,246,.18);color:#c4b5fd;box-shadow:inset 0 0 0 1px rgba(139,92,246,.4)">
        <JcIcon name="settings" style="font-size:13px" />
      </div>
      <div class="rc-hd-tx">
        <div class="rc-hd-tt">RH 配置</div>
        <div class="rc-hd-sub">API Key · 余额</div>
      </div>
    </div>
    <div class="rc-bd" @mousedown.stop>
      <div class="rc-sec">
        <div class="rc-lb">渠道</div>
        <label class="rc-opt" :class="{ on: useGateway }">
          <input type="radio" :checked="useGateway" @change="useGateway = true" />
          <span>走韭菜盒子（推荐）</span>
        </label>
        <label class="rc-opt" :class="{ on: !useGateway }">
          <input type="radio" :checked="!useGateway" @change="useGateway = false" />
          <span>自有 RH API Key（高级）</span>
        </label>
      </div>
      <template v-if="!useGateway">
        <div>
          <label class="rc-lb">API Key</label>
          <div class="rc-row">
            <input v-model="rhApiKey" class="rc-inp rc-inp-flex" type="password" placeholder="rhn_..." />
            <button class="rc-btn-sm" :disabled="testing" @click="handleTest">
              <JcIcon :name="testing ? 'progress_activity' : 'check'" :class="{ 'rc-spin': testing }" style="font-size:11px" />
              {{ testing ? '验证中' : '测试' }}
            </button>
          </div>
          <div v-if="testError" class="rc-err">{{ testError }}</div>
        </div>
        <div v-if="balance !== null" class="rc-bal" :class="{ low: balanceLow }">
          <JcIcon name="account_balance_wallet" style="font-size:13px" />
          <span class="rc-bal-val">💰 {{ balance }}</span>
          <button class="rc-btn-sm" @click="handleTest" title="刷新余额"><JcIcon name="refresh" style="font-size:10px" /></button>
          <span v-if="lastChecked" class="rc-bal-ts">{{ new Date(lastChecked).toLocaleTimeString() }}</span>
        </div>
        <div v-if="balanceLow" class="rc-warn">⚠️ 余额不足 100，可能影响生成</div>
      </template>
      <div v-else class="rc-hint">💡 走韭菜盒子网关，无需额外配置</div>
    </div>
  </div>
</template>

<style scoped>
.rc { width: 280px; border: 2px solid var(--border); border-radius: 12px; background: var(--paper); box-shadow: var(--jc-shadow-sm); color: var(--ink1); }
.rc.sel { border-color: #a78bfa; }
.rc-hd { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--border2); }
.rc-hd-ic { width: 24px; height: 24px; border-radius: 6px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.rc-hd-tx { flex: 1; }
.rc-hd-tt { font-size: 13px; font-weight: 600; }
.rc-hd-sub { font-size: 10px; color: var(--ink3); }
.rc-bd { padding: 10px; display: flex; flex-direction: column; gap: 10px; }
.rc-lb { font-size: 10px; color: var(--ink3); margin-bottom: 4px; }
.rc-sec { display: flex; flex-direction: column; gap: 4px; }
.rc-opt { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border: 1px solid var(--border2); border-radius: 6px; cursor: pointer; font-size: 11px; }
.rc-opt.on { border-color: #a78bfa; background: rgba(139,92,246,.08); }
.rc-opt input { accent-color: #a78bfa; }
.rc-row { display: flex; gap: 4px; }
.rc-inp { width: 100%; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--ink1); padding: 5px 8px; font-size: 11px; outline: none; font: inherit; }
.rc-inp:focus { border-color: #a78bfa; }
.rc-inp-flex { flex: 1; }
.rc-btn-sm { display: flex; align-items: center; gap: 3px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--ink2); cursor: pointer; padding: 4px 8px; font-size: 10px; white-space: nowrap; }
.rc-btn-sm:hover { background: var(--surface-alt); }
.rc-btn-sm:disabled { opacity: .5; }
.rc-spin { animation: rc-spin 1s linear infinite; }
@keyframes rc-spin { to { transform: rotate(360deg) } }
.rc-err { font-size: 10px; color: #f87171; margin-top: 2px; }
.rc-bal { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border: 1px solid var(--border2); border-radius: 6px; font-size: 12px; }
.rc-bal.low { border-color: rgba(239,68,68,.3); background: rgba(239,68,68,.05); }
.rc-bal-val { font-weight: 600; }
.rc-bal-ts { font-size: 9px; color: var(--ink3); margin-left: auto; }
.rc-warn { font-size: 10px; color: #f59e0b; background: rgba(245,158,11,.1); border: 1px solid rgba(245,158,11,.2); border-radius: 4px; padding: 4px 8px; }
.rc-hint { font-size: 11px; color: var(--ink3); text-align: center; padding: 8px 0; }
</style>

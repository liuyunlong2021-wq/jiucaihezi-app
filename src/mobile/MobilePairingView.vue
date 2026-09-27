<script setup lang="ts">
import type { MobileRemoteStatus } from '@/services/mobileRemoteTransport'

// 设备页：配对与连接。这里不出现项目、对话、模型或技能入口（合同 §7.2）。
defineProps<{
  status: MobileRemoteStatus | null
  busy: boolean
  error: string
}>()

defineEmits<{
  scan: []
  connect: []
  disconnect: []
}>()
</script>

<template>
  <section class="pairing">
    <header>
      <JcIcon name="smartphone" />
      <h1>韭菜盒子遥控</h1>
      <p>在电脑上打开「设置 → 手机控制器 → 开启」，再扫描它显示的二维码。</p>
    </header>

    <p class="state" :class="{ offline: !status?.connected }">
      <JcIcon :name="status?.connected ? 'check_circle' : 'link_off'" />
      <span v-if="status?.connected">已连接到 {{ status.address }}</span>
      <span v-else-if="status?.paired">已配对该电脑，可直接重新连接</span>
      <span v-else>还没有和电脑配对</span>
    </p>

    <button class="primary" type="button" :disabled="busy" @click="$emit('scan')">
      <JcIcon name="qr_code_scanner" />
      <span>{{ status?.paired ? '重新扫码配对' : '扫描二维码连接' }}</span>
    </button>
    <button
      v-if="status?.paired && !status?.connected"
      type="button"
      :disabled="busy"
      @click="$emit('connect')"
    >
      <JcIcon name="sync" />
      <span>连接上次配对的电脑</span>
    </button>
    <button v-if="status?.paired" type="button" :disabled="busy" @click="$emit('disconnect')">
      <JcIcon name="link_off" />
      <span>断开</span>
    </button>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p class="hint">手机只操作电脑上当前打开的那个对话；对话历史留在电脑，手机不保存副本。</p>
  </section>
</template>

<style scoped>
.pairing { display: flex; flex-direction: column; gap: 12px; padding: calc(env(safe-area-inset-top) + 28px) 20px calc(env(safe-area-inset-bottom) + 24px); min-height: 100vh; box-sizing: border-box; color: var(--ink1); }
.pairing header { display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; }
.pairing h1 { margin: 0; font-size: 20px; }
.pairing header p { margin: 0; color: var(--ink3); font-size: 13px; line-height: 1.5; }
.state { display: flex; align-items: center; gap: 6px; margin: 0; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); font-size: 13px; }
.state.offline { color: var(--ink3); }
button { display: flex; align-items: center; justify-content: center; gap: 6px; min-height: 46px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); color: var(--ink1); font: inherit; font-size: 14px; cursor: pointer; }
button.primary { border-color: var(--olive); background: var(--olive); color: #fff; }
button:disabled { opacity: 0.55; cursor: default; }
.error { margin: 0; padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--danger, #c0392b) 45%, var(--line)); border-radius: 10px; color: var(--danger, #c0392b); font-size: 13px; }
.hint { margin: 4px 0 0; color: var(--ink3); font-size: 12px; line-height: 1.5; }
</style>

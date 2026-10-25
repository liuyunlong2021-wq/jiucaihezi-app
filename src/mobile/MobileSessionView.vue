<script setup lang="ts">
import { computed, ref } from 'vue'
import ChatScrollNav from '@/components/chat/ChatScrollNav.vue'
import ToolApprovalStrip from '@/components/chat/ToolApprovalStrip.vue'
import { renderStreamingText } from '@/components/chat/display/streamingTextRenderer'
import MobileManjuAutoPanel from './MobileManjuAutoPanel.vue'
import {
  mobileRemotePendingTurn,
  mobileVisibleTurns,
  type MobileManjuCommand,
  type MobileRemoteApprovalDecision,
  type MobileRemoteMode,
  type MobileRemoteTurn,
  type MobileRemoteView,
} from '@/services/mobileRemoteClient'

// 单会话聊天页：只读投影 + 纯文字发送 + 停止 + 审批（合同 §7.1、§12）。
const props = defineProps<{
  view: MobileRemoteView
  busy: boolean
  manju: (type: MobileManjuCommand, payload?: Record<string, unknown>) => Promise<unknown>
  loadImage: (path: string) => Promise<{ bytes: Uint8Array<ArrayBuffer>; mime: string }>
}>()

const emit = defineEmits<{
  send: [text: string]
  stop: []
  approve: [approvalId: string, decision: MobileRemoteApprovalDecision]
  disconnect: []
  browse: []
  files: []
  mode: [mode: MobileRemoteMode]
}>()

// 与电脑输入框下的三个创作按钮一一对应；再点一次已选中的就回到普通对话。
const MODES: Array<{ id: MobileRemoteMode; label: string }> = [
  { id: 'manju', label: '漫剧制作' },
  { id: 'short-drama', label: '短剧改编' },
  { id: 'novel', label: '小说创作' },
]

const messagesEl = ref<HTMLElement | null>(null)
const draft = ref('')

const isRunning = computed(() => props.view.run.state === 'running')
// 全自动成片只在电脑当前对话里有；漫剧模式下或已有运行/确认卡/审图时显示。
const showManjuAuto = computed(() => {
  const auto = props.view.manjuAuto
  return Boolean(auto && (props.view.mode === 'manju' || auto.run || auto.draft || auto.review))
})
const approval = computed(() => props.view.run.approval)
const turns = computed(() => mobileVisibleTurns(props.view))
const remotePendingTurn = computed(() => mobileRemotePendingTurn(props.view))

function kindOf(turn: MobileRemoteTurn) {
  if (turn.role === 'user') return 'user'
  if (turn.role === 'assistant') return 'assistant'
  return 'meta'
}

/** 助手正文与本地工作台用同一套转义渲染，不新造第二套 markdown 管线。 */
function render(content: string) {
  return renderStreamingText(content)
}

function submit() {
  const text = draft.value.trim()
  if (!text || props.busy) return
  draft.value = ''
  emit('send', text)
}
</script>

<template>
  <section class="session">
    <header>
      <div class="context">
        <strong>{{ view.context?.conversationTitle || '当前对话' }}</strong>
        <small>{{ view.context?.projectName || '当前项目' }}{{ view.following ? ' · 跟随电脑' : '' }}</small>
      </div>
      <button type="button" title="看成果" aria-label="看成果" @click="$emit('files')">
        <JcIcon name="folder_open" />
      </button>
      <button type="button" title="选择对话" aria-label="选择对话" @click="$emit('browse')">
        <JcIcon name="forum" />
      </button>
      <button type="button" title="断开连接" aria-label="断开连接" @click="$emit('disconnect')">
        <JcIcon name="link_off" />
      </button>
    </header>

    <div ref="messagesEl" class="messages">
      <article v-for="turn in turns" :key="turn.id" class="message" :class="kindOf(turn)">
        <p v-if="kindOf(turn) === 'meta'" class="meta-line">{{ turn.content }}</p>
        <div v-else class="bubble" v-html="render(turn.content)" />
      </article>

      <article v-for="message in view.pendingMessages" :key="message.commandId" class="message user">
        <div class="bubble">
          {{ message.content }}
          <small class="pending-state">{{ {
            sending: '正在发送', accepted: '电脑已接收', unconfirmed: '连接中断，结果待确认', failed: '发送失败',
          }[message.state] }}</small>
        </div>
      </article>

      <article v-if="remotePendingTurn" class="message user">
        <div class="bubble">{{ remotePendingTurn.content }}<small class="pending-state">电脑正在处理</small></div>
      </article>

      <article v-if="view.streamingText" class="message assistant">
        <div class="bubble" v-html="render(view.streamingText)" />
      </article>

      <p v-if="!turns.length && !view.pendingMessages.length && !view.streamingText" class="empty">这个对话还没有内容。</p>
      <ChatScrollNav :container="messagesEl" :is-streaming="isRunning" />
    </div>

    <footer>
      <div class="run" :class="view.run.state" role="status">
        <JcIcon :name="isRunning ? 'sync' : view.run.state === 'failed' ? 'error' : 'check_circle'" :class="{ spinning: isRunning }" />
        <span v-if="isRunning">电脑正在运行{{ view.run.status ? ` · ${view.run.status}` : '' }}</span>
        <span v-else-if="view.run.state === 'failed'">上一次运行失败</span>
        <span v-else>{{ view.state === 'connected' ? '空闲' : '连接已断开' }}</span>
      </div>

      <ul v-if="view.run.steps.length" class="steps">
        <li v-for="step in view.run.steps" :key="step.id" :class="step.state">
          <span>{{ step.label }}</span>
          <em v-if="step.errorReason">{{ step.errorReason }}</em>
        </li>
      </ul>

      <ToolApprovalStrip
        v-if="approval"
        :message="approval.message"
        @reject="$emit('approve', approval.id, 'reject')"
        @once="$emit('approve', approval.id, 'approve')"
        @always="$emit('approve', approval.id, 'always')"
      />

      <MobileManjuAutoPanel
        v-if="showManjuAuto && view.manjuAuto"
        :auto="view.manjuAuto"
        :busy="busy || isRunning"
        :manju="manju"
        :load-image="loadImage"
      />

      <div class="modes" role="group" aria-label="创作模式">
        <button
          v-for="item in MODES"
          :key="item.id"
          type="button"
          :class="{ active: view.mode === item.id }"
          :aria-pressed="view.mode === item.id"
          :disabled="busy || isRunning"
          @click="$emit('mode', view.mode === item.id ? 'none' : item.id)"
        >
          {{ item.label }}
        </button>
      </div>

      <div class="composer">
        <textarea
          v-model="draft"
          rows="2"
          placeholder="给电脑上的这个对话发一句话"
          @keydown.enter.exact.prevent="submit"
        />
        <button v-if="isRunning" type="button" class="stop" :disabled="busy" @click="$emit('stop')">
          <JcIcon name="stop" />
          <span>停止</span>
        </button>
        <button v-else type="button" class="primary" :disabled="busy || !draft.trim()" @click="submit">
          <JcIcon name="send" />
          <span>发送</span>
        </button>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.session { display: flex; flex-direction: column; height: 100vh; box-sizing: border-box; color: var(--ink1); }
.session > header { display: flex; align-items: center; gap: 8px; padding: calc(env(safe-area-inset-top) + 10px) 14px 10px; border-bottom: 1px solid var(--line); background: var(--surface); }
.context { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.context strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
.context small { color: var(--ink3); font-size: 11px; }
.session > header button { display: flex; align-items: center; justify-content: center; width: 34px; height: 34px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--ink2); cursor: pointer; }
.messages { position: relative; flex: 1; overflow-y: auto; padding: 12px 12px 4px; }
.message { display: flex; margin-bottom: 10px; }
.message.user { justify-content: flex-end; }
.bubble { max-width: 86%; padding: 9px 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); font-size: 14px; line-height: 1.6; word-break: break-word; white-space: pre-wrap; }
.message.user .bubble { border-color: color-mix(in srgb, var(--olive) 40%, var(--line)); background: color-mix(in srgb, var(--olive) 12%, var(--surface)); }
.pending-state { display: block; color: var(--ink3); font-size: 11px; }
.meta-line { margin: 0; color: var(--ink3); font-size: 12px; line-height: 1.5; }
.empty { margin: 24px 0 0; text-align: center; color: var(--ink3); font-size: 13px; }
.session > footer { display: flex; flex-direction: column; gap: 8px; padding: 8px 12px calc(env(safe-area-inset-bottom) + 10px); border-top: 1px solid var(--line); background: var(--surface); }
.run { display: flex; align-items: center; gap: 6px; color: var(--ink3); font-size: 12px; }
.run.failed { color: var(--danger, #c0392b); }
.spinning { animation: spin 1.1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg) } }
.steps { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 2px; max-height: 22vh; overflow-y: auto; }
.steps li { display: flex; gap: 6px; color: var(--ink3); font-size: 12px; }
.steps li.done { color: var(--ink2); }
.steps li.failed { color: var(--danger, #c0392b); }
.steps em { font-style: normal; opacity: 0.8; }
.modes { display: flex; gap: 6px; }
.modes button { flex: 1; min-height: 32px; padding: 0 8px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--ink2); font: inherit; font-size: 13px; cursor: pointer; }
.modes button.active { border-color: var(--olive); background: color-mix(in srgb, var(--olive) 14%, var(--surface)); color: var(--ink1); }
.modes button:disabled { opacity: 0.55; cursor: default; }
.composer { display: flex; align-items: flex-end; gap: 8px; }
.composer textarea { flex: 1; min-height: 40px; max-height: 30vh; padding: 9px 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg, var(--surface)); color: var(--ink1); font: inherit; font-size: 14px; resize: none; }
.composer button { display: flex; align-items: center; gap: 5px; min-height: 40px; padding: 0 14px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); color: var(--ink1); font: inherit; font-size: 14px; cursor: pointer; }
.composer button.primary { border-color: var(--olive); background: var(--olive); color: #fff; }
.composer button.stop { border-color: color-mix(in srgb, var(--danger, #c0392b) 45%, var(--line)); color: var(--danger, #c0392b); }
.composer button:disabled { opacity: 0.55; cursor: default; }
</style>

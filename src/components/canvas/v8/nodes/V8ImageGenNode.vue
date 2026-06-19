<script setup lang="ts">
/** V8ImageGenNode — webhuabu Phase 1b: 真实 API + 模型选择器 + SHA cache + state machine */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import NodeFrame from './NodeFrame.vue'
import { useCanvasStore } from '@/stores/canvasStore'
import { useAgentStore } from '@/stores/agentStore'
import { useV8NodeBehavior } from '@/components/canvas/v8/composables/useV8NodeBehavior'
import { generateImage, type ImageGenParams } from '@/api/media-generation'
import type { CanvasNode } from '@/types/canvas'

const shaCache = new Map<string, { output: string; ts: number }>()
async function sha256(str: string) { const b = new TextEncoder().encode(str); const h = await crypto.subtle.digest('SHA-256', b); return Array.from(new Uint8Array(h)).map(x=>x.toString(16).padStart(2,'0')).join('') }

const props = defineProps<{id:string;data?:any;selected?:boolean}>()
const cs = useCanvasStore()
const agentStore = useAgentStore()
const node = computed(()=>({id:props.id,data:props.data} as CanvasNode))
const {onResizeHandlePointerDown} = useV8NodeBehavior(node.value,{})

const d=computed(()=>props.data||{})

// ─── 模型选择 ───
const imageModels = computed(() => agentStore.imageModels)
const model = computed({get:()=>d.value.model||imageModels.value[0]?.id||'gpt-image-2',set:v=>cs.updateNodeData(props.id,{model:v})})

// ─── 参数 ───
const ratio=computed({get:()=>d.value.ratio||'16:9',set:v=>cs.updateNodeData(props.id,{ratio:v})})
const quality=computed({get:()=>d.value.quality||'high',set:v=>cs.updateNodeData(props.id,{quality:v})})
const prompt=computed({get:()=>d.value.prompt||'',set:v=>cs.updateNodeData(props.id,{prompt:v})})
const status=computed(()=>d.value.status||'idle')
const outputUrl=computed(()=>d.value.url||'')
const error=computed(()=>d.value.error||'')

// ─── 执行 ───
async function run(){
  // 回滚 flag：走假数据
  if (localStorage.getItem('jc_canvas_fake_media') === 'true') {
    await fakeRun()
    return
  }

  if (!prompt.value.trim()) {
    cs.updateNodeData(props.id, { status: 'error', error: '请输入提示词' })
    return
  }

  const key=JSON.stringify({p:prompt.value,m:model.value,r:ratio.value,q:quality.value})
  const sig=await sha256(key)
  if(shaCache.has(sig)){
    cs.updateNodeData(props.id,{status:'success',url:shaCache.get(sig)!.output})
    return
  }

  cs.updateNodeData(props.id,{status:'submitting',error:''})
  try {
    const params: ImageGenParams = {
      model: model.value,
      prompt: prompt.value,
      aspectRatio: ratio.value,
    }
    const result = await generateImage(params, (elapsed, _status) => {
      if (_status === 'polling') cs.updateNodeData(props.id, { status: 'polling' })
    })
    const url = result.url || ''
    if (url) {
      shaCache.set(sig,{output:url,ts:Date.now()})
      cs.updateNodeData(props.id,{status:'success',url})
    } else {
      cs.updateNodeData(props.id,{status:'error',error:'生成成功但未返回图片URL'})
    }
  } catch (e: any) {
    cs.updateNodeData(props.id,{status:'error',error:e?.message||'图片生成失败'})
  }
}

// ─── 假数据回退 ───
async function fakeRun(){
  const key=JSON.stringify({p:prompt.value,r:ratio.value,q:quality.value})
  const sig=await sha256(key)
  if(shaCache.has(sig)){ cs.updateNodeData(props.id,{status:'success',url:shaCache.get(sig)!.output}); return }
  cs.updateNodeData(props.id,{status:'submitting'})
  await new Promise(r=>setTimeout(r,300))
  cs.updateNodeData(props.id,{status:'polling'})
  await new Promise(r=>setTimeout(r,900))
  const url=`https://example.com/v8-img-${Date.now()}.png`
  shaCache.set(sig,{output:url,ts:Date.now()})
  cs.updateNodeData(props.id,{status:'success',url})
}

// Wire global run path
const v8ExecHandler = (ev: Event) => {
  const detail = (ev as CustomEvent).detail || {}
  if (detail.id === props.id) { run() }
}
onMounted(() => window.addEventListener('v8-execute-node', v8ExecHandler))
onUnmounted(() => window.removeEventListener('v8-execute-node', v8ExecHandler))
</script>

<template>
  <NodeFrame :id="id" label="图片生成" icon="image" role="generate" :status="status" :error="error" :selected="selected" executable show-stop @run="run" @stop="()=>cs.updateNodeData(id,{status:'cancelled'})" @delete="$emit('delete',$event)" @resize-start="onResizeHandlePointerDown">
    <Handle id="left-ref" type="target" :position="Position.Left" :style="{background:'#f59e0b',width:10,height:10,border:'none'}"/>
    <Handle id="right-result" type="source" :position="Position.Right" :style="{background:'#10b981',width:10,height:10,border:'none'}"/>
    <div class="v8-media">
      <!-- 模型选择器 -->
      <div class="v8-field">
        <label>模型</label>
        <select v-model="model" class="v8-select">
          <option v-for="m in imageModels" :key="m.id" :value="m.id">{{ m.label || m.id }}</option>
        </select>
      </div>
      <!-- 参数 -->
      <div class="v8-params">
        <label>比例<select v-model="ratio"><option>16:9</option><option>1:1</option><option>9:16</option></select></label>
        <label>质量<select v-model="quality"><option>high</option><option>medium</option></select></label>
      </div>
      <!-- 提示词 -->
      <textarea v-model="prompt" class="v8-prompt" placeholder="图片提示词" rows="2"/>
      <!-- 结果 -->
      <img v-if="outputUrl" :src="outputUrl" style="max-width:100%;border-radius:6px;margin-top:4px"/>
      <!-- 错误 -->
      <div v-if="error" class="v8-error">{{ error }}</div>
    </div>
  </NodeFrame>
</template>
<style scoped>
.v8-media{padding:6px 8px;font-size:12px;display:flex;flex-direction:column;gap:6px}
.v8-field{display:flex;flex-direction:column;gap:2px}
.v8-field label{font-size:10px;color:var(--ink3)}
.v8-select{width:100%;font-size:12px;border:1px solid var(--border);border-radius:4px;padding:3px 6px;background:var(--surface);color:var(--ink1)}
.v8-params{display:flex;gap:8px}
.v8-params label{font-size:10px;flex:1;display:flex;flex-direction:column;gap:2px}
.v8-params select{font-size:11px;border:1px solid var(--border);border-radius:4px;padding:2px 4px;background:var(--surface)}
.v8-prompt{width:100%;font-size:12px;border:1px solid var(--border);border-radius:4px;padding:4px;background:var(--surface);color:var(--ink1);resize:vertical}
.v8-error{font-size:10px;color:#f87171;background:rgba(239,68,68,.1);border-radius:4px;padding:4px 6px}
</style>

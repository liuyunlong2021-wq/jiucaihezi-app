<script setup lang="ts">
/** V8AudioGenNode — webhuabu Phase 1b: 真实 API + 模型选择器 + SHA cache + state machine */
import { computed, onMounted, onUnmounted } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import NodeFrame from './NodeFrame.vue'
import { useCanvasStore } from '@/stores/canvasStore'
import { useAgentStore } from '@/stores/agentStore'
import { useV8NodeBehavior } from '@/components/canvas/v8/composables/useV8NodeBehavior'
import { generateAudio, type AudioGenParams } from '@/api/media-generation'
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
const audioModels = computed(() => agentStore.audioModels)
const model = computed({get:()=>d.value.model||audioModels.value[0]?.id||'suno-custom-song',set:v=>cs.updateNodeData(props.id,{model:v})})

// ─── 参数 ───
const title=computed({get:()=>d.value.title||'',set:v=>cs.updateNodeData(props.id,{title:v})})
const tags=computed({get:()=>d.value.tags||'',set:v=>cs.updateNodeData(props.id,{tags:v})})
const prompt=computed({get:()=>d.value.prompt||'',set:v=>cs.updateNodeData(props.id,{prompt:v})})
const makeInstrumental=computed({get:()=>d.value.makeInstrumental||false,set:v=>cs.updateNodeData(props.id,{makeInstrumental:v})})
const status=computed(()=>d.value.status||'idle')
const outputUrl=computed(()=>d.value.url||'')
const error=computed(()=>d.value.error||'')

async function run(){
  if (localStorage.getItem('jc_canvas_fake_media') === 'true') { await fakeRun(); return }
  if (!prompt.value.trim()) { cs.updateNodeData(props.id, { status: 'error', error: '请输入歌词/描述' }); return }

  const key=JSON.stringify({p:prompt.value,m:model.value,t:title.value,g:tags.value})
  const sig=await sha256(key)
  if(shaCache.has(sig)){ cs.updateNodeData(props.id,{status:'success',url:shaCache.get(sig)!.output}); return }
  cs.updateNodeData(props.id,{status:'submitting',error:''})
  try {
    const params: AudioGenParams = { model: model.value, prompt: prompt.value, title: title.value, tags: tags.value, makeInstrumental: makeInstrumental.value }
    const result = await generateAudio(params, (_elapsed, _status) => {
      if (_status === 'polling') cs.updateNodeData(props.id, { status: 'polling' })
    })
    const url = result.url || ''
    if (url) { shaCache.set(sig,{output:url,ts:Date.now()}); cs.updateNodeData(props.id,{status:'success',url}) }
    else { cs.updateNodeData(props.id,{status:'error',error:'生成成功但未返回音频URL'}) }
  } catch (e: any) { cs.updateNodeData(props.id,{status:'error',error:e?.message||'音频生成失败'}) }
}

async function fakeRun(){
  const key=JSON.stringify({p:prompt.value,t:title.value,g:tags.value})
  const sig=await sha256(key)
  if(shaCache.has(sig)){ cs.updateNodeData(props.id,{status:'success',url:shaCache.get(sig)!.output}); return }
  cs.updateNodeData(props.id,{status:'submitting'})
  await new Promise(r=>setTimeout(r,300))
  cs.updateNodeData(props.id,{status:'polling'})
  await new Promise(r=>setTimeout(r,1200))
  const url=`https://example.com/v8-audio-${Date.now()}.mp3`
  shaCache.set(sig,{output:url,ts:Date.now()})
  cs.updateNodeData(props.id,{status:'success',url})
}

const v8ExecHandler = (ev: Event) => { const detail = (ev as CustomEvent).detail || {}; if (detail.id === props.id) run() }
onMounted(() => window.addEventListener('v8-execute-node', v8ExecHandler))
onUnmounted(() => window.removeEventListener('v8-execute-node', v8ExecHandler))
</script>

<template>
  <NodeFrame :id="id" label="音频生成" icon="music_note" role="generate" :status="status" :selected="selected" executable show-stop @run="run" @stop="()=>cs.updateNodeData(id,{status:'cancelled'})" @delete="$emit('delete',$event)" @resize-start="onResizeHandlePointerDown">
    <Handle id="left-ref" type="target" :position="Position.Left" :style="{background:'#f59e0b',width:10,height:10,border:'none'}"/>
    <Handle id="right-result" type="source" :position="Position.Right" :style="{background:'#10b981',width:10,height:10,border:'none'}"/>
    <div class="v8-media">
      <!-- 模型选择 -->
      <div class="v8-field">
        <label>模型</label>
        <select v-model="model" class="v8-select">
          <option v-for="m in audioModels" :key="m.id" :value="m.id">{{ m.label || m.id }}</option>
        </select>
      </div>
      <!-- 参数 -->
      <div class="v8-params">
        <label>标题<input v-model="title" placeholder="歌曲名" class="v8-input"/></label>
        <label>标签<input v-model="tags" placeholder="pop,rock" class="v8-input"/></label>
      </div>
      <label class="v8-check"><input type="checkbox" v-model="makeInstrumental"/> 纯音乐</label>
      <textarea v-model="prompt" class="v8-prompt" placeholder="歌词/描述" rows="2"/>
      <audio v-if="outputUrl" :src="outputUrl" controls style="width:100%;margin-top:4px"/>
      <div v-if="error" class="v8-error">{{ error }}</div>
    </div>
  </NodeFrame>
</template>
<style scoped>.v8-media{padding:6px 8px;font-size:12px;display:flex;flex-direction:column;gap:6px}
.v8-field{display:flex;flex-direction:column;gap:2px}
.v8-field label{font-size:10px;color:var(--ink3)}
.v8-select{width:100%;font-size:12px;border:1px solid var(--border);border-radius:4px;padding:3px 6px;background:var(--surface);color:var(--ink1)}
.v8-params{display:flex;gap:8px}
.v8-params label{font-size:10px;flex:1;display:flex;flex-direction:column;gap:2px}
.v8-input{font-size:11px;border:1px solid var(--border);border-radius:4px;padding:2px 4px;background:var(--surface);color:var(--ink1)}
.v8-check{font-size:11px;display:flex;align-items:center;gap:4px;cursor:pointer}
.v8-prompt{width:100%;font-size:12px;border:1px solid var(--border);border-radius:4px;padding:4px;background:var(--surface);color:var(--ink1);resize:vertical}
.v8-error{font-size:10px;color:#f87171;background:rgba(239,68,68,.1);border-radius:4px;padding:4px 6px}</style>

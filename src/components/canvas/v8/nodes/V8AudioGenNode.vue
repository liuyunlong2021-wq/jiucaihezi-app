<script setup lang="ts">
/** V8AudioGenNode — 3-layer audio (style/length + prompt) + SHA cache + state machine */
import { computed, onMounted, onUnmounted } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import NodeFrame from './NodeFrame.vue'
import { useCanvasStore } from '@/stores/canvasStore'
import { useV8NodeBehavior } from '@/components/canvas/v8/composables/useV8NodeBehavior'
import type { CanvasNode } from '@/types/canvas'

const shaCache = new Map<string, { output: string; ts: number }>()
async function sha256(str: string) { const b = new TextEncoder().encode(str); const h = await crypto.subtle.digest('SHA-256', b); return Array.from(new Uint8Array(h)).map(x=>x.toString(16).padStart(2,'0')).join('') }

const props = defineProps<{id:string;data?:any;selected?:boolean}>()
const cs = useCanvasStore()
const node = computed(()=>({id:props.id,data:props.data} as CanvasNode))
const {onResizeHandlePointerDown} = useV8NodeBehavior(node.value,{})

const d=computed(()=>props.data||{})
const style=computed({get:()=>d.value.style||'suno',set:v=>cs.updateNodeData(props.id,{style:v})})
const length=computed({get:()=>d.value.length||'1:30',set:v=>cs.updateNodeData(props.id,{length:v})})
const prompt=computed({get:()=>d.value.prompt||'',set:v=>cs.updateNodeData(props.id,{prompt:v})})
const status=computed(()=>d.value.status||'idle')
const outputUrl=computed(()=>d.value.url||'')

async function run(){
  const key=JSON.stringify({p:prompt.value,s:style.value,l:length.value})
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

// Wire global run path to this V8 node's full state machine for 14-node completeness
const v8ExecHandler = (ev: Event) => {
  const detail = (ev as CustomEvent).detail || {}
  if (detail.id === props.id) {
    run()
  }
}
onMounted(() => window.addEventListener('v8-execute-node', v8ExecHandler))
onUnmounted(() => window.removeEventListener('v8-execute-node', v8ExecHandler))
</script>

<template>
  <NodeFrame :id="id" label="音频生成" icon="music_note" role="generate" :status="status" :selected="selected" executable show-stop @run="run" @stop="()=>cs.updateNodeData(id,{status:'cancelled'})" @delete="$emit('delete',$event)" @resize-start="onResizeHandlePointerDown">
    <Handle id="left-ref" type="target" :position="Position.Left" :style="{background:'#f59e0b',width:10,height:10,border:'none'}"/>
    <Handle id="right-result" type="source" :position="Position.Right" :style="{background:'#10b981',width:10,height:10,border:'none'}"/>
    <div class="v8-media">
      <div class="v8-params"><label>风格<select v-model="style"><option>suno</option><option>custom</option></select></label><label>时长<select v-model="length"><option>0:30</option><option>1:30</option><option>2:30</option></select></label></div>
      <textarea v-model="prompt" class="v8-prompt" placeholder="歌词/描述" rows="2"/>
      <audio v-if="outputUrl" :src="outputUrl" controls style="width:100%;margin-top:4px"/>
    </div>
  </NodeFrame>
</template>
<style scoped>.v8-media{padding:6px 8px;font-size:12px}.v8-params{display:flex;gap:8px}.v8-params label{font-size:10px;flex:1}.v8-prompt{width:100%;font-size:12px;border:1px solid var(--border);border-radius:4px;padding:4px;background:var(--surface)}</style>

<script setup lang="ts">/* LLMNode — 1:1 对照 T8 LLMNode.tsx · 云端 LLM 文本生成 */
import { ref, computed } from 'vue'
import { Handle, Position, useNodeConnections, useNodesData } from '@vue-flow/core'
import { useCanvasStore } from '@/stores/canvasStore'
import { getApiKey } from '@/services/newApiAuth'
import { buildGatewayHeaders, getGatewayBaseUrl } from '@/services/newApiClient'
const props=defineProps<{id:string;data:any;selected?:boolean}>()
const cs=useCanvasStore();const d=computed(()=>props.data||{})
const error=ref<string|null>(null)
const modelId=computed({get:()=>d.value.modelId||'claude-sonnet-4-6',set:v=>cs.updateNodeData(props.id,{modelId:v})})
const sysPrompt=computed({get:()=>d.value.systemPrompt||'',set:v=>cs.updateNodeData(props.id,{systemPrompt:v})})
const prompt=computed({get:()=>d.value.prompt||'',set:v=>cs.updateNodeData(props.id,{prompt:v})})
const status=computed(()=>d.value.status||'idle')
const output=computed(()=>d.value.outputContent||d.value.reply||'')
const conns=useNodeConnections({ nodeId: props.id,handleType:'target'})
const upIds=computed(()=>[...new Set(conns.value.map(c=>c.source))])
const upNodes=useNodesData(upIds)
const upPrompt=computed(()=>{const list=Array.isArray(upNodes.value)?upNodes.value:[];return list.map(n=>{const ud=(n as any)?.data||{};return ud.prompt||ud.content||ud.outputText||ud.reply||''}).filter(Boolean).join('\n\n')})
const fp=computed(()=>(upPrompt.value||prompt.value||'').trim())
async function run(){
  error.value=null;if(!fp.value){error.value='缺少 prompt';return}
  cs.updateNodeData(props.id,{status:'generating',error:'',outputContent:''})
  try{
    const key=getApiKey();if(!key)throw new Error('请先登录')
    const msgs:any[]=[]
    if(sysPrompt.value.trim())msgs.push({role:'system',content:sysPrompt.value})
    msgs.push({role:'user',content:fp.value})
    const res=await fetch(`${getGatewayBaseUrl()}/v1/chat/completions`,{method:'POST',headers:{...buildGatewayHeaders(),'Content-Type':'application/json'},body:JSON.stringify({model:modelId.value,messages:msgs,stream:false})})
    if(!res.ok){const t=await res.text().catch(()=>'');throw new Error(`HTTP ${res.status}: ${t.slice(0,200)}`)}
    const j=await res.json()
    const text=j.choices?.[0]?.message?.content||j.content||j.reply||''
    cs.updateNodeData(props.id,{status:'success',progress:100,outputContent:text,reply:text})
  }catch(e:any){error.value=e?.message||'生成失败';cs.updateNodeData(props.id,{status:'error',error:e?.message})}
}</script>
<template>
  <div class="ll" :class="{sel:selected}" :style="{borderColor:selected?'#10b981':'var(--border)'}">
    <Handle type="target" :position="Position.Left" :style="{background:'#10b981',width:10,height:10,border:'none'}" />
    <Handle type="source" :position="Position.Right" :style="{background:'#10b981',width:10,height:10,border:'none'}" />
    <div class="ll-hd"><div class="ll-hd-ic" style="background:rgba(16,185,129,.18);color:#6ee7b7"><span class="mso" style="font-size:13px">smart_toy</span></div><div class="ll-hd-lb">LLM</div></div>
    <div class="ll-bd" @mousedown.stop>
      <div><label class="ll-lb">模型</label><select v-model="modelId" class="ll-inp"><option value="claude-sonnet-4-6">Claude Sonnet 4</option><option value="gpt-5">GPT-5</option><option value="gemini-2.5-pro">Gemini 2.5 Pro</option></select></div>
      <div><label class="ll-lb">System Prompt</label><textarea v-model="sysPrompt" class="ll-ta" placeholder="系统提示词(可选)" rows="2" /></div>
      <div><label class="ll-lb">User Prompt(优先取上游 text)</label><textarea v-model="prompt" class="ll-ta" placeholder="备用:无上游连接时使用" rows="3" /><div v-if="upPrompt" class="ll-up-txt">上游: {{upPrompt.slice(0,100)}}{{upPrompt.length>100?'…':''}}</div></div>
      <button class="ll-run" :disabled="status==='generating'" @click="run"><span v-if="status==='generating'" class="mso ll-spin" style="font-size:12px">progress_activity</span><span v-else class="mso" style="font-size:12px">auto_awesome</span> {{status==='generating'?'生成中...':'生成'}}</button>
      <div v-if="error" class="ll-err"><span class="mso" style="font-size:11px">error</span>{{error}}</div>
    </div>
    <div v-if="output" class="ll-out">{{ output }}</div>
  </div>
</template>
<style scoped>
.ll{width:300px;border:2px solid var(--border);border-radius:12px;background:var(--paper);box-shadow:var(--jc-shadow-sm);color:var(--ink1)}.ll.sel{border-color:#10b981}
.ll-hd{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--border2)}.ll-hd-ic{width:24px;height:24px;border-radius:6px;display:flex;align-items:center;justify-content:center}.ll-hd-lb{flex:1;font-size:13px;font-weight:600}
.ll-bd{padding:10px;display:flex;flex-direction:column;gap:8px}.ll-lb{font-size:10px;color:var(--ink3);display:block;margin-bottom:4px}
.ll-inp{width:100%;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--ink1);padding:5px 8px;font-size:11px;outline:none;font:inherit}
.ll-ta{width:100%;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--ink1);padding:6px 8px;font-size:11px;outline:none;resize:vertical;font:inherit;min-height:40px}.ll-ta:focus{border-color:#10b981}
.ll-up-txt{font-size:10px;color:var(--ink3);padding:4px 6px;background:var(--surface);border-radius:4px;word-break:break-all}
.ll-run{width:100%;display:flex;align-items:center;justify-content:center;gap:6px;padding:6px;border-radius:6px;border:none;background:rgba(16,185,129,.2);color:#10b981;font-size:12px;font-weight:500;cursor:pointer}.ll-run:disabled{opacity:.5}
.ll-spin{animation:ll-spin 1s linear infinite}@keyframes ll-spin{to{transform:rotate(360deg)}}
.ll-err{display:flex;align-items:flex-start;gap:4px;font-size:10px;color:#f87171;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.2);border-radius:4px;padding:4px 8px}
.ll-out{border-top:1px solid var(--border2);padding:8px;font-size:12px;white-space:pre-wrap;max-height:200px;overflow:auto}
</style>

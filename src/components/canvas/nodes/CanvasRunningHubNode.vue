<script setup lang="ts">
/**
 * RunningHubNode — 1:1 对照 T8-penguin-canvas RunningHubNode.tsx (862 行)
 *
 * 功能：webappId 搜索 → 拉取 nodeInfoList 表单 → 填参 → 提交 RH 任务 → 轮询
 */
import { ref, computed, watch, onUnmounted, nextTick } from 'vue'
import { Handle, Position, useNodeConnections, useNodesData } from '@vue-flow/core'
import { useCanvasStore } from '@/stores/canvasStore'
import { fetchRhAppInfo, submitRh, queryRh, uploadRhAsset } from '@/canvas/services/canvasGeneration'

const props = defineProps<{ id: string; data: any; selected?: boolean; type?: string }>()
const canvasStore = useCanvasStore()

const d = computed(() => props.data || {})
const useWallet = computed(() => props.type === 'runninghubWallet')
const titleText = computed(() => useWallet.value ? 'RH钱包应用' : 'RunningHub')

// 配色
const accent = computed(() => useWallet.value
  ? { ring:'#a78bfa', shadow:'rgba(139,92,246,.4)', dot:'rgba(139,92,246,.2)', dotInk:'#c4b5fd', dotEdge:'rgba(139,92,246,.45)', handle:'#a78bfa', subBg:'rgba(139,92,246,.1)', sub:'#c4b5fd', tag:'#c4b5fd', primary:'rgba(139,92,246,.2)', spin:'#c4b5fd' }
  : { ring:'#06b6d4', shadow:'rgba(6,182,212,.4)', dot:'rgba(6,182,212,.2)', dotInk:'#67e8f9', dotEdge:'rgba(6,182,212,.45)', handle:'#06b6d4', subBg:'rgba(6,182,212,.1)', sub:'#67e8f9', tag:'#67e8f9', primary:'rgba(6,182,212,.2)', spin:'#67e8f9' })

// 状态
const error = ref<string | null>(null)
const fetching = ref(false)
const pollTimer = ref<number | null>(null)
const webappId = computed({ get:()=>d.value.webappId||'', set:v=>canvasStore.updateNodeData(props.id,{webappId:v}) })
const instanceType = computed({ get:()=>d.value.instanceType||'', set:v=>canvasStore.updateNodeData(props.id,{instanceType:v}) })
const status = computed(()=>d.value.status||'idle')
const taskId = computed(()=>d.value.taskId)
const urls = computed<string[]>(()=>d.value.urls||[])
const appInfo = computed(()=>d.value.appInfo)
const paramValues = computed<Record<string,{value:string;sourceFromUpstream?:boolean}>>(()=>d.value.paramValues||{})
const isBusy = computed(()=>status.value==='submitting'||status.value==='polling')
const nodeInfoList = computed<any[]>(()=>appInfo.value?.nodeInfoList||[])

// 上游订阅
const conns = useNodeConnections({ nodeId: props.id, handleType: 'target' })
const upstreamIds = computed(()=>[...new Set(conns.value.map(c=>c.source))])
const upstreamNodes = useNodesData(upstreamIds)

onUnmounted(()=>{ if(pollTimer.value){clearInterval(pollTimer.value);pollTimer.value=null} })

// ── 辅助 ──
function inferValueType(ft: string|undefined): 'text'|'number'|'image'|'video'|'audio' {
  const t=String(ft||'').toUpperCase()
  if(t==='IMAGE')return'image';if(t==='VIDEO')return'video';if(t==='AUDIO')return'audio'
  if(t==='NUMBER'||t==='FLOAT'||t==='INTEGER'||t==='INT')return'number'
  return'text'
}
function paramKey(nid:any,fn:any){return`${nid}::${fn}`}
function extractDefaultValue(it:any):string{let v=it?.fieldValue;if(Array.isArray(v))v=v[0];if(v==null)return'';return typeof v==='object'?'':String(v)}
function extractFieldOptions(it:any):(string|number)[]|null{
  const cs=[it?.fieldData,it?.options,it?.list,it?.values,it?.enum,it?.choices,it?.items,it?.selectOptions,it?.dropdown]
  for(const c of cs){if(!Array.isArray(c)||!c.length)continue;if(c.every((x:any)=>typeof x==='string'||typeof x==='number'))return c;if(c.every((x:any)=>x&&typeof x==='object'&&('value'in x||'label'in x||'name'in x)))return c.map((x:any)=>(x.value??x.label??x.name)).filter((v:any)=>v!=null)}
  const ft=String(it?.fieldType||'').toUpperCase()
  if((ft==='LIST'||ft==='SELECT'||ft==='DROPDOWN')&&Array.isArray(it?.fieldValue)){const arr=it.fieldValue;if(arr.length&&arr.every((x:any)=>typeof x==='string'||typeof x==='number'))return arr}
  return null
}

// 简单上游素材收集
function findUpstreamUrl(kind:'image'|'video'|'audio', idx=0):string{
  const list=Array.isArray(upstreamNodes.value)?upstreamNodes.value:[]
  const urls:string[]=[]
  for(const n of list){const ud=(n as any)?.data||{}
    const field=kind==='image'?'imageUrl':kind==='video'?'videoUrl':'audioUrl'
    const arrF=kind==='image'?'imageUrls':kind==='video'?'videoUrls':'audioUrls'
    if(ud[field])urls.push(String(ud[field]))
    if(Array.isArray(ud[arrF]))urls.push(...ud[arrF].map(String))
  }
  return urls[idx]||''
}
const upstreamImageUrls=computed(()=>{const list=Array.isArray(upstreamNodes.value)?upstreamNodes.value:[];const out:string[]=[];for(const n of list){const ud=(n as any)?.data||{};if(ud.imageUrl)out.push(String(ud.imageUrl));if(Array.isArray(ud.imageUrls))out.push(...ud.imageUrls.map(String))}return out})
const upstreamVideoUrls=computed(()=>{const list=Array.isArray(upstreamNodes.value)?upstreamNodes.value:[];const out:string[]=[];for(const n of list){const ud=(n as any)?.data||{};if(ud.videoUrl)out.push(String(ud.videoUrl));if(Array.isArray(ud.videoUrls))out.push(...ud.videoUrls.map(String))}return out})
const upstreamAudioUrls=computed(()=>{const list=Array.isArray(upstreamNodes.value)?upstreamNodes.value:[];const out:string[]=[];for(const n of list){const ud=(n as any)?.data||{};if(ud.audioUrl)out.push(String(ud.audioUrl));if(Array.isArray(ud.audioUrls))out.push(...ud.audioUrls.map(String))}return out})

function setParam(k:string,patch:Partial<{value:string;sourceFromUpstream:boolean}>){
  const cur=paramValues.value[k]||{value:''}
  const next={...paramValues.value,[k]:{...cur,...patch}}
  canvasStore.updateNodeData(props.id,{paramValues:next})
}

// 上游媒体字段自动同步
const fieldKindIndex=computed(()=>{
  const m:Record<string,number>={};const cnt:Record<string,number>={image:0,video:0,audio:0}
  for(const it of nodeInfoList.value){
    const vt=inferValueType(it?.fieldType)
    if(vt==='image'||vt==='video'||vt==='audio'){m[paramKey(it.nodeId,it.fieldName)]=cnt[vt]++}
  }
  return m
})

watch([upstreamImageUrls,upstreamVideoUrls,upstreamAudioUrls,appInfo],()=>{
  if(!nodeInfoList.value.length)return
  let changed=false;const next={...paramValues.value}
  const cnt:Record<string,number>={image:0,video:0,audio:0}
  for(const it of nodeInfoList.value){
    const vt=inferValueType(it?.fieldType);if(vt!=='image'&&vt!=='video'&&vt!=='audio')continue
    const k=paramKey(it.nodeId,it.fieldName);const cur=next[k]
    const idx=cnt[vt]++;const upUrl=findUpstreamUrl(vt,idx)
    if(!upUrl)continue
    if(cur?.sourceFromUpstream===false)continue
    if(cur?.sourceFromUpstream===true){if(upUrl!==cur.value){next[k]={...cur,value:upUrl};changed=true}}
    else{next[k]={value:upUrl,sourceFromUpstream:true};changed=true}
  }
  if(changed)canvasStore.updateNodeData(props.id,{paramValues:next})
},{deep:true})

// ── API 调用 ──
async function fetchAppInfo(wid:string){
  try{
    const data=await fetchRhAppInfo(wid)
    const list=data?.nodeInfoList||[]
    const next:Record<string,{value:string;sourceFromUpstream?:boolean}>={...paramValues.value}
    for(const it of list){
      const k=paramKey(it.nodeId,it.fieldName);const vt=inferValueType(it?.fieldType)
      if(k in next)continue
      if(vt==='image'||vt==='video'||vt==='audio'){
        const upUrl=findUpstreamUrl(vt);next[k]={value:upUrl||'',sourceFromUpstream:true}
      }else{next[k]={value:extractDefaultValue(it)}}
    }
    canvasStore.updateNodeData(props.id,{appInfo:data,paramValues:next})
    return list
  }catch(e:any){throw e}
}

async function handleFetchInfo(){
  error.value=null
  if(!webappId.value){error.value='请先填写 webappId';return}
  fetching.value=true
  try{await fetchAppInfo(webappId.value)}
  catch(e:any){error.value=e?.message||'查询失败'}
  finally{fetching.value=false}
}

// 自动拉取：首次有 webappId+上游媒体+未拉取→静默拉
const autoFetched=ref(false)
watch([webappId,upstreamNodes,appInfo],()=>{
  if(autoFetched.value)return;if(!webappId.value)return;if(appInfo.value)return;if(fetching.value)return
  const hasMedia=!!(findUpstreamUrl('image')||findUpstreamUrl('video')||findUpstreamUrl('audio'))
  if(!hasMedia)return;autoFetched.value=true;handleFetchInfo()
})

// ── 提交 ──
function buildRawNodeInfoList():any[]{
  const seen=new Set<string>();const out:any[]=[]
  for(const it of nodeInfoList.value){
    const k=paramKey(it.nodeId,it.fieldName)
    const vt=inferValueType(it?.fieldType)
    const v=paramValues.value[k]?.value
    const fv=v!=null&&v!==''?v:extractDefaultValue(it)
    seen.add(k);out.push({nodeId:it.nodeId,fieldName:it.fieldName,fieldValue:fv,valueType:vt})
  }
  return out
}

async function handleRun(){
  error.value=null
  if(!webappId.value){error.value='请先填写 webappId';return}
  // 兜底拉取
  if(!nodeInfoList.value.length){try{await fetchAppInfo(webappId.value)}catch(e:any){error.value=e?.message||'拉取失败';return}}
  canvasStore.updateNodeData(props.id,{status:'submitting',error:'',urls:[],taskId:null})
  try{
    const rawList=buildRawNodeInfoList()
    // 上传媒体资源
    const payloadList=[]
    for(const it of rawList){
      let fv=it.fieldValue
      if(it.valueType==='image'||it.valueType==='video'||it.valueType==='audio'){
        if(fv&&/^https?:\/\//i.test(fv)){
          try{const up=await uploadRhAsset(fv);fv=up.fileName}
          catch(e:any){console.warn('RH上传素材失败',e?.message)}
        }
      }
      payloadList.push({nodeId:it.nodeId,fieldName:it.fieldName,fieldValue:fv})
    }
    const r=await submitRh({webappId:webappId.value,nodeInfoList:payloadList,instanceType:instanceType.value||undefined})
    const tid=r.taskId
    canvasStore.updateNodeData(props.id,{status:'polling',taskId:String(tid)})
    // 轮询
    await new Promise<void>((resolve,reject)=>{
      let elapsed=0
      pollTimer.value=window.setInterval(async()=>{
        elapsed++;if(elapsed>480){if(pollTimer.value){clearInterval(pollTimer.value);pollTimer.value=null};canvasStore.updateNodeData(props.id,{status:'error',error:'轮询超时'});error.value='轮询超时';reject(new Error('轮询超时'));return}
        try{
          const r=await queryRh(String(tid))
          if(r.status==='SUCCESS'){
            if(pollTimer.value){clearInterval(pollTimer.value);pollTimer.value=null}
            const list:string[]=Array.isArray(r.urls)?r.urls:(r as any).url?[(r as any).url]:[]
            const patch:any={status:'success',urls:list}
            if(list[0])patch.imageUrl=list[0]
            canvasStore.updateNodeData(props.id,patch);resolve()
          }else if(r.status==='FAILED'){
            if(pollTimer.value){clearInterval(pollTimer.value);pollTimer.value=null}
            const msg=r.failReason||r.code||'RH 任务失败'
            canvasStore.updateNodeData(props.id,{status:'error',error:String(msg)});error.value=String(msg);reject(new Error(String(msg)))
          }
        }catch(e:any){console.warn('RH轮询出错',e?.message)}
      },5000)
    })
  }catch(e:any){console.error('RH提交失败',e);error.value=e?.message||'提交失败';canvasStore.updateNodeData(props.id,{status:'error',error:e?.message})}
}

function handleStop(){if(pollTimer.value){clearInterval(pollTimer.value);pollTimer.value=null};canvasStore.updateNodeData(props.id,{status:'idle'})}
</script>

<template>
  <div class="rh" :class="{ sel: selected }" :style="{borderColor:selected?accent.ring:'var(--border)',boxShadow:selected?`0 0 20px ${accent.shadow}`:'var(--jc-shadow-sm)'}">
    <Handle type="target" :position="Position.Left" :style="{background:accent.handle,width:10,height:10,border:'none'}" />
    <Handle type="source" :position="Position.Right" :style="{background:accent.handle,width:10,height:10,border:'none'}" />

    <!-- 头部 -->
    <div class="rh-hd">
      <div class="rh-hd-ic" :style="{background:accent.dot,color:accent.dotInk,boxShadow:`inset 0 0 0 1px ${accent.dotEdge}`}">
        <span class="mso" style="font-size:13px">{{ useWallet?'wallet':'account_tree' }}</span>
      </div>
      <div class="rh-hd-tx">
        <div class="rh-hd-tt">{{ titleText }}</div>
        <div class="rh-hd-sub">{{ appInfo?.appName||appInfo?.name||(useWallet?'RH 钱包应用':'AI 工作流') }}</div>
      </div>
    </div>

    <div class="rh-bd" @mousedown.stop>
      <!-- 上游素材预览 -->
      <div v-if="upstreamImageUrls.length||upstreamVideoUrls.length||upstreamAudioUrls.length" class="rh-up-pv">
        <div class="rh-up-tt">上游素材 · {{ upstreamImageUrls.length+upstreamVideoUrls.length+upstreamAudioUrls.length }} 项</div>
        <div class="rh-up-gr">
          <img v-for="(u,i) in upstreamImageUrls.slice(0,4)" :key="'i'+i" :src="u" class="rh-up-th" />
          <video v-for="(u,i) in upstreamVideoUrls.slice(0,2)" :key="'v'+i" :src="u" class="rh-up-th" muted />
        </div>
      </div>

      <!-- Webapp ID -->
      <div>
        <label class="rh-lb">Webapp ID</label>
        <div class="rh-web-row">
          <input v-model="webappId" class="rh-inp rh-inp-flex" placeholder="1234567890" />
          <button class="rh-btn-sm" :disabled="fetching" title="拉取应用信息" @click="handleFetchInfo">
            <span class="mso" :class="{ 'rh-spin': fetching }" style="font-size:11px">{{ fetching?'progress_activity':'search' }}</span>
          </button>
        </div>
      </div>

      <!-- 参数表单 -->
      <div v-if="nodeInfoList.length" class="rh-form">
        <div class="rh-form-hd"><span>参数 ({{ nodeInfoList.length }})</span><span class="rh-form-hint">点击字段可编辑</span></div>
        <div v-for="(it,i) in nodeInfoList" :key="i" class="rh-field">
          <div class="rh-field-hd">
            <span class="rh-field-nm">{{ it.fieldName }}</span>
            <span class="rh-field-tp" :style="{color:accent.tag,background:accent.subBg}">{{ extractFieldOptions(it)?`select(${extractFieldOptions(it)!.length})`:inferValueType(it?.fieldType) }}</span>
            <span class="rh-field-nid">#{{ it.nodeId }}</span>
          </div>
          <div v-if="it?.description" class="rh-field-desc">{{ it.description }}</div>

          <!-- 媒体字段 -->
          <template v-if="inferValueType(it?.fieldType)==='image'||inferValueType(it?.fieldType)==='video'||inferValueType(it?.fieldType)==='audio'">
            <label class="rh-chk"><input type="checkbox" :checked="!!(paramValues[paramKey(it.nodeId,it.fieldName)]?.sourceFromUpstream)" @change="setParam(paramKey(it.nodeId,it.fieldName),{sourceFromUpstream:($event.target as HTMLInputElement).checked})" /> 从上游自动获取</label>
            <input class="rh-inp" :class="{ 'rh-inp-lock': paramValues[paramKey(it.nodeId,it.fieldName)]?.sourceFromUpstream }" :value="paramValues[paramKey(it.nodeId,it.fieldName)]?.value||''" :readonly="!!paramValues[paramKey(it.nodeId,it.fieldName)]?.sourceFromUpstream" :placeholder="paramValues[paramKey(it.nodeId,it.fieldName)]?.sourceFromUpstream?'(从上游自动填入)':inferValueType(it?.fieldType)+' url'" @input="setParam(paramKey(it.nodeId,it.fieldName),{value:($event.target as HTMLInputElement).value})" />
          </template>

          <!-- 下拉选项 -->
          <template v-else-if="extractFieldOptions(it)">
            <select class="rh-inp" :value="paramValues[paramKey(it.nodeId,it.fieldName)]?.value||''" @change="setParam(paramKey(it.nodeId,it.fieldName),{value:($event.target as HTMLSelectElement).value})">
              <option v-if="!extractFieldOptions(it)!.some(o=>String(o)===String(paramValues[paramKey(it.nodeId,it.fieldName)]?.value||''))" :value="paramValues[paramKey(it.nodeId,it.fieldName)]?.value||''">(当前) {{ paramValues[paramKey(it.nodeId,it.fieldName)]?.value||'' }}</option>
              <option v-if="!paramValues[paramKey(it.nodeId,it.fieldName)]?.value" value="">(选择)</option>
              <option v-for="(opt,oi) in extractFieldOptions(it)!" :key="oi" :value="String(opt)">{{ opt }}</option>
            </select>
          </template>

          <!-- 数字 -->
          <template v-else-if="inferValueType(it?.fieldType)==='number'">
            <input type="number" class="rh-inp" :value="paramValues[paramKey(it.nodeId,it.fieldName)]?.value||''" :placeholder="extractDefaultValue(it)" @input="setParam(paramKey(it.nodeId,it.fieldName),{value:($event.target as HTMLInputElement).value})" />
          </template>

          <!-- 文本 -->
          <template v-else>
            <textarea class="rh-inp rh-ta" :value="paramValues[paramKey(it.nodeId,it.fieldName)]?.value||''" :placeholder="extractDefaultValue(it)" rows="2" @input="setParam(paramKey(it.nodeId,it.fieldName),{value:($event.target as HTMLTextAreaElement).value})" />
          </template>
        </div>
      </div>

      <!-- 实例类型 -->
      <div>
        <label class="rh-lb">实例类型(可选)</label>
        <select v-model="instanceType" class="rh-inp">
          <option value="">默认</option><option value="plus">plus</option>
        </select>
      </div>

      <!-- 运行/停止按钮 -->
      <button v-if="!isBusy" class="rh-run" :style="{background:accent.primary,color:accent.dotInk}" @click="handleRun">
        <span class="mso" style="font-size:12px">auto_awesome</span> {{ useWallet?'运行钱包工作流':'运行工作流' }}
      </button>
      <button v-else class="rh-run rh-stop" @click="handleStop">
        <span class="mso" style="font-size:12px">stop</span> 停止
      </button>

      <!-- 轮询状态 -->
      <div v-if="isBusy" class="rh-poll"><span class="mso rh-spin" style="font-size:11px">progress_activity</span> {{ status==='submitting'?'提交任务...':'轮询中' }}<span v-if="taskId" class="rh-tid">{{ String(taskId).slice(0,10) }}…</span></div>

      <!-- 错误 -->
      <div v-if="error" class="rh-err"><span class="mso" style="font-size:11px">error</span>{{ error }}</div>
    </div>

    <!-- 输出预览 -->
    <div v-if="urls.length" class="rh-out">
      <template v-for="(u,i) in urls" :key="i">
        <img v-if="/\.(png|jpe?g|webp|gif)/i.test(u)" :src="u" class="rh-out-img" />
        <video v-if="/\.(mp4|webm|mov)/i.test(u)" :src="u" controls class="rh-out-vid" />
      </template>
    </div>
  </div>
</template>

<style scoped>
.rh { width:340px; border:2px solid var(--border); border-radius:12px; background:var(--paper); box-shadow:var(--jc-shadow-sm); color:var(--ink1); transition:border-color .15s,box-shadow .15s; }
.rh.sel { border-color:var(--olive-dark); }
.rh-hd { display:flex; align-items:center; gap:8px; padding:8px 12px; border-bottom:1px solid var(--border2); }
.rh-hd-ic { width:24px; height:24px; border-radius:6px; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
.rh-hd-tx { flex:1; min-width:0; }
.rh-hd-tt { font-size:13px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.rh-hd-sub { font-size:10px; color:var(--ink3); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.rh-bd { padding:10px; display:flex; flex-direction:column; gap:8px; }
.rh-lb { font-size:10px; color:var(--ink3); display:block; margin-bottom:4px; }
.rh-web-row { display:flex; gap:4px; }
.rh-inp { width:100%; border:1px solid var(--border); border-radius:6px; background:var(--surface); color:var(--ink1); padding:5px 8px; font-size:11px; outline:none; font:inherit; }
.rh-inp:focus { border-color:var(--olive); }
.rh-inp-flex { flex:1; }
.rh-inp-lock { opacity:.6; cursor:not-allowed; }
.rh-ta { min-height:36px; resize:vertical; }
.rh-btn-sm { display:flex; align-items:center; justify-content:center; border:1px solid var(--border); border-radius:6px; background:var(--surface); color:var(--ink2); cursor:pointer; padding:4px 8px; }
.rh-btn-sm:hover { background:var(--surface-alt); }
.rh-btn-sm:disabled { opacity:.5; }
.rh-spin { animation:rh-spin 1s linear infinite; }
@keyframes rh-spin { to { transform:rotate(360deg) } }

.rh-up-pv { border:1px solid var(--border2); border-radius:6px; padding:6px; }
.rh-up-tt { font-size:10px; color:var(--ink3); margin-bottom:4px; }
.rh-up-gr { display:flex; gap:4px; flex-wrap:wrap; }
.rh-up-th { width:60px; height:60px; border-radius:4px; object-fit:cover; background:#0003; }

.rh-form { border:1px solid var(--border2); border-radius:6px; padding:6px; max-height:300px; overflow-y:auto; display:flex; flex-direction:column; gap:6px; }
.rh-form-hd { display:flex; justify-content:space-between; font-size:10px; color:var(--ink3); }
.rh-form-hint { opacity:.5; }

.rh-field { padding-bottom:6px; border-bottom:1px solid var(--border2); display:flex; flex-direction:column; gap:4px; }
.rh-field:last-child { border-bottom:none; padding-bottom:0; }
.rh-field-hd { display:flex; align-items:center; gap:4px; font-size:10px; }
.rh-field-nm { font-weight:500; color:var(--ink1); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.rh-field-tp { padding:0 4px; border-radius:3px; font-size:9px; }
.rh-field-nid { color:var(--ink3); margin-left:auto; }
.rh-field-desc { font-size:9px; color:var(--ink3); }
.rh-chk { font-size:10px; color:var(--ink2); display:flex; align-items:center; gap:4px; cursor:pointer; }

.rh-run { width:100%; display:flex; align-items:center; justify-content:center; gap:6px; padding:6px; border-radius:6px; border:none; font-size:12px; font-weight:500; cursor:pointer; }
.rh-stop { background:var(--surface-alt)!important; color:var(--ink2)!important; }
.rh-poll { display:flex; align-items:center; gap:4px; font-size:10px; color:var(--ink3); }
.rh-tid { margin-left:auto; color:var(--ink3); }
.rh-err { display:flex; align-items:flex-start; gap:4px; font-size:10px; color:#f87171; background:rgba(239,68,68,.1); border:1px solid rgba(239,68,68,.2); border-radius:4px; padding:4px 8px; }

.rh-out { border-top:1px solid var(--border2); padding:8px; display:flex; flex-direction:column; gap:4px; }
.rh-out-img { width:100%; border-radius:6px; object-fit:cover; }
.rh-out-vid { width:100%; border-radius:6px; }
</style>

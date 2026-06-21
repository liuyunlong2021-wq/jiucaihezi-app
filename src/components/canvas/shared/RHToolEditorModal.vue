<script setup lang="ts">
/**
 * RHToolEditorModal — Phase F4，对齐 T8 RHToolEditorModal.tsx
 * RH 工作流参数模板可视化编辑器
 */
import { ref, computed, watch } from 'vue'
import { fetchRhAppInfo } from '@/canvas/services/canvasGeneration'
import type { RhTool, RhToolField } from '@/stores/canvasRhToolsStore'

const props = defineProps<{
  tool: RhTool | null
  visible: boolean
}>()

const emit = defineEmits<{
  save: [tool: RhTool]
  cancel: []
  'update:visible': [v: boolean]
}>()

// 本地编辑副本
const name = ref(props.tool?.name || '')
const webappId = ref(props.tool?.webappId || '')
const icon = ref(props.tool?.icon || '🚀')
const color = ref(props.tool?.color || 'olive')
const fields = ref<RhToolField[]>(props.tool?.fields?.map(f => ({ ...f })) || [])

watch(() => props.visible, (v) => {
  if (v) {
    name.value = props.tool?.name || ''
    webappId.value = props.tool?.webappId || ''
    icon.value = props.tool?.icon || '🚀'
    color.value = props.tool?.color || 'olive'
    fields.value = props.tool?.fields?.map(f => ({ ...f })) || []
  }
})

const fetching = ref(false)
const fetchError = ref<string | null>(null)

async function handleFetchParams() {
  fetchError.value = null
  if (!webappId.value.trim()) { fetchError.value = '请先填写 Webapp ID'; return }
  fetching.value = true
  try {
    const info = await fetchRhAppInfo(webappId.value.trim())
    const list = info?.nodeInfoList || []
    if (!list.length) { fetchError.value = '未拉取到参数列表'; return }
    // 构建字段
    const existingKeys = new Set(fields.value.map(f => `${f.nodeId}::${f.fieldName}`))
    for (const it of list) {
      const k = `${it.nodeId}::${it.fieldName}`
      if (existingKeys.has(k)) continue
      const ft = String(it.fieldType || '').toUpperCase()
      let fieldType: RhToolField['fieldType'] = 'text'
      if (ft === 'IMAGE') fieldType = 'image'
      else if (ft === 'VIDEO') fieldType = 'video'
      else if (ft === 'AUDIO') fieldType = 'audio'
      else if (ft === 'NUMBER' || ft === 'INTEGER' || ft === 'FLOAT') fieldType = 'number'
      else if (ft === 'SELECT' || ft === 'LIST' || ft === 'DROPDOWN') fieldType = 'select'

      fields.value.push({
        nodeId: String(it.nodeId),
        fieldName: String(it.fieldName),
        label: String(it.fieldName),
        fieldType,
        defaultValue: it.fieldValue ?? it.default ?? '',
      })
    }
  } catch (e: any) { fetchError.value = e?.message || '拉取失败' }
  finally { fetching.value = false }
}

function removeField(idx: number) { fields.value.splice(idx, 1) }

function handleSave() {
  if (!name.value.trim()) return
  if (!webappId.value.trim()) return
  const tool: RhTool = {
    id: props.tool?.id || '',
    name: name.value.trim(),
    icon: icon.value,
    color: color.value,
    webappId: webappId.value.trim(),
    fields: fields.value.filter(f => f.fieldName),
    createdAt: props.tool?.createdAt || Date.now(),
    updatedAt: Date.now(),
  }
  emit('save', tool)
}

const colors = [
  { k: 'olive', h: '#6B8E23' },
  { k: 'cyan', h: '#06b6d4' },
  { k: 'purple', h: '#a78bfa' },
  { k: 'orange', h: '#f59e0b' },
  { k: 'pink', h: '#ec4899' },
  { k: 'blue', h: '#3b82f6' },
]

const fieldTypes: { k: RhToolField['fieldType']; l: string }[] = [
  { k: 'text', l: '文本' },
  { k: 'number', l: '数字' },
  { k: 'image', l: '图片' },
  { k: 'video', l: '视频' },
  { k: 'audio', l: '音频' },
  { k: 'select', l: '下拉' },
]
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="rem-bg" @mousedown.self="emit('cancel')">
      <div class="rem">
        <div class="rem-hd">
          <span class="rem-tt">{{ tool ? '编辑 RH 工具' : '新建 RH 工具' }}</span>
          <button class="rem-x" @click="emit('cancel')"><JcIcon name="close" /></button>
        </div>

        <div class="rem-bd">
          <!-- 名称 -->
          <div class="rem-fld">
            <label class="rem-lb">工具名称</label>
            <input v-model="name" class="rem-inp" placeholder="我的工作流" />
          </div>

          <!-- Webapp ID -->
          <div class="rem-fld">
            <label class="rem-lb">Webapp ID</label>
            <div class="rem-row">
              <input v-model="webappId" class="rem-inp rem-inp-flex" placeholder="1234567890" />
              <button class="rem-btn" :disabled="fetching" @click="handleFetchParams">
                <JcIcon :name="fetching ? 'progress_activity' : 'cloud_download'" :class="{ 'rem-spin': fetching }" style="font-size:11px" />
                拉取参数
              </button>
            </div>
            <div v-if="fetchError" class="rem-err">{{ fetchError }}</div>
          </div>

          <!-- 参数模板 -->
          <div v-if="fields.length" class="rem-fld">
            <label class="rem-lb">参数模板 ({{ fields.length }})</label>
            <div class="rem-fields">
              <div v-for="(f, i) in fields" :key="i" class="rem-field">
                <div class="rem-field-hd">
                  <span class="rem-field-id">#{{ f.nodeId }} {{ f.fieldName }}</span>
                  <button class="rem-field-rm" @click="removeField(i)" title="移除"><JcIcon name="delete" /></button>
                </div>
                <div class="rem-field-rw">
                  <input v-model="f.label" class="rem-inp rem-inp-xs" placeholder="显示标签" />
                  <select v-model="f.fieldType" class="rem-inp rem-inp-xs">
                    <option v-for="ft in fieldTypes" :key="ft.k" :value="ft.k">{{ ft.l }}</option>
                  </select>
                </div>
                <input v-if="f.fieldType === 'text' || f.fieldType === 'number'" v-model="f.defaultValue" class="rem-inp rem-inp-xs" placeholder="默认值" />
              </div>
            </div>
          </div>
          <div v-else class="rem-empty">填写 Webapp ID 后点"拉取参数"</div>

          <!-- 图标+颜色 -->
          <div class="rem-fld">
            <label class="rem-lb">节点外观</label>
            <div class="rem-appr">
              <input v-model="icon" class="rem-inp rem-inp-xs" placeholder="🚀" maxlength="4" style="width:60px;text-align:center" />
              <div class="rem-cols">
                <button v-for="c in colors" :key="c.k" class="rem-col" :class="{ on: color === c.k }"
                  :style="{ background: c.h }" @click="color = c.k" />
              </div>
            </div>
          </div>
        </div>

        <div class="rem-ft">
          <button class="rem-btn rem-btn-ghost" @click="emit('cancel')">取消</button>
          <button class="rem-btn rem-btn-primary" :disabled="!name.trim() || !webappId.trim()" @click="handleSave">保存</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.rem-bg { position: fixed; inset: 0; z-index: 999; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; }
.rem { width: 520px; max-height: 80vh; background: var(--paper); border-radius: 14px; box-shadow: 0 20px 60px rgba(0,0,0,.3); display: flex; flex-direction: column; overflow: hidden; }
.rem-hd { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--border2); }
.rem-tt { font-size: 14px; font-weight: 600; }
.rem-x { border: none; background: none; color: var(--ink2); cursor: pointer; padding: 2px; }
.rem-bd { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.rem-fld { display: flex; flex-direction: column; gap: 4px; }
.rem-lb { font-size: 11px; color: var(--ink3); font-weight: 500; }
.rem-row { display: flex; gap: 6px; }
.rem-inp { border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--ink1); padding: 6px 8px; font-size: 11px; outline: none; font: inherit; width: 100%; }
.rem-inp:focus { border-color: var(--olive); }
.rem-inp-flex { flex: 1; }
.rem-inp-xs { padding: 4px 6px; font-size: 10px; width: 100%; }
.rem-btn { display: flex; align-items: center; gap: 4px; border: 1px solid var(--border); border-radius: 6px; padding: 5px 10px; font-size: 11px; cursor: pointer; background: var(--surface); color: var(--ink2); white-space: nowrap; }
.rem-btn:hover { background: var(--surface-alt); }
.rem-btn:disabled { opacity: .4; cursor: not-allowed; }
.rem-btn-primary { background: var(--olive); color: #fff; border-color: var(--olive); }
.rem-btn-primary:hover { background: var(--olive-dark); }
.rem-btn-ghost { border-color: transparent; }
.rem-spin { animation: rem-spin 1s linear infinite; }
@keyframes rem-spin { to { transform: rotate(360deg) } }
.rem-err { font-size: 10px; color: #f87171; }
.rem-empty { font-size: 11px; color: var(--ink3); text-align: center; padding: 16px 0; }
.rem-fields { display: flex; flex-direction: column; gap: 6px; max-height: 240px; overflow-y: auto; border: 1px solid var(--border2); border-radius: 6px; padding: 6px; }
.rem-field { border: 1px solid var(--border2); border-radius: 4px; padding: 6px; display: flex; flex-direction: column; gap: 4px; }
.rem-field-hd { display: flex; align-items: center; justify-content: space-between; }
.rem-field-id { font-size: 10px; font-weight: 500; color: var(--ink2); }
.rem-field-rm { border: none; background: none; color: var(--ink3); cursor: pointer; padding: 0; }
.rem-field-rm:hover { color: #f87171; }
.rem-field-rw { display: flex; gap: 4px; }
.rem-appr { display: flex; align-items: center; gap: 8px; }
.rem-cols { display: flex; gap: 4px; }
.rem-col { width: 20px; height: 20px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; }
.rem-col.on { border-color: var(--ink1); box-shadow: 0 0 6px rgba(0,0,0,.2); }
.rem-ft { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--border2); }
</style>

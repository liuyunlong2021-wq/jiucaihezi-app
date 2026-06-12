<script setup lang="ts">
/**
 * VaultPickerBar.vue — 输入框上方知识库选择器
 *
 * 布局：[知识库选择器▼]  [正在使用：xxx ×]
 * 镜像 SkillPickerBar 的 UI 模式
 */
import { ref, computed } from 'vue'
import { useVaultStore } from '@/stores/vaultStore'
import { emitEvent } from '@/utils/eventBus'

const vaultStore = useVaultStore()

const showPicker = ref(false)
const searchText = ref('')

const myVaults = computed(() => {
  const q = searchText.value.trim().toLowerCase()
  const vaults = vaultStore.vaults.filter(v => v.status === 'active')
  if (!q) return vaults
  return vaults.filter(v =>
    (v.name || '').toLowerCase().includes(q) ||
    (v.oneLineDesc || v.description || '').toLowerCase().includes(q) ||
    (v.keywords || []).some(k => k.toLowerCase().includes(q))
  )
})

function selectVault(id: string) {
  vaultStore.setActiveVault(id)
  emitEvent('vault-selected', { vaultId: id })
  showPicker.value = false
  searchText.value = ''
}

function clearVault() {
  vaultStore.setActiveVault(null)
  emitEvent('vault-cleared')
}
</script>

<template>
  <div class="vpb">
    <!-- 左：知识库选择器 -->
    <button class="vpb-picker" :class="{ active: showPicker }" @click="showPicker = !showPicker">
      <span class="mso" style="font-size:16px">library_books</span>
      <span>知识库</span>
      <span class="mso vpb-arrow">{{ showPicker ? 'expand_less' : 'expand_more' }}</span>
    </button>

    <!-- 中：正在使用 -->
    <div v-if="vaultStore.activeVault" class="vpb-current" @click="showPicker = !showPicker">
      <span class="mso" style="font-size:14px">folder</span>
      <span class="vpb-current-name">{{ vaultStore.activeVault.name }}</span>
      <span class="mso vpb-clear" @click.stop="clearVault">close</span>
    </div>
    <div v-else class="vpb-current off" @click="showPicker = !showPicker">
      <span class="mso" style="font-size:14px">folder_off</span>
      <span class="vpb-current-name">知识库关闭</span>
    </div>
  </div>

  <!-- 展开选择面板 -->
  <div v-if="showPicker" class="vpb-panel">
    <input v-model="searchText" class="vpb-search" placeholder="搜索知识库..." autofocus />
    <div class="vpb-list">
      <button
        v-for="vault in myVaults" :key="vault.id"
        class="vpb-item" :class="{ selected: vaultStore.activeVaultId === vault.id }"
        @click="selectVault(vault.id)"
      >
        <div class="vpb-item-name">
          <span v-if="vault.icon" class="mso" style="font-size:13px;margin-right:3px">{{ vault.icon }}</span>
          {{ vault.name }}
        </div>
        <div class="vpb-item-desc">{{ vault.oneLineDesc || vault.description || vault.type }}</div>
      </button>
      <div v-if="myVaults.length === 0" class="vpb-empty">
        {{ searchText ? '没有匹配的知识库' : '还没有知识库，去创建一个吧' }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.vpb {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--line);
}

.vpb-picker {
  display: flex; align-items: center; gap: 3px;
  padding: 4px 8px; border: 1px solid var(--line); border-radius: 6px;
  background: var(--paper); color: var(--ink2); cursor: pointer;
  font-size: 12px; font-weight: 600; font-family: inherit;
  transition: all .12s;
}
.vpb-picker:hover, .vpb-picker.active { border-color: var(--olive); color: var(--olive); }
.vpb-arrow { font-size: 16px; }

.vpb-current {
  display: flex; align-items: center; gap: 4px;
  padding: 3px 8px; border-radius: 6px;
  background: rgba(107,142,35,.1); color: var(--olive);
  font-size: 12px; font-weight: 600; cursor: pointer;
}
.vpb-current.off {
  background: var(--surface);
  color: var(--ink3);
}
.vpb-current-name {
  max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.vpb-clear { font-size: 14px; color: var(--ink3); cursor: pointer; margin-left: 2px; }
.vpb-clear:hover { color: #e53935; }

/* 展开面板 */
.vpb-panel {
  padding: 8px 12px; border-bottom: 1px solid var(--line);
  background: var(--paper); animation: vpb-slide .15s ease;
}
@keyframes vpb-slide { from { opacity:0; transform:translateY(-4px) } to { opacity:1; transform:none } }
.vpb-search {
  width: 100%; padding: 6px 10px; border: 1px solid var(--line); border-radius: 6px;
  background: var(--surface); color: var(--ink1); font-size: 12px; font-family: inherit;
  outline: none; margin-bottom: 6px;
}
.vpb-search:focus { border-color: var(--olive); }
.vpb-list { max-height: 180px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
.vpb-item {
  padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px;
  background: var(--surface); cursor: pointer; text-align: left;
  font-family: inherit; transition: all .12s;
}
.vpb-item:hover { border-color: var(--olive); background: rgba(107,142,35,.04); }
.vpb-item.selected { border-color: var(--olive); background: rgba(107,142,35,.1); }
.vpb-item-name { font-size: 12px; font-weight: 600; color: var(--ink1); }
.vpb-item-desc { font-size: 10px; color: var(--ink3); margin-top: 2px; }
.vpb-empty { text-align: center; padding: 16px; color: var(--ink3); font-size: 12px; }
@media (max-width: 768px) {
  .vpb { flex-wrap: wrap; padding: 6px 10px; }
  .vpb-current-name { max-width: 48vw; }
}
</style>

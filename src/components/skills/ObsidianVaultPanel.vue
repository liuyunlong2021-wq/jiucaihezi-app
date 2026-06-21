<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useSkillsManageStore } from '@/stores/skillsManageStore'
import {
  filterObsidianVaultSkills,
  filterObsidianVaults,
  getObsidianReadonlyNotice,
  groupObsidianSkillsByPlatformPath,
} from '@/utils/obsidianVaultViewModel'

const store = useSkillsManageStore()
const {
  error,
  isLoadingObsidian,
  obsidianVaults,
  obsidianVaultSkills,
} = storeToRefs(store)

const vaultQuery = ref('')
const skillQuery = ref('')
const selectedVaultId = ref('')

const filteredVaults = computed(() => filterObsidianVaults(obsidianVaults.value, vaultQuery.value))
const selectedVault = computed(() =>
  obsidianVaults.value.find((vault) => vault.id === selectedVaultId.value) || null
)
const currentSkills = computed(() =>
  selectedVaultId.value ? obsidianVaultSkills.value[selectedVaultId.value] || [] : []
)
const filteredSkills = computed(() => filterObsidianVaultSkills(currentSkills.value, skillQuery.value))
const skillGroups = computed(() => groupObsidianSkillsByPlatformPath(filteredSkills.value))

async function load() {
  try {
    await store.loadObsidianVaults()
    if (!selectedVaultId.value && obsidianVaults.value[0]) {
      await selectVault(obsidianVaults.value[0].id)
    }
  } catch {
    // Store error is rendered in the panel.
  }
}

async function selectVault(vaultId: string) {
  selectedVaultId.value = vaultId
  skillQuery.value = ''
  try {
    await store.loadObsidianVaultSkills(vaultId)
  } catch {
    // Store error is rendered in the panel.
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <section class="ovp">
    <header class="head">
      <div>
        <h3>Obsidian</h3>
        <p>{{ getObsidianReadonlyNotice() }}</p>
      </div>
      <button class="btn" type="button" :disabled="isLoadingObsidian" @click="load">
        <JcIcon name="refresh" :class="{ spin: isLoadingObsidian }" />
        刷新
      </button>
    </header>

    <div v-if="error" class="error">{{ error }}</div>

    <div class="layout">
      <aside class="vaults">
        <label class="search">
          <JcIcon name="search" />
          <input v-model="vaultQuery" type="search" placeholder="搜索 Vault" />
        </label>
        <div v-if="isLoadingObsidian && obsidianVaults.length === 0" class="state">读取 Vault...</div>
        <div v-else-if="filteredVaults.length === 0" class="state">暂无 Obsidian Vault Skill</div>
        <button
          v-for="vault in filteredVaults"
          v-else
          :key="vault.id"
          type="button"
          class="vault"
          :class="{ active: vault.id === selectedVaultId }"
          @click="selectVault(vault.id)"
        >
          <JcIcon name="library_books" />
          <span>
            <strong>{{ vault.name }}</strong>
            <small>{{ vault.skill_count }} Skill · {{ vault.path }}</small>
          </span>
        </button>
      </aside>

      <main class="skills">
        <div class="selected">
          <div>
            <h4>{{ selectedVault?.name || '选择 Obsidian Vault' }}</h4>
            <p>{{ selectedVault?.path || 'Vault Skill 会作为 Discover/Platform 的只读来源展示。' }}</p>
          </div>
          <span class="readonly">read-only</span>
        </div>

        <label class="search">
          <JcIcon name="search" />
          <input v-model="skillQuery" type="search" placeholder="搜索 Vault Skill" />
        </label>

        <div v-if="!selectedVault" class="state">选择一个 Vault 查看 Skill。</div>
        <div v-else-if="filteredSkills.length === 0" class="state">没有匹配的 Vault Skill。</div>
        <section v-for="group in skillGroups" v-else :key="group.label" class="group">
          <h5>{{ group.label }}</h5>
          <article v-for="skill in group.skills" :key="skill.id" class="skill">
            <div>
              <strong>{{ skill.name }}</strong>
              <p>{{ skill.description || '无描述' }}</p>
              <small>{{ skill.file_path }}</small>
            </div>
            <span>{{ skill.is_already_central ? '已在 Central Skills' : 'Vault source' }}</span>
          </article>
        </section>
      </main>
    </div>
  </section>
</template>

<style scoped>
.ovp { height: 100%; min-height: 0; display: flex; flex-direction: column; gap: 10px; padding: 10px; }
.head { flex: 0 0 auto; display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
h3, h4, h5, p { margin: 0; letter-spacing: 0; }
h3 { color: var(--ink1); font-size: 15px; font-weight: 950; }
h4 { color: var(--ink1); font-size: 14px; font-weight: 950; }
h5 { color: var(--ink2); font-size: 12px; font-weight: 950; text-transform: none; }
p { margin-top: 3px; color: var(--ink3); font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; }
.btn { min-height: 32px; display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); color: var(--ink2); padding: 0 10px; font-weight: 850; cursor: pointer; }
.btn:disabled { opacity: .55; cursor: default; }
.error { padding: 8px; border-radius: 8px; background: color-mix(in srgb, var(--jc-error) 12%, transparent); color: var(--jc-error); font-size: 12px; }
.layout { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(220px, .34fr) minmax(0, 1fr); gap: 10px; }
.vaults, .skills { min-height: 0; display: flex; flex-direction: column; gap: 8px; }
.search { flex: 0 0 auto; min-height: 32px; display: flex; align-items: center; gap: 6px; padding: 0 9px; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); color: var(--ink3); }
.search input { min-width: 0; flex: 1; border: 0; outline: 0; background: transparent; color: var(--ink1); font-size: 12px; }
.vault { min-width: 0; display: flex; align-items: flex-start; gap: 8px; padding: 9px; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); color: var(--ink2); text-align: left; cursor: pointer; }
.vault.active { border-color: color-mix(in srgb, var(--olive) 45%, var(--border)); background: var(--olive-pale); color: var(--olive-dark); }
.vault span:last-child { min-width: 0; display: grid; gap: 3px; }
.vault strong { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vault small { color: var(--ink3); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.selected { flex: 0 0 auto; display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); }
.readonly { flex: 0 0 auto; padding: 3px 7px; border-radius: 999px; background: color-mix(in srgb, var(--ink1) 8%, transparent); color: var(--ink3); font-size: 10px; font-weight: 950; }
.group { display: grid; gap: 7px; }
.skill { display: flex; justify-content: space-between; gap: 10px; padding: 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); }
.skill div { min-width: 0; }
.skill strong { color: var(--ink1); font-size: 13px; }
.skill small { display: block; margin-top: 5px; color: var(--ink3); font-size: 11px; overflow-wrap: anywhere; }
.skill > span { flex: 0 0 auto; color: var(--ink3); font-size: 11px; font-weight: 850; }
.state { min-height: 80px; display: grid; place-items: center; border: 1px dashed var(--border); border-radius: 8px; color: var(--ink3); text-align: center; font-size: 12px; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 760px) {
  .layout { grid-template-columns: 1fr; }
}
</style>

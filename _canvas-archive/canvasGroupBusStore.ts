/* canvasGroupBusStore — Pinia 版，对齐 T8 stores/groupBus.ts */
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useCanvasGroupBusStore = defineStore('canvasGroupBus', () => {
  const selectedGroupId = ref<string | null>(null)
  const groupNodeMap = ref<Record<string, string[]>>({})

  function setSelectedGroup(id: string | null) { selectedGroupId.value = id }
  function addNodeToGroup(groupId: string, nodeId: string) {
    const arr = groupNodeMap.value[groupId] || []
    if (!arr.includes(nodeId)) { groupNodeMap.value = { ...groupNodeMap.value, [groupId]: [...arr, nodeId] } }
  }
  function removeNodeFromGroup(groupId: string, nodeId: string) {
    const arr = (groupNodeMap.value[groupId] || []).filter(x => x !== nodeId)
    groupNodeMap.value = { ...groupNodeMap.value, [groupId]: arr }
  }
  function getGroupNodes(groupId: string): string[] {
    return groupNodeMap.value[groupId] || []
  }

  return { selectedGroupId, groupNodeMap, setSelectedGroup, addNodeToGroup, removeNodeFromGroup, getGroupNodes }
})

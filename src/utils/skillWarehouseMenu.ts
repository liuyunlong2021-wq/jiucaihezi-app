export type SkillWarehouseMenuAction = 'rename' | 'modify' | 'editTriggers'

export interface SkillWarehouseMenuItem {
  action: SkillWarehouseMenuAction
  label: string
  icon: string
}

export const SKILL_WAREHOUSE_MENU_ITEMS: SkillWarehouseMenuItem[] = [
  { action: 'rename', label: '修改Skill名字', icon: 'edit' },
  { action: 'modify', label: '修改Skill', icon: 'construction' },
  { action: 'editTriggers', label: '修改Skill命中关键词', icon: 'label' },
]

export function getSkillWarehouseMenuLabels(): string[] {
  return SKILL_WAREHOUSE_MENU_ITEMS.map(item => item.label)
}

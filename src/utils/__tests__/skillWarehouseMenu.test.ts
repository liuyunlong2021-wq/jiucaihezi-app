import assert from 'node:assert/strict'
import { test } from 'node:test'

import { SKILL_WAREHOUSE_MENU_ITEMS, getSkillWarehouseMenuLabels } from '../skillWarehouseMenu'

test('skill warehouse existing-skill menu exposes exactly the three approved actions', () => {
  assert.deepEqual(getSkillWarehouseMenuLabels(), [
    '修改Skill名字',
    '修改Skill',
    '修改Skill命中关键词',
  ])
})

test('skill warehouse menu never exposes evolution or creation actions for existing skills', () => {
  const labels = SKILL_WAREHOUSE_MENU_ITEMS.map(item => item.label)

  assert.equal(labels.some(label => /进化|反哺|新建|资料生成|素材转/.test(label)), false)
})

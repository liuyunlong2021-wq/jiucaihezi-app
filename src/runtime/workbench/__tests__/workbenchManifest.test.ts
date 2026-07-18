import assert from 'node:assert/strict'
import { test } from 'node:test'

import { extractEcommerceWorkbenchResult, loadEcommerceWorkbenchDefinitions, parseEcommerceWorkbenchManifest } from '../workbenchManifest'

const manifest = {
  version: 1,
  surface: 'ecommerce',
  title: '参考图反推',
  description: '上传一张参考图，反推画面语言和提示词。',
  action: { label: '反推提示词', prompt: '请反推这张参考图的提示词。' },
  result: { label: '商品图中文提示词', heading: '② 中文生图提示词' },
  fields: [{ id: 'reference_image', type: 'file', label: '上传参考图', required: true, accept: ['image/*'], maxFiles: 1 }],
}

test('accepts the one-image ecommerce workbench declaration used by the pilot', () => {
  assert.deepEqual(parseEcommerceWorkbenchManifest(manifest), manifest)
})

test('does not infer a workbench from an undeclared or unsafe Skill payload', () => {
  assert.equal(parseEcommerceWorkbenchManifest({ ...manifest, surface: 'creative' }), null)
  assert.equal(parseEcommerceWorkbenchManifest({ ...manifest, fields: [] }), null)
  assert.equal(parseEcommerceWorkbenchManifest({ ...manifest, fields: [{ ...manifest.fields[0], accept: ['*/*'] }] }), null)
})

test('extracts only the declared result section and falls back to the final answer', () => {
  const content = '### ① JSON 视觉分析\n{ "subject": "产品" }\n\n### ② 中文生图提示词\n商品主图，柔和侧逆光。'
  assert.equal(extractEcommerceWorkbenchResult(content, manifest.result.heading), '商品主图，柔和侧逆光。')
  assert.equal(extractEcommerceWorkbenchResult('模型未按标题输出', manifest.result.heading), '模型未按标题输出')
})

test('loads only catalogued Skills that explicitly package a valid workbench declaration', async () => {
  const fetcher = async (url: string | URL | Request) => {
    const path = String(url)
    if (path === '/skills/index.json') return Response.json([
      { id: 'JC-反推图片提示词', name: 'JC-Reverse-Image-Prompt', description: null, triggers: [], commands: [], files: ['SKILL.md', 'workbench.json'] },
      { id: 'ordinary-skill', name: 'ordinary-skill', description: null, triggers: [], commands: [], files: ['SKILL.md'] },
    ])
    if (path === '/skills/JC-%E5%8F%8D%E6%8E%A8%E5%9B%BE%E7%89%87%E6%8F%90%E7%A4%BA%E8%AF%8D/workbench.json') return Response.json(manifest)
    return new Response('not found', { status: 404 })
  }

  const definitions = await loadEcommerceWorkbenchDefinitions(fetcher as typeof fetch)
  assert.equal(definitions.length, 1)
  assert.equal(definitions[0]?.skillName, 'JC-Reverse-Image-Prompt')
  assert.equal(definitions[0]?.action.label, '反推提示词')
})

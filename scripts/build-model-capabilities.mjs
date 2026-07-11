#!/usr/bin/env node
/**
 * 从 runninghubOfficialCapabilities.ts 自动生成 JC-瞬间创作 能力表。
 *
 * 用法：node scripts/build-model-capabilities.mjs
 * 输出：public/skills/JC-瞬间创作/references/model-capabilities.md
 *
 * 每次改创作面板模型参数后跑这个脚本，Skill 能力表自动同步，零手工漂移。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── 模型 ID → 端点 key + 元数据 ──────────────────────
// capKey 必须与 runninghubOfficialCapabilities.ts 中的 key 完全一致
const MODEL_MAP = [
  { id: 'rh-gpt2-official',    capKey: 'rhart-image-g-2/text-to-image',        label: 'GPT Image 2 官方版',      price: '¥0.25',  mode: '文生图', star: true },
  { id: 'gpt-image-2',         capKey: 'rhart-image-g-2/text-to-image',        label: 'GPT Image 2 文生图',       price: '¥0.15',  mode: '文生图' },
  { id: 'rh-pro-image',        capKey: 'rhart-image-n-pro/text-to-image',      label: '全能图片PRO',              price: '¥0.50',  mode: '文生图' },
  { id: 'z-image-turbo',       capKey: 'rhart-image/z-image/turbo-lora',       label: 'Seedream v5',             price: '¥0.05',  mode: '文生图' },
  // Seedance Mini/Fast 复用 Std 能力（参数一致，仅定价/速度不同）
  { id: 'rh-seedance2-mini-image', capKey: 'rhart-video/sparkvideo-2.0/image-to-video',    label: 'Seedance 2.0 Mini 图生',   price: '¥0.70/s', mode: '图生视频', star: true, refMax: 1 },
  { id: 'rh-seedance2-mini-text',  capKey: 'rhart-video/sparkvideo-2.0/text-to-video',    label: 'Seedance 2.0 Mini 文生',   price: '¥0.70/s', mode: '文生视频' },
  { id: 'rh-seedance2-mini',       capKey: 'rhart-video/sparkvideo-2.0/multimodal-video', label: 'Seedance 2.0 Mini 多模态', price: '¥1.20/s', mode: '多模态',  refMax: 9, videoMax: 3 },
  { id: 'rh-seedance2-fast-image', capKey: 'rhart-video/sparkvideo-2.0/image-to-video',    label: 'Seedance 2.0 Fast 图生',   price: '¥1.10/s', mode: '图生视频', refMax: 1 },
  { id: 'rh-seedance2-fast-text',  capKey: 'rhart-video/sparkvideo-2.0/text-to-video',    label: 'Seedance 2.0 Fast 文生',   price: '¥1.10/s', mode: '文生视频' },
  { id: 'rh-seedance2-fast',       capKey: 'rhart-video/sparkvideo-2.0/multimodal-video', label: 'Seedance 2.0 Fast 多模态', price: '¥2.00/s', mode: '多模态',  refMax: 9, videoMax: 3 },
  { id: 'rh-seedance2-image',      capKey: 'rhart-video/sparkvideo-2.0/image-to-video',    label: 'Seedance 2.0 Std 图生',    price: '¥1.50/s', mode: '图生视频', refMax: 1 },
  { id: 'rh-seedance2-text',       capKey: 'rhart-video/sparkvideo-2.0/text-to-video',    label: 'Seedance 2.0 Std 文生',    price: '¥1.50/s', mode: '文生视频' },
  { id: 'veo3.1-fast',             capKey: 'rhart-video-v3.1-fast/image-to-video',        label: 'Veo 3.1 Fast 图生',       price: '¥0.40/s', mode: '图生视频', refMax: 3 },
  { id: 'veo3.1-fast-t2v',         capKey: 'rhart-video-v3.1-fast/text-to-video',         label: 'Veo 3.1 Fast 文生',       price: '¥0.40/s', mode: '文生视频' },
  { id: 'rh-grok-image-video',     capKey: 'rhart-video-g/image-to-video',                label: 'Grok Video 图生',        price: '¥0.08/s', mode: '图生视频', refMax: 7 },
  { id: 'rh-grok-text-video',      capKey: 'rhart-video-g/text-to-video',                 label: 'Grok Video 文生',        price: '¥0.08/s', mode: '文生视频' },
];

// ── 解析 TS 源码 ─────────────────────────────────────
const tsSrc = readFileSync(resolve(ROOT, 'src/data/runninghubOfficialCapabilities.ts'), 'utf8');
const re = /export const RH_OFFICIAL_ENDPOINT_CAPABILITIES[^=]*=\s*(\{[\s\S]*?\n\})/;
const m = tsSrc.match(re);
if (!m) { console.error('ERROR: could not find capabilities object'); process.exit(1); }
const capsByKey = eval('(' + m[1] + ')');

// ── 辅助 ─────────────────────────────────────────────
const ratioKeys = ['aspectRatio', 'ratio'], resKeys = ['resolution'], durKeys = ['duration'];
function fp(params, keys) { return params.find(p => keys.includes(p.key)); }
function fl(opts) { return (opts || []).join(', '); }
function fd(p) {
  if (!p) return '—';
  if (p.options?.length) return p.options.join(', ');
  return `${p.min || p.default || '?'}-${p.max || '?'}`;
}
function fr(m, cap) {
  const img = cap.params.find(p => p.type === 'IMAGE' || p.key === 'imageUrls' || p.key === 'firstFrameUrl');
  if (!img) return '—';
  const n = img.maxCount || m.refMax || 1;
  return m.videoMax ? `≤${n} 图 + ≤${m.videoMax} 视频` : `≤${n} 张`;
}

function genRow(m, i) {
  const cap = capsByKey[m.capKey];
  if (!cap) return `| ${i+1} | ${m.label} \`${m.id}\` | ${m.price} | ${m.mode} | ⚠️ 未找到 | | | |`;
  const r = fp(cap.params, ratioKeys), s = fp(cap.params, resKeys), d = fp(cap.params, durKeys);
  const star = m.star ? '⭐' : '';
  return `| ${star}${i+1} | ${m.label} \`${m.id}\` | ${m.price} | ${m.mode} | ${fl(r?.options)} | ${fl(s?.options)} | ${fd(d)} | ${fr(m, cap)} |`;
}

function genTable(models, title) {
  const h = '| # | 模型 | 价格 | 模式 | 比例 | 分辨率 | 时长(s) | 参考图 |';
  const s = '|---|------|------|------|------|--------|---------|--------|';
  return `## ${title}\n\n${h}\n${s}\n` + models.map((m, i) => genRow(m, i)).join('\n');
}

// ── 生成 ─────────────────────────────────────────────
const img = MODEL_MAP.filter(m => !m.capKey.includes('video'));
const vid = MODEL_MAP.filter(m => m.capKey.includes('video'));

const md = `# 模型能力表

> **自动生成自 \`src/data/runninghubOfficialCapabilities.ts\`。不要手动编辑。**
> 运行 \`node scripts/build-model-capabilities.mjs\` 重新生成。

${genTable(img, '图片模型')}

${genTable(vid, '视频模型')}

## 使用规则

1. **用户选模型 → 只能从该行选参数。** 不准推荐表里没有的比例/分辨率/时长。
2. **默认推荐 ⭐1**。用户不选就默认。
3. 执行：\`--params ratio=X:Y resolution=Z duration=N\`（值必须来自该行）

## 提示词规则

- **生图**：一段中文，结构 主体+场景+光影+构图+风格+画质+情绪。具体名词 > 形容词。
- **生视频**：一段中文，只写图片给不了的东西——运动+镜头+声音。不重复图片内容。
- 每次必带比例+分辨率/时长推荐（从本表该行选）。
`;

const outPath = resolve(ROOT, 'public/skills/JC-瞬间创作/references/model-capabilities.md');
writeFileSync(outPath, md, 'utf8');
console.log(`✅ Generated ${outPath} (${img.length} img + ${vid.length} vid)`);

// 一次性工具：按 comfy-adapter 的约束推导 jc- 模型的尺寸表，并校验合法性。
// 约束来自 workflows/*.meta.json 的 constraints：
//   qwen-image-2.1  multiple_of=8   max_size=2048  max_pixels=2100000  min_size=256
//   minimax-h3-*    multiple_of=32  max_size=2048  max_pixels=2100000  min_size=256
const TIERS = [
  { tier: '1K', long: 1024 },
  { tier: '2K', long: 1920 },
]
const RATIOS = [
  ['1:1', '方图'],
  ['16:9', '横屏'],
  ['9:16', '竖屏'],
  ['4:3', '横屏'],
  ['3:4', '竖屏'],
  ['3:2', '横屏'],
  ['2:3', '竖屏'],
]

const MAX_PIXELS = 2100000
const MAX_SIZE = 2048
const MIN_SIZE = 256

function snap(value, m) { return Math.round(value / m) * m }

function fit(rw, rh, longLimit, m) {
  const landscape = rw >= rh
  const start = Math.floor(Math.min(longLimit, MAX_SIZE) / m) * m
  let best = null
  for (let long = start; long >= MIN_SIZE; long -= m) {
    const short = snap((long * Math.min(rw, rh)) / Math.max(rw, rh), m)
    if (short < MIN_SIZE) break
    if (long * short > MAX_PIXELS) continue
    const [w, h] = landscape ? [long, short] : [short, long]
    const error = Math.abs(w / h - rw / rh) / (rw / rh)
    if (error > 0.01) continue
    if (!best || w * h > best.w * best.h) best = { w, h, error }
  }
  return best ? [best.w, best.h, best.error] : null
}

function build(label, m) {
  console.log(`\n===== ${label}（multiple_of=${m}）=====`)
  const rows = []
  for (const { tier, long } of TIERS) {
    for (const [ratio, orientation] of RATIOS) {
      const [rw, rh] = ratio.split(':').map(Number)
      const result = fit(rw, rh, long, m)
      if (!result) { console.log(`  ${tier} ${ratio} -> 无解`); continue }
      const [w, h, ratioError] = result
      const px = w * h
      const ok = w % m === 0 && h % m === 0 && px <= MAX_PIXELS &&
        Math.max(w, h) <= MAX_SIZE && Math.min(w, h) >= MIN_SIZE && ratioError < 0.01
      rows.push({ tier, ratio, orientation, w, h, px, ratioError, ok })
      console.log(`  ${ok ? 'OK ' : 'BAD'} ${tier} ${ratio.padEnd(5)} ${orientation} -> ${`${w}x${h}`.padEnd(10)} ${(px / 1e6).toFixed(2)}MP  比例误差 ${(ratioError * 100).toFixed(2)}%`)
    }
  }
  console.log('  --- value 列表 ---')
  console.log('  ' + rows.map(r => `'${r.w}x${r.h}'`).join(', '))
  console.log('  --- label 列表 ---')
  rows.forEach(r => console.log(`   ${r.tier} ${r.orientation} ${r.ratio} · ${r.w}×${r.h}`))
  return rows
}

const image = build('图片 Qwen-Image 2.1', 8)
const video = build('视频 MiniMax H3', 32)
const all = [...image, ...video]
console.log(`\n图片 ${image.length} 条 / 视频 ${video.length} 条；全部通过：${all.every(r => r.ok)}`)
console.log(`唯一尺寸数：${new Set(all.map(r => `${r.w}x${r.h}`)).size}`)

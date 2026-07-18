import type { EcommerceDraft } from '@/stores/ecommerceWorkbenchStore'

/** Builds a planning request; actual media execution stays in CreationPanel. */
export function buildEcommercePlannerPrompt(draft: EcommerceDraft): string {
  const describeImages = (images: string[]) => images.map((image, index) =>
    image.startsWith('data:') ? `本轮已附带图片 ${index + 1}` : image,
  )
  const facts = JSON.stringify({
    productImages: describeImages(draft.productImages),
    referenceImages: describeImages(draft.referenceImages),
    deliveryGoal: draft.deliveryGoal,
    market: draft.market,
    notes: draft.notes,
  }, null, 2)

  return [
    '请加载并遵守 JC-电商商品图 Skill，为下面的电商商品图任务制定方案。',
    '商品图必须保留用户素材中可见的产品、包装和文字事实；参考图只可借鉴构图、光线、色彩与版式，不能复制对方品牌或商标。',
    '你只负责规划，不得调用媒体 API、不得运行 CLI、不得轮询或下载文件，也不得声称已经生成图片。',
    '若关键事实缺失，先用自然语言追问；否则最终回复必须只包含一个可解析的媒体计划代码块，格式如下：',
    '```jc-media-plan',
    '{"kind":"image","title":"任务标题","prompt":"完整图片提示词","modelId":"已注册的图片模型 ID","ratio":"合法比例","resolution":"合法分辨率","referenceImages":["项目内素材路径"]}',
    '```',
    '用户事实：',
    '```json',
    facts,
    '```',
  ].join('\n')
}

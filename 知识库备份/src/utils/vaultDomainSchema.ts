export type VaultDomain = 'novel' | 'legal' | 'general'

export interface VaultDomainSchema {
  domain: VaultDomain
  wikiFolders: string[]
  rawFolders: string[]
  keywords: string[]
}

export interface InferVaultDomainSchemaInput {
  name?: string
  text?: string
  selectedFolders?: string[]
}

const NOVEL_FOLDERS = ['人物', '关系', '事件线', '章节索引', '场景', '道具', '世界观', '写作状态']
const LEGAL_FOLDERS = ['案由', '案件', '事实结构', '证据', '文书模板', '办案策略', '结果复盘']
const GENERAL_FOLDERS = ['基础概念', '流程', '模板', '案例', 'FAQ', '资料索引']
const DEFAULT_RAW_FOLDERS = ['上传资料', '原始文件', '转换后的MD']

function unique(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const clean = String(value || '').trim()
    if (!clean || seen.has(clean)) continue
    seen.add(clean)
    result.push(clean)
  }
  return result
}

function score(text: string, patterns: RegExp[]): number {
  return patterns.reduce((sum, pattern) => sum + (pattern.test(text) ? 1 : 0), 0)
}

function inferDomain(text: string): VaultDomain {
  const novelScore = score(text, [
    /第\s*[0-9０-９一二三四五六七八九十百千]+\s*[章节回]/,
    /男主|女主|主角|配角|角色|人物关系/,
    /剧情|情节|感情线|世界观|场景|道具/,
  ])
  const legalScore = score(text, [
    /案由|案号|案件|证据|诉讼|判决|裁定/,
    /起诉状|答辩状|代理词|辩护词|证据清单/,
    /故意伤害|刑初|民初|行政|合同纠纷/,
  ])
  if (legalScore >= 2 && legalScore >= novelScore) return 'legal'
  if (novelScore >= 2) return 'novel'
  return 'general'
}

export function inferVaultDomainSchema(input: InferVaultDomainSchemaInput): VaultDomainSchema {
  const text = `${input.name || ''}\n${input.text || ''}`
  const domain = inferDomain(text)
  const baseFolders = domain === 'novel'
    ? NOVEL_FOLDERS
    : domain === 'legal'
      ? LEGAL_FOLDERS
      : GENERAL_FOLDERS
  return {
    domain,
    wikiFolders: unique([...(input.selectedFolders || []), ...baseFolders]),
    rawFolders: [...DEFAULT_RAW_FOLDERS],
    keywords: domain === 'novel'
      ? ['小说', '人物', '关系', '事件线', '章节']
      : domain === 'legal'
        ? ['律师', '案件', '案由', '证据', '文书']
        : ['知识库', '资料', '流程', '模板'],
  }
}

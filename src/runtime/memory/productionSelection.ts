import { restoreManjuSelection, type ManjuPreference } from './manjuProduction'
import { restoreNovelSelection, type NovelPreference } from './novelProduction'
import { isProductionSelection } from './productionSkills'
import { nativeWikiSelection } from './projectWiki'
import { SHORT_DRAMA_MODE, restoreShortDramaSelection, type ShortDramaPreference } from './shortDramaProduction'

/**
 * 按对话偏好与最近一轮用户消息恢复创作模式（漫剧 / 短剧 / 小说）。
 * 电脑打开对话与手机在后台推进对话共用这一条规则；可用性过滤由调用方做。
 */
export function restoreProductionSelection(
  names: string[] = [],
  manjuPreference?: ManjuPreference,
  novelPreference?: NovelPreference,
  shortDramaPreference?: ShortDramaPreference,
): string[] {
  if ([manjuPreference, novelPreference, shortDramaPreference].every(preference => preference?.enabled === false)
    && !names.some(isProductionSelection))
    return nativeWikiSelection(names)
  const legacyShortDrama = !shortDramaPreference && names.some(name => name === SHORT_DRAMA_MODE || name === 'jc-duanju')
  if (legacyShortDrama)
    return restoreShortDramaSelection(names, { enabled: true, wikiMemoryWasSelected: manjuPreference?.wikiMemoryWasSelected })
  if (shortDramaPreference?.enabled) return restoreShortDramaSelection(names, shortDramaPreference)
  if (novelPreference?.enabled) return restoreNovelSelection(names, novelPreference)
  if (manjuPreference?.enabled) return restoreManjuSelection(names, manjuPreference)
  return restoreShortDramaSelection(restoreNovelSelection(restoreManjuSelection(names, manjuPreference), novelPreference), shortDramaPreference)
}

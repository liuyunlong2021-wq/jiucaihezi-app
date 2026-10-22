/** 应用原生入口标记，不是 Skill 名称；兼容旧会话的选择。 */
export const PROJECT_WIKI = 'project-wiki'
export function nativeWikiSelection(names: string[]): string[] {
  return [...new Set(names.map(name => name === 'wiki-memory' ? PROJECT_WIKI : name))]
}
export function needsProjectWiki(message: string, names: string[]): boolean {
  return names.some(name => [PROJECT_WIKI, 'wiki-memory'].includes(name))
    || /(?:wiki|知识库|项目资料|资料沉淀|基于资料|归档)/i.test(message)
}

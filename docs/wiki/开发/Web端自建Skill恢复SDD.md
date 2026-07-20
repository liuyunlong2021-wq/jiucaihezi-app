# Web 端自建 Skill 恢复 SDD

> 日期：2026-07-20
> 状态：已完成；完整 Web 构建仍受既有创作面板模板语法错误阻断，详见第 5 节
> 范围：仅 Web Skill 仓库；Desktop 中央 Skill 仓库、内置 Skill 打包和云端同步不改。

## 1. 根因与决策

`9c406d23` 在创模式大改中把 Web 收敛成“只使用内置 Skill”：删除 `jc_web_skills_v1` 的读取与写回，`createAgent()` 在 Web 直接报错，`WebSkillPanel` 也被替换成只读内置列表。

这不是数据安全或跨端一致性的必要约束。原有自建 Skill 只保存在用户当前浏览器、当前站点的 `localStorage['jc_web_skills_v1']`，没有上传，也不会影响 Desktop 的中央仓库。用户明确需要同一浏览器内的旧自建 Skill 重现并可继续新建、编辑、删除，因此恢复这条已有本地链路。

## 2. 目标与边界

1. Web 启动后同时加载 `public/skills/index.json` 的内置 Skill 和 `jc_web_skills_v1` 中的用户 Skill。
2. Skill 仓库右侧恢复“自建”入口与编辑页：用户填写名称、描述、`SKILL.md` 内容后保存；已有用户 Skill 可编辑、删除；内置 Skill 不可编辑或删除。
3. 新建、编辑、删除都立即写回 `jc_web_skills_v1`，并让当前会话的 Skill 选择器可使用保存后的 Skill。
4. 浏览器中已有的 `jc_web_skills_v1` 数据不迁移、不清除、不上传。换浏览器、清除站点数据或更换站点 origin 后不存在旧数据，是浏览器本地存储边界，不伪造跨端同步。
5. Desktop 不改变：它继续使用中央 Skill 仓库与 Tauri 文件系统。

## 3. 实施计划

1. 在 `agentStore` 测试中先覆盖旧本地数据合并加载、新建持久化与编辑/删除持久化；现有“Web 禁止自建”测试必须先变红。
2. 恢复 Web 的 `WEB_SKILLS_KEY`、解析、过滤和写回；Web `createAgent`、`updateSkill`、`deleteAgent` 使用同一内存列表和同一持久化出口，Desktop 分支不动。
3. 在 `WebSkillPanel` 恢复紧凑的“自建”按钮和编辑弹窗；只显示用户 Skill 的编辑/删除动作，保存调用 store API，避免组件直接篡改 store 状态。
4. 更新 Web Skill 来源合同与本 SDD，运行目标测试、类型检查、Web build、源码审计和差异检查。

## 4. 验收

- 同一站点 localStorage 预置 `jc_web_skills_v1` 后，Web bootstrap 结果同时含内置 Skill 与该用户 Skill。
- 在 Web 新建、修改、删除一个用户 Skill 后，`jc_web_skills_v1` 的内容分别新增、更新、移除该 Skill；保存后该 Skill 出现在可选 Skill 列表。
- 页面含“自建”按钮、编辑弹窗及保存动作；内置 Skill 没有编辑/删除入口。
- `pnpm run test:focused`、`pnpm exec vue-tsc -b`、`pnpm run build`、`git diff --check` 通过，或如实记录既有失败。

## 5. 执行与审计结果

- `agentStore` 已恢复 `WEB_SKILLS_KEY = 'jc_web_skills_v1'` 的读取和写回。Web bootstrap 合并内置目录与旧用户数据；目录请求失败时仍保留可用的旧用户 Skill。
- Web 的 `createAgent`、`updateSkill`、`deleteAgent` 都通过同一持久化出口更新本地数据；Desktop 分支继续走既有中央 Skill 仓库，未改变。
- `WebSkillPanel` 已恢复“自建”按钮、名称/描述/`SKILL.md` 编辑弹窗、用户 Skill 的编辑与删除。内置 Skill 仍只读。
- 专属回归通过：旧用户 Skill 与内置目录合并；新建、编辑、删除分别写回 `jc_web_skills_v1`；面板合同确认自建、编辑、删除入口存在。Web 对话和创模式均经 `getSkillById/loadSkills` 消费同一份 Store，保存后无需额外同步即可选用。
- 通过：`pnpm exec vue-tsc -b`、专属 Node 测试 7/7、`git diff --check`。
- 当前完整 `pnpm run test:focused` 为 1043 通过、53 失败；本次测试均通过，余下为既有产品合同债务。`pnpm run build:quick` 在进入本次面板前被 `src/components/creation/CreationPanel.vue:3210` 的已提交 Vue 模板表达式语法错误阻断（来源 `9e558f60`）。未扩大范围修改创作面板。

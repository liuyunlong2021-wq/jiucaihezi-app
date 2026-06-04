# 特朗普 Seedace2.0 渠道配置

> 目标：让 `seedance-2-0-pro` / `seedance-2-0-fast` 通过 NewAPI 走“川普特供”分组（Channel 45 同组），享受专属额度/高倍率通道，同时保持与现有 sd2.mengfactory.cn 兼容层一致。

## 1. 查看 NewAPI 源码里的渠道/视频处理逻辑（你让我看的 MYnewapi）

在 `/Users/by3/Documents/搭子Studio桌面版/MYnewapi` 里重点文件：

- `constant/channel.go`
  - `ChannelTypeOpenAI = 1`（我们必须用这个）
  - `ChannelTypeDoubaoVideo = 54`（原生豆包/火山 Seedance 用这个，走 ark `/api/v3/contents/generations/tasks`）
  - `ChannelTypeVolcEngine = 45`

- `relay/relay_adaptor.go`
  - DoubaoVideo + VolcEngine → `taskdoubao.TaskAdaptor`（原生）
  - OpenAI + Sora → `tasksora.TaskAdaptor`（OpenAI 兼容视频格式）

- `relay/channel/task/sora/adaptor.go`
  - `BuildRequestURL` 会拼 `${baseURL}/v1/videos`
  - 支持 JSON + multipart（image_file_1 等）
  - 正是我们给 sd2.mengfactory.cn/openai-compatible 用的那个 adaptor

- `relay/channel/task/doubao/adaptor.go`
  - 给原生 `doubao-seedance-*` 模型用的

结论：**想用 sd2.mengfactory.cn 的 Seedance 2.0（就是你 channels 里 33/37 那个），必须把 NewAPI 渠道类型选 OpenAI**，API 地址填 `https://sd2.mengfactory.cn/openai-compatible`（不要多加 /v1/videos）。

## 2. 参考文档

完整使用和 NewAPI 教学见同目录：
- `火山引擎seedance2.0.md`（尤其是“seedance-2-0-fast 兼容 NewAPI 教学”一节）

## 3. 当前服务器渠道快照（来自 我的服务器运维手册.md）

| ID | 名称         | Group   | 上游 base              | 主要模型                  |
|----|--------------|---------|------------------------|---------------------------|
| 33 | seedace2.0   | 1       | sd2.mengfactory.cn     | seedance-2-0-fast/pro     |
| 37 | seedace2.0-pro | 1     | sd2.mengfactory.cn     | seedance-2-0-pro          |
| 45 | 特朗普       | 川普特供 | —                      | claude-opus-4-7, gpt-5.5, grok-4.1-fast |

GroupRatio 里 `"川普特供":8`（高倍率专属）。

目前 seedace 两个渠道都挂在普通 group 1 下，没有进“特朗普”专供。

## 4. 正确配置“特朗普 Seedace2”渠道的步骤

### 4.1 NewAPI 后台添加/修改渠道

路径：控制台 → 渠道管理 → 添加渠道（或编辑 37 号后复制）

推荐新建一个，名称带“特朗普”便于识别：

| 配置项           | 填写内容                                      | 说明 |
|------------------|-----------------------------------------------|------|
| 类型             | **OpenAI**                                    | **必须**，不能选 DoubaoVideo / VolcEngine / Kling |
| 名称             | `特朗普-Seedance2.0`                          | 建议带特朗普前缀 |
| 密钥             | `sk-你的SeedanceKey`                          | sd2.mengfactory.cn 分配的 key |
| API 地址         | `https://sd2.mengfactory.cn/openai-compatible`| **关键**，必须带这个后缀 |
| 模型             | `seedance-2-0-pro,seedance-2-0-fast`          | 逗号分隔，两个都支持就都写 |
| 分组             | `川普特供`                                    | 让它只对走这个 group 的 token 可见 |
| 优先级           | 10（或更高）                                  | 按需 |
| 状态             | 启用                                          | - |
| 默认测试模型     | `seedance-2-0-pro`                            | 用来点“测试”按钮 |

保存后立即点“测试”或“更新渠道”，确认返回 200 + task_id 结构。

### 4.2 模型管理里注册模型（关键，否则用户看不到）

控制台 → 模型管理 → 添加模型（或编辑已有）

- 模型名称：`seedance-2-0-pro`
- 匹配类型：**精确匹配**
- 参与官方同步：否
- 可用分组：`川普特供`（可同时勾 1 让普通用户也能用）
- 计费类型：按次计费（视频生成）
- 模型倍率 / 固定价格：按你实际成本设（建议比普通视频贵，因为是 pro + 专供 group 倍率 8）

同样为 `seedance-2-0-fast` 也注册一次（如果想同时开放 fast 版）。

### 4.3 验证

1. 用一个 group=川普特供 的 token 调用：
   ```bash
   curl https://api.jiucaihezi.studio/v1/models -H "Authorization: Bearer sk-你的token"
   ```
   应该能看到 `seedance-2-0-pro`。

2. 提交测试任务（走 NewAPI 标准路径）：
   ```bash
   curl -X POST https://api.jiucaihezi.studio/v1/videos \
     -H "Authorization: Bearer sk-你的token" \
     -H "Content-Type: application/json" \
     -d '{
       "model": "seedance-2-0-pro",
       "prompt": "测试用例",
       "duration": 5,
       "ratio": "16:9"
     }'
   ```
   应该返回 OpenAI 风格的 video task 响应，带 task_id。

3. 轮询 `/v1/videos/{task_id}` 应该能拿到 url 或失败原因。

### 4.4 前端 / 可用性打通（当前还是 legacy 路径）

目前代码里 `seedance-2-0-pro` 还是硬走 `/api/seedance/v1/videos`（Nginx 直代 sd2），**不走你新加的 NewAPI 渠道**。

想让“特朗普 Seedace2”真正走 NewAPI + group 计费，需要改三处（后续可做）：

- `scripts/creation-models/server.mjs` 的 `CREATION_MODEL_ROUTES` 数组里加上 seedance 条目（这样 `/api/creation/models` 才能根据 channels 状态动态开/关）。
- `src/data/mediaModelCapabilities.ts` 把 `seedance-2-0` 的 `enabled` 改 true，并把 endpoint 指向标准 `/v1/videos`。
- `src/api/media-generation.ts` 里的 `isSeedanceVideo` 分支改成优先走标准 `apiCall('/v1/videos', ...)`，只有在没有 NewAPI 渠道时才降级到 `/api/seedance`。

改完后，`/api/creation/models` 就能正确返回该模型的 enabled 状态（取决于 NewAPI 里渠道 status 是否为 1）。

## 5. 最小检查清单

- [ ] 渠道类型 = OpenAI
- [ ] API 地址 = https://sd2.mengfactory.cn/openai-compatible （无多余后缀）
- [ ] 分组 = 川普特供
- [ ] 模型列表里写了 seedance-2-0-pro
- [ ] 模型管理里给 seedance-2-0-pro 分配了 川普特供 分组
- [ ] 用川普特供 token 的 /v1/models 能看到这个模型
- [ ] 渠道测试能拿到 task_id

## 6. 相关文件引用

- 完整兼容教学：`火山引擎seedance2.0.md` 第 “seedance-2-0-fast 兼容 NewAPI 教学” 部分
- 当前渠道快照：`我的服务器运维手册.md` 第 6 节
- 源码适配器：MYnewapi/relay/channel/task/sora/adaptor.go （OpenAI 视频路径）
- 客户端特殊处理：`src/api/media-generation.ts:686`（isSeedanceVideo）

配置完成后把这个文档更新到 `我的服务器运维手册.md` 的渠道表里，并把 Channel 45 的模型列表也补上 `seedance-2-0-pro`（如果想让同一个渠道同时支持 LLM + Seedance）。

需要我现在帮你改 creation-models + media-generation 让它真正走 NewAPI 渠道吗？还是先只改后台渠道配置？

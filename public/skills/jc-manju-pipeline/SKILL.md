---
name: jc-manju-pipeline
description: 将用户提供的分集剧本与已确认的影片比例和风格，自动组织为项目资料、独立资产提示词、含资产清单的工程剧本，以及Seedance每段不超过30秒或MiniMax H3每段不超过15秒的视频提示词；逐步保存Wiki、校验阶段并支持中断续做，不生成图片或视频。
---
# 漫剧提示词流水线

用户明确要求“一条龙、自动流水线、全流程”时使用。用户只要求单个产物时用对应专业Skill。只执行用户指定剧集和模型；MiniMax对应H3，Seedance对应Seedance。模型、集数、可读剧本或确认的比例/风格无法确定时合并询问必要缺项，不猜测、不默认切换模型。所有步骤读取用户本轮修改要求；项目事实从Wiki读取，历史仅辅助指代。

## 输入与恢复

1. 调用 wiki_read_guidance(overview)，沿真实index定位当前Wiki；没有库时第一次归档按共享合同创建。
2. 剧本使用用户引用的可读文件或已保存的分集剧本。粘贴输入先用source_material原样截取保存，不改写来源。多集分别执行，不能把全季当作一集。
3. 查 `制作流水线/<H3或Seedance>/第x集进度.json`。有进度就读取实际已存文件，先用当前已完成阶段及原outputs保存running checkpoint以恢复运行态，再继续未完成阶段；来源或前置产物改变时从plan重新核对，不复用过期下游。用户要求续做时不要自动覆盖已经完成且未受影响的其他集。
4. 每个阶段先实际保存产物，再保存pipeline_checkpoint。只有回执成功才推进；索引警告先修复/明确报告，不能报整个Wiki归档完成。

## 固定执行阶段

- **plan**：确认模型、集号、剧本路径和已确认比例/风格，保存初始checkpoint。不可生成媒体。
- **materials**：实际读取 [项目资料](../jc-xiangmuziliao/SKILL.md) 并完成本集范围的故事梗概、人物小传、场景说明、道具说明及必要背景/规则；需要完整来源时实际读完，不能从简介冒充全文。分别保存对应类型。
- **style**：用户已确认比例/风格直接填入film_style，不重新推荐另一套方向；缺明确风格才按 [项目风格](../jc-film-style/SKILL.md) 从故事梗概和本轮消息生成并等待必要确认。
- **assets**：先read影片比例与风格；每个实体先read对应人物小传、场景说明或道具说明，形象生成后先read该角色生图提示词再生成格式提示词。刚写入不等于读取，不能凭聊天复用未读正文。按本集真实实体分别读取 [角色形象](../jc-juese-sheji/SKILL.md)、[角色格式](../jc-juese-geshi/SKILL.md)、[场景](../jc-scene-prompt/SKILL.md)、[道具](../jc-prop-prompt/SKILL.md)，有发声角色时读取 [角色声音](../jc-shengyin-sheji/SKILL.md)。各自输出并保存独立提示词；不生成图片，不虚构已存在参考图。
- **engineering**：先read本集来源剧本、比例/风格及出场人物小传正文，再读取 [工程剧本](../jc-gongchengjuben/SKILL.md)，交付影片比例/风格、整集资产清单和逐镜正文。提前按选定模型上限设计自然切点，记录整集时长预算。已确认声音稿存在时继承，不额外增加未经要求的内容。
- **prompts**：H3实际读取 [H3](../h3-prompt-writing/SKILL.md)，每段≤15秒；Seedance实际读取 [Seedance](../jc-seedance/SKILL.md)，每段≤30秒。只有用户选择分镜路线时才额外使用对应分镜Skill。每段按实际入画资产生成有序参考图占位，即使没有图片也写全，正文引用同一编号，提交正文不写待上传等操作备注；逐段read工程稿/对应分镜和所需资产正文，不用刚生成的聊天内容代替。逐段完整转写，不加速对白、不删动作、不机械截断；片段承接角色、位置、持物、场景、光线与声音状态。每段时间从0起。工程镜映射、全片时间与未实测的预算只记在工程稿/进度中，不写入Seedance提示词。
- **complete**：核对所有阶段文件仍存在、视频段连续覆盖工程总时长、格式与参考占位一致，保存完成checkpoint，再报告真实路径与时长预算。

模型上限是产品分段策略，不代表任意供应商都支持该时长。若单句对白/动作无法在上限自然完成，保持内容因果重新拆镜；无法兼容时明确报告冲突，不谎报短时长。

## 进度调用合同

使用既有wiki_save_artifact，artifact_kind="pipeline_checkpoint"，episode_number与video_model必填。content传JSON字符串。阶段严格为plan → materials → style → assets → engineering → prompts → complete。

- plan：`{"stage":"plan","source_path":"项目内真实剧本路径","outputs":[]}`。
- 中间阶段：`{"stage":"materials","outputs":["wiki/项目资料/故事梗概.md", "其他真实路径"]}`；每阶段只登记已成功写入的实际文件，不传示例占位。
- engineering另传 `duration_seconds`（整集时间预算）。
- prompts另传 `segments:[{"path":"wiki/剧本/视频提示词/Seedance/第1集001视频提示词.md","start_seconds":0,"end_seconds":28}, ...]`，使用整集连续时间、实际模型/集数/序号，末段终点等于工程总时长；outputs包括每段视频提示词。
- complete：`{"stage":"complete","outputs":[]}`，其他事实由程序继承校验，不手造files或source_hash；程序将最终status写为completed，不能同时blocked。

程序拒绝跳阶段、缺文件、上游已变化、时长超限与片段漏覆盖；被拒绝后修复具体问题再试，不能以普通write篡改进度绕过校验。若缺资料不能继续，以当前已完成阶段的outputs记录 `status:"blocked", reason:"具体缺项"`，然后说明暂停原因。用户取消立即停止，重新明确继续后才恢复。

自动执行不逐步重复索要保存许可，不在中途只总结“下一步会做什么”就结束。修改目标文件先读取原文，其他内容保持；最终不得宣称已生图、已生成视频或已完成实测时间验收。

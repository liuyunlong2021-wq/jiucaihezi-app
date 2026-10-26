---
name: jc-duanju-pipeline
description: 按用户原文附件或路径及基本改编思路，连续执行原作读取、共用项目资料、改编方案、逐章切分与逐集改编，产出供漫剧制作直接使用、每集不超过3分钟的说明书式剧本并逐集补写改编版资料，自检后保存并支持续做；不跨章拼集或挪用邻集内容。
---
# 短剧改编流水线

本入口只有改编这一条流程。用户给出原文附件/路径与基本思路，要求改编或连续完成时，直接组织下面步骤；指定只做某一步/章/集时尊重范围，不强跑全书。已有明确思路不再给原创/优化三选一。来源或关键改编目标缺失时一次合并询问必要项，其余按授权连续执行，不逐步询问保存许可。

## 来源与恢复

先wiki_read_guidance(overview)，沿真实index确定唯一Wiki根。用read读取用户实际原文；附件优先复用现有导入后的可读文本/Markdown副本。不是所有PDF/Word都可直接read，无法读取或提取时说明实际缺项，不虚构转换工具。粘贴原文用source_material原样截取；附件/路径文件先read，再用source_material、work_name和content的JSON `{"source_path":"已read的原文路径"}` 原样存入`原始材料/<作品>/原文.md`，不传source_block。后续source_paths、chapters和切分统一引用这份持久副本，并实际read；入库不等于通读。文件原件保持原样，不用模型复写原作。路径在项目外时也先使用现有read权限读取，不能用归档工具绕过沙箱。

读取`改编方案/执行进度.json`及当前实际文件；来源或上游变化先重新核对，不复用过期下游。冷恢复先按原阶段登记当前outputs以恢复运行态，再处理未完成部分；原作在项目外时本轮先read原路径，不能仅凭旧进度授权访问。未完成集稿实际读取核对，不能把同名文件存在当作质量通过。

## 逐步执行

1. **source**：确认真实原作、用户思路与目标章范围，保存初始进度。
2. **materials**：实际读取[项目资料](../jc-xiangmuziliao/SKILL.md)，按本次章范围提取原作梗概、全部必要人物关系/动机/认知、五官/体型/服装、背景规则和场景道具。原文明示、推断、未交代分清，人物造型变化记来源章，不设计原作未给出的五官。research_version=original。
3. **scheme**：read原作梗概与必要人物等资料，实际读取[改编方案](../jc-duanju-cehua/SKILL.md)，完善用户基本思路并保存项目总纲；确有变化的资料记adapted，未变化关联原作，不复制全库。关键冲突先解决，不编剧情补洞。
4. **cuts**：实际读取[逐章规划](../jc-duanju-fenji/SKILL.md)，read有效方案和每章完整原文；每章真实定开头结尾，一章可拆多集，每集是一段连续章内原文且预估不超过3分钟，全局集号连续。保存逐章规划及每集adaptation_cut，核对全章无遗漏/重叠。不得跨章拼集或从邻集搬原文凑钩子。
5. **writing**：逐集read方案、对应规划、该集真实切分、必要人物/场景/道具和已有目标稿，实际读取[逐集改编](../jc-duanju-xiezuo/SKILL.md)。按通用改编圣经执行动作优先、对话其次、OS最后，关系/动机/情绪落实为行为；写清场景、人物造型和剧情道具，打戏逐招写清，台词电影化；原文没写的外形按设计Skill创作。只在本集切分内扩缩写，不增事件/能力/胜负或挪邻集内容。每集自检实际修正后独立保存，再补写本集新出现的改编版资料，核对回执再继续。
6. **complete**：核对目标章覆盖、全部集稿、来源/切分/方案未变化，保存完成进度后报告真实路径。不得把哈希或格式检查称为文学质量验收。

## 进度合同

使用现有wiki_save_artifact，artifact_kind=adaptation_checkpoint，content传JSON，无需video_model或episode_number。阶段顺序固定source→materials→scheme→cuts→writing→complete；outputs只填真实成功保存的当前阶段文件。

- source：`{"stage":"source","source_paths":["真实原文路径"],"outputs":[]}`。默认范围为文件中全部可识别章节；只改部分章时传`chapters:[{"source_path":"真实路径","chapter_heading":"原文完整章标题"}]`。文件需有真实可定位章标题，不能把整书伪装成一章。
- materials：`{"stage":"materials","outputs":["wiki/项目资料/原作/故事梗概.md","本次其余实际资料路径"]}`。
- scheme：outputs包括`wiki/改编方案/项目总纲.md`及实际改编资料。
- cuts：`{"stage":"cuts","episodes":[1,2],"outputs":["wiki/改编方案/逐章规划.md","wiki/改编方案/分集切分/第001集原文.md","wiki/改编方案/分集切分/第002集原文.md"]}`。旧库规划路径按真实回执填写。episodes是本次连续目标集号，不一定从1起。
- writing：登记所有目标集的实际`wiki/剧本/第001集/分集剧本.md`等，以及写作中新增或更新的`wiki/项目资料/改编版/**`资料；改过的改编版资料必须在本次outputs中重新登记，原作资料、切分和总纲在写作阶段不可改。
- complete：`{"stage":"complete","outputs":[]}`，程序写status=completed。sources、files和chapters等事实由程序继承，不手造哈希。

不能继续时在当前有效阶段登记原outputs与status=blocked、reason具体缺项；不能报完成。用户取消立即停止；无进展时具体报告，不无限循环。不用普通write篡改切分/进度绕过校验。

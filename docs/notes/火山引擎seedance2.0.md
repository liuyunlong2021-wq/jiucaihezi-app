`POST https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks` [运行](https://api.volcengine.com/api-explorer/?action=CreateContentsGenerationsTasks&data=%7B%7D&groupName=%E8%A7%86%E9%A2%91%E7%94%9F%E6%88%90API&query=%7B%7D&serviceCode=ark&version=2024-01-01)

本文介绍创建视频生成任务 API 的输入输出参数，供您使用接口时查阅字段含义。模型会依据传入的图片及文本信息生成视频，待生成完成后，您可以按条件查询任务并获取生成的视频。

<div data-tips="true" data-tips-type="warning" data-tips-is-title="true">注意</div>


<div data-tips="true" data-tips-type="warning">火山方舟现已上线 Seedance 2.0 mini 模型。当前仅支持 <a href="https://console.volcengine.com/ark/region:ark+cn-beijing/experience/vision?modelId=doubao-seedance-2-0-mini-260615">控制台体验中心</a> 调试体验（体验期内控制台体验中心的并发数限制为 1，体验期结束后将恢复默认限流），预计北京时间 6月25日 支持 API 调用。</div>


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">说明</div>


<div data-tips="true" data-tips-type="tip">开通 Seedance 2.0 系列模型前，请确保您<strong>满足以下任一条件</strong>：</div>



* <div data-tips="true" data-tips-type="tip">账户余额 \> 200 元（<a href="https://console.volcengine.com/finance/fund/recharge?_vtm_=a106466.b106468.0_0.0_0.0.1086_7646310968578557482">前往充值</a>）</div>


* <div data-tips="true" data-tips-type="tip">已购买 Seedance 2.0 系列资源包且有可用余量（<a href="https://console.volcengine.com/common-buy/fast/ark_bd%7C%7Cd682ppeeq1mp7kd5q0e0?_vtm_=a106466.b106468.0_0.0_0.0.1086_7646310968578557482">前往购买</a>）</div>


   <div data-tips="true" data-tips-type="tip">详细规则见 <a href="https://www.volcengine.com/docs/82379/2191775?lang=zh">Seedance 2.0 系列模型资源包使用规则</a>。   </div>
   



**模型能力<mark><sup>new</sup></mark>**


* **Doubao Seedance 2.0 系列<mark><sup>new</sup></mark>**  **(有声视频/无声视频)** 

   * **多模态参考生视频<mark><sup>new</sup></mark>**：输入<ins>参考图片（0\-9）+参考视频（0\-3）+ 参考音频（0\-3）+ 文本提示词（可选）</ins>生成 1 个目标视频。注意不可单独输入音频，应至少包含 1 个参考视频或图片。支持生成全新视频、编辑视频、延长视频，[阅读教程](https://www.volcengine.com/docs/82379/2291680) 获取详细代码示例。

   * **图生视频\-首尾帧**：输入<ins>首帧图片+尾帧图片+文本提示词（可选）</ins>生成 1 个目标视频。

   * **图生视频\-首帧**：输入<ins>首帧图片+文本提示词（可选）</ins>生成 1 个目标视频。

   * **文生视频**：输入<ins>文本提示词</ins>生成 1 个目标视频。

* **Doubao Seedance 1.5 Pro (有声视频/无声视频)** 

   【图生视频\-首尾帧】【图生视频\-首帧】【文生视频】

* **Doubao Seedance 1.0 Pro**

   【图生视频\-首尾帧】【图生视频\-首帧】【文生视频】

* **Doubao Seedance 1.0 Pro Fast**

   【图生视频\-首帧】【文生视频】


&nbsp;

<span id="5qndT7DS"></span>
## 鉴权

本接口仅支持 API Key 鉴权，请在 [获取 API Key](https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey) 页面，获取长效 API Key。


---



<span id="i6I5fT3J"></span>
## 请求参数

> 跳转 [响应参数](https://www.volcengine.com/docs/82379/1520757#y2hhTyHB)


<span id="wsGzv1pD"></span>
### Body 参数


---



**model** `string` `必选`

您需要调用的模型的 ID （Model ID），[开通模型服务](https://console.volcengine.com/ark/region:ark+cn-beijing/openManagement?LLM=%7B%7D&OpenTokenDrawer=false)，并[查询 Model ID](https://www.volcengine.com/docs/82379/1330310) 。

您也可通过 Endpoint ID 来调用模型，获得限流、计费类型（前付费/后付费）、运行状态查询、监控、安全等高级能力，可参考[获取 Endpoint ID](https://www.volcengine.com/docs/82379/1099522)。


---



**content** `object[]` `必选`

输入给模型，生成视频的信息，支持文本、图片、音频、视频、样片任务 ID。

<div data-tips="true" data-tips-type="warning" data-tips-is-title="true">注意</div>


<div data-tips="true" data-tips-type="warning">Seedance 2.0 系列模型不支持直接上传含有真人人脸的参考图/视频。为了便利创作者对肖像的使用，平台推出了以下解决方案，详情参见 <a href="https://www.volcengine.com/docs/82379/2291680?lang=zh#5c67c9a1">教程</a>。</div>



* <div data-tips="true" data-tips-type="warning">支持使用部分模型的含人脸原始产物作为输入素材</div>


* <div data-tips="true" data-tips-type="warning">支持使用预置虚拟人像作为输入素材</div>


* <div data-tips="true" data-tips-type="warning">支持使用已授权真人素材作为输入</div>



支持以下几种组合：


* **文本**

* **文本（可选）+ 图片**

* **文本（可选）+ 视频**

* **文本（可选）+ 图片 + 音频**

* **文本（可选）+ 图片 + 视频**

* **文本（可选）+ 视频 + 音频**

* **文本（可选）+ 图片 + 视频 + 音频**

* **样片任务 ID**：样片指使用 Seedance 模型成功生成的样片视频，模型可基于样片生成高质量正式视频。



信息类型


---



**文本信息** `object`

输入给模型的提示词信息。


属性


---



content.**type** `string` `必选`

输入内容的类型，此处应为 `text`。


---



content.**text** `string` `必选`

输入给模型的文本提示词，描述期望生成的视频。

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">说明</div>



* <div data-tips="true" data-tips-type="tip">提示词语言支持：所有模型均支持中英文提示词；Seedance 2.0 系列额外支持日语、印尼语、西班牙语、葡萄牙语。</div>


* <div data-tips="true" data-tips-type="tip">提示词字数建议：中文提示词不超过500字，英文提示词不超过1000词。字数过多易导致信息分散，模型可能忽略细节、仅关注重点，进而造成视频缺失部分元素。</div>


* <div data-tips="true" data-tips-type="tip">更多使用技巧：提示词的详细使用技巧，请参见 <a href="https://www.volcengine.com/docs/82379/2222480?lang=zh">Seedance 提示词指南</a>。</div>




---



**图片信息<mark><sup>new</sup></mark>** `object`

输入给模型的图片信息。


属性


---



content.**type** `string` `必选`

输入内容的类型，此处应为 `image_url`。


---



content.**image_url** `object` `必选`

输入给模型的图片对象。


属性


---



content.image_url.**url** `string` `必选`

图片 URL 、图片 Base64 编码、素材 ID。


* 图片 URL：填入图片的公网 URL。

* Base64 编码：将本地文件转换为 Base64 编码字符串，然后提交给大模型。遵循格式：`data:image/<图片格式>;base64,<Base64编码>`，注意 `<图片格式>` 需小写，如 `data:image/png;base64,{base64_image}`。

* 素材 ID：用于视频生成的预置素材及虚拟人像的 ID，遵循格式：asset://<ASSET_ID\>。可从 [素材&虚拟人像库](https://console.volcengine.com/ark/region:ark+cn-beijing/experience/vision?modelId=doubao-seedance-2-0-260128) 获取。


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">说明</div>


<div data-tips="true" data-tips-type="tip">传入单张图片要求</div>



* <div data-tips="true" data-tips-type="tip">格式：jpeg、png、webp、bmp、tiff、gif。其中，Seedance 1.5 Pro 和 Seedance 2.0 系列模型新增支持 heic 和 heif。</div>


* <div data-tips="true" data-tips-type="tip">宽高比（宽/高）： (0.4, 2.5)</div>


* <div data-tips="true" data-tips-type="tip">宽高长度（px）：(300, 6000)</div>


* <div data-tips="true" data-tips-type="tip">大小：单张图片小于 30 MB。请求体大小不超过 64 MB。大文件请勿使用Base64编码。</div>


* <div data-tips="true" data-tips-type="tip">图片数量：</div>


   * <div data-tips="true" data-tips-type="tip">图生视频\-首帧：1 张</div>


   * <div data-tips="true" data-tips-type="tip">图生视频\-首尾帧：2 张</div>


   * <div data-tips="true" data-tips-type="tip">Seedance 2.0 系列 多模态参考生视频：1~9 张</div>




---



content.**role** `string` `条件必填`

图片的位置或用途。

<div data-tips="true" data-tips-type="warning" data-tips-is-title="true">注意</div>



* <div data-tips="true" data-tips-type="warning"><strong>图生视频\-首帧、图生视频\-首尾帧、多模态参考生视频</strong>（包括参考图、视频、音频）为 3 种互斥场景，<strong>不可混用</strong>。</div>


* <div data-tips="true" data-tips-type="warning"><strong>多模态参考生视频</strong>可通过提示词指定参考图片作为首帧/尾帧，间接实现“首尾帧+多模态参考”效果。若需严格保障首尾帧和指定图片一致，<strong>优先使用图生视频\-首尾帧</strong>（配置 role 为 first_frame/last_frame）。</div>




图生视频\-首帧


* **支持模型**：所有模型

* **字段role取值**：需要传入1个 image_url 对象，字段 role 为 first_frame 或不填。



图生视频\-首尾帧


* **支持模型**：Seedance 2.0 系列，Seedance 1.5 Pro、Seedance 1.0 Pro

* **字段role取值**：需要传入2个image_url对象，且字段 role 必填。

   * 首帧图片对应的字段 role 为：first_frame

   * 尾帧图片对应的字段 role 为：last_frame


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">说明</div>


<div data-tips="true" data-tips-type="tip">传入的首尾帧图片可相同。首尾帧图片的宽高比不一致时，以首帧图片为主，尾帧图片会自动裁剪适配。</div>




图生视频\-参考图


* **支持模型**：Seedance 2.0 系列（1~9 张图片）

* **字段role取值**：必填，每张参考图对应的字段 role 均为：reference_image




---



**视频信息<mark><sup>new</sup></mark>** `object`

输入给模型的视频信息。仅 Seedance 2.0 系列支持输入视频。

方舟平台信任 Seedance 2.0 系列模型生成的含人脸视频，您可使用**本账号下近30天内由上述模型生成的含人脸原始视频**，作为输入素材进行二次创作，详情参见 [教程](https://www.volcengine.com/docs/82379/2291680?lang=zh#341d7f71)。


属性

content.**type** `string` `必选`

输入内容的类型，此处应为`video_url`。


---



content.**video_url** `object` `必选`

输入给模型的视频对象。


属性

content.video_url.**url** `string` `必选`

视频URL、素材 ID。


* 视频 URL：填入视频的公网 URL。

* 素材 ID：用于视频生成的预置素材及虚拟人像视频的 ID，遵循格式：asset://<ASSET_ID\>。可从[素材&虚拟人像库](https://console.volcengine.com/ark/region:ark+cn-beijing/experience/vision?modelId=doubao-seedance-2-0-260128)获取。


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">说明</div>


<div data-tips="true" data-tips-type="tip">传入单个视频要求</div>



* <div data-tips="true" data-tips-type="tip">视频格式：mp4、mov，支持编码格式见下表。</div>


* <div data-tips="true" data-tips-type="tip">分辨率：480p，720p，1080p，4k</div>


* <div data-tips="true" data-tips-type="tip">时长：单个视频时长 [2, 15] s，最多传入 3 个参考视频，所有视频总时长不超过 15s。</div>


* <div data-tips="true" data-tips-type="tip">尺寸：</div>


   * <div data-tips="true" data-tips-type="tip">宽高比（宽/高）：[0.4, 2.5]</div>


   * <div data-tips="true" data-tips-type="tip">宽高长度（px）：[300, 6000]</div>


   * <div data-tips="true" data-tips-type="tip">总像素数：[640×640=409600, 3326×2494=8295044]，即宽和高的乘积符合 [409600, 8295044] 的区间要求。</div>


* <div data-tips="true" data-tips-type="tip">大小：单个视频不超过 200 MB。</div>


* <div data-tips="true" data-tips-type="tip">帧率 (FPS)：[24, 60]</div>




|**容器格式** |**常用文件扩展名** |**MIME** |**支持编码** |
|---|---|---|---|
|MP4 |.mp4 |video/mp4 |视频：H.264/AVC、H.265/HEVC<br><br>音频：AAC、MP3 |
|QuickTime |.mov |video/quicktime |视频：H.264/AVC、H.265/HEVC<br><br>音频：AAC、MP3 |




---



content.**role** `string` `条件必填`

视频的位置或用途。当前仅支持 reference_video：参考视频。



---



**音频信息<mark><sup>new</sup></mark>** `object`

输入给模型的音频信息。仅 Seedance 2.0 系列支持输入音频。

注意不可单独输入音频，应至少包含 1 个参考视频或图片。


属性

content.**type** `string` `必选`

输入内容的类型，此处应为`audio_url`。


---



content.**audio_url** `object` `必选`

输入给模型的音频对象。


属性

content.audio_url.**url** `string` `必选`

音频 URL 、音频 Base64 编码、素材 ID。


* 音频 URL：填入音频的公网 URL。

* Base64 编码：将本地文件转换为 Base64 编码字符串，然后提交给大模型。遵循格式：`data:audio/<音频格式>;base64,<Base64编码>`，注意 `<音频格式>` 需小写，如 `data:audio/wav;base64,{base64_audio}`。

* 素材 ID：用于视频生成的虚拟人的音频素材 ID，遵循格式：asset://<ASSET_ID\>。可从[素材&虚拟人像库](https://console.volcengine.com/ark/region:ark+cn-beijing/experience/vision?modelId=doubao-seedance-2-0-260128)获取。


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">说明</div>


<div data-tips="true" data-tips-type="tip">传入单个音频要求</div>



* <div data-tips="true" data-tips-type="tip">格式：wav、mp3</div>


* <div data-tips="true" data-tips-type="tip">时长：单个音频时长 [2, 15] s，最多传入 3 段参考音频，所有音频总时长不超过 15 s。</div>


* <div data-tips="true" data-tips-type="tip">大小：单个音频不超过 15 MB，请求体大小不超过 64 MB。大文件请勿使用Base64编码。</div>




---



content.**role** `string` `条件必填`

音频的位置或用途。当前仅支持 reference_audio：参考音频。



---



**样片信息** `object`

基于样片任务 ID，生成正式视频。仅 Seedance 1.5 Pro 支持该功能。[阅读](https://www.volcengine.com/docs/82379/1366799?lang=zh#5acd28c8)[文档](https://www.volcengine.com/docs/82379/1366799?lang=zh#5acd28c8) 获取 draft 功能的使用教程和注意事项。


属性


---



content.**type** `string` `必选`

输入内容的类型，此处应为 `draft_task`。


---



content.**draft_task** `object` `必选`

输入给模型的样片任务。


属性


---



content.draft_task.**id** `string` `必选`

样片任务 ID。平台将自动复用 Draft 视频使用的用户输入（\*\*model、\*\*content.\*\*text、\*\*content.**image_url、generate_audio、seed、ratio、duration、camera_fixed** ），生成正式视频。其余参数支持指定，不指定将使用本模型的默认值。

使用分为两步：Step1: 调用本接口生成 Draft 视频。Step2: 如果确认 Draft 视频符合预期，可基于 Step1 返回的 Draft 视频任务 ID，调用本接口生成最终视频。[阅读文档](https://www.volcengine.com/docs/82379/1366799?lang=zh#5acd28c8) 获取详细教程。





---



**callback_url** `string`

填写本次生成任务结果的回调通知地址。当视频生成任务有状态变化时，方舟将向此地址推送 POST 请求。

回调请求内容结构与[查询任务API](https://www.volcengine.com/docs/82379/1521309)的返回体一致。

回调返回的 status 包括以下状态：


* queued：排队中。

* running：任务运行中。

* succeeded： 任务成功。（如发送失败，即5秒内没有接收到成功发送的信息，回调三次）

* failed：任务失败。（如发送失败，即5秒内没有接收到成功发送的信息，回调三次）

* expired：任务超时，即任务处于**运行中或排队中**状态超过过期时间。可通过**execution_expires_after** 字段设置过期时间。



---



**return_last_frame** `boolean` `默认值 false`


* true：返回生成视频的尾帧图像。设置为 `true` 后，可通过 [查询视频生成任务接口](https://www.volcengine.com/docs/82379/1521309) 获取视频的尾帧图像。尾帧图像的格式为 png，宽高像素值与生成的视频保持一致，无水印。

   使用该参数可实现生成多个连续视频：以上一个生成视频的尾帧作为下一个视频任务的首帧，快速生成多个连续视频，调用示例详见 [教程](https://www.volcengine.com/docs/82379/1366799?lang=zh#141cf7fa)。

* false：不返回生成视频的尾帧图像。



---



**service_tier** `string` `默认值 default`

> 不支持修改已提交任务的服务等级

> Seedance 2.0 系列仅支持在线推理模式，不支持配置该参数


指定处理本次请求的服务等级类型，枚举值：


* default：在线推理模式，RPM 和并发数配额较低（详见 [模型列表](https://www.volcengine.com/docs/82379/1330310?lang=zh#7571da3f)），适合对推理时效性要求较高的场景。

* flex：离线推理模式，TPD 配额更高（详见 [模型列表](https://www.volcengine.com/docs/82379/1330310?lang=zh#7571da3f)），价格为在线推理的 50%， 适合对推理时延要求不高的场景。



---



**execution_expires_after** `integer` `默认值 172800`

任务超时阈值。指定任务提交后的过期时间（单位：秒），从 **created at** 时间戳开始计算。默认值 172800 秒，即 48 小时。取值范围：[3600，259200]。

不论使用哪种 **service_tier**，都建议根据业务场景设置合适的超时时间。超过该时间后任务会被自动终止，并标记为`expired`状态。


---



**generate_audio** `boolean` `默认值 true`

> 仅 Seedance 2.0 系列、Seedance 1.5 Pro 支持


控制生成的视频是否包含与画面同步的声音。


* true：模型输出的视频包含同步音频。模型会基于文本提示词与视觉内容，自动生成与之匹配的人声、音效及背景音乐。建议将对话部分置于双引号内，以优化音频生成效果。例如：男人叫住女人说：“你记住，以后不可以用手指指月亮。”

* false：模型输出的视频为无声视频。


<div data-tips="true" data-tips-type="warning" data-tips-is-title="true">注意</div>


<div data-tips="true" data-tips-type="warning">生成的有声视频均为单声道，和传入的音频声道数无关。</div>



---



**draft** `boolean` `默认值 false`

> 仅 Seedance 1.5 Pro 支持


控制是否开启样片模式。[阅读文档](https://www.volcengine.com/docs/82379/1366799?lang=zh#5acd28c8) 获取使用教程和注意事项。


* true：开启样片模式，生成一段预览视频，快速验证场景结构、镜头调度、主体动作与 Prompt 意图是否符合预期。消耗 token 数较正常视频更少，使用成本更低。

* false：关闭样片模式，正常生成一段视频。


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">说明</div>


<div data-tips="true" data-tips-type="tip">开启样片模式后，将使用 480p 分辨率生成 Draft 视频（使用其他分辨率会报错），不支持返回尾帧功能，不支持离线推理功能。</div>



---



**tools<mark><sup>new</sup></mark>** `object[]`

> 仅 Seedance 2.0 系列 支持


配置模型要调用的工具。


属性

tools.**type** `string`

指定使用的工具类型。


* web_search：联网搜索工具。[阅读教程](https://www.volcengine.com/docs/82379/2291680?lang=zh#c40ed3ef) 获取详细代码示例。


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">说明</div>



* <div data-tips="true" data-tips-type="tip">开启联网搜索后，模型会根据用户的提示词自主判断是否搜索互联网内容（如商品、天气等）。可提升生成视频的时效性，但也会增加一定的时延。</div>


* <div data-tips="true" data-tips-type="tip">实际搜索次数可通过 <a href="https://www.volcengine.com/docs/82379/1521309?lang=zh">查询视频生成任务 API</a> 返回的 usage.tool_usage.<strong>web_search</strong> 字段获取，如果为 0 表示未搜索。</div>




---



**safety_identifier<mark><sup>new</sup></mark>** `string`

终端用户的唯一标识符，用于协助平台检测您的应用中可能违反火山方舟使用政策的用户。该标识符为英文字符串，需保证对单个用户固定且唯一，长度不超过 64 个字符。推荐传入对用户名、用户 ID 或邮箱进行哈希处理后生成的字符串，避免泄露用户隐私信息。


---



**priority<mark><sup>new</sup></mark>** `integer` `默认值 0`

> 仅 Seedance 2.0 系列支持


设置当前请求的执行优先级，决定其在队列中的排序位置。取值范围：0~9，数值越大，优先级越高。

默认情况下，请求按 FIFO（First In, First Out，先进先出）顺序执行。设置较高优先级后，该请求将插队到同 Endpoint（推理接入点）下所有低优先级请求之前。

**示例**：

某 Endpoint 当前队列中有 3 个排队中（status=`queued`）任务，优先级均为 0（默认）。

队列：[任务A: priority=0] → [任务B: priority=0] → [任务C: priority=0]

此时提交一个 priority=5 的新请求，该请求将直接排到队首：

队列：[新请求: priority=5] → [任务A: priority=0] → [任务B: priority=0] → [任务C: priority=0]

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">说明</div>



* <div data-tips="true" data-tips-type="tip">相同优先级的请求之间仍按 FIFO 排序。</div>


* <div data-tips="true" data-tips-type="tip">优先级仅影响排队顺序，不会中断正在执行中（status=<code>running</code>）的任务。</div>


* <div data-tips="true" data-tips-type="tip">优先级仅在同一 Endpoint 内生效，不影响其他 Endpoint。</div>


* <div data-tips="true" data-tips-type="tip">离线推理模式（service_tier=flex）不支持配置优先级。</div>




---



<div data-tips="true" data-tips-type="warning" data-tips-is-title="true">注意</div>


<div data-tips="true" data-tips-type="warning">部分参数升级说明</div>



* <div data-tips="true" data-tips-type="warning"><strong>对于 resolution、ratio、duration、frames、seed、camera_fixed、watermark 参数，平台升级了参数传入方式，示例如下。所有模型依然兼容支持旧方式。</strong></div>


* <div data-tips="true" data-tips-type="warning">不同模型，可能对应支持不同的参数与取值，详见 <a href="https://www.volcengine.com/docs/82379/1366799?lang=zh#9fe4cce0">输出视频格式</a>。当输入的参数或取值不符合所选的模型时，该参数将被忽略或触发报错：</div>


   * <div data-tips="true" data-tips-type="warning">新方式：在 request body 中直接传入参数。此方式为<strong>强校验</strong>，若参数填写错误，模型会返回错误提示。</div>


   * <div data-tips="true" data-tips-type="warning">旧方式：在文本提示词后追加 \-\-[parameters]。此方式为<strong>弱校验</strong>，若参数填写错误，该参数将被忽略或触发报错。</div>




**新方式（推荐）：在 request body 中直接传入参数**

```JSON
...
   // Specify the aspect ratio of the generated video as 16:9, duration as 5 seconds, resolution as 720p, seed as 11, and include a watermark. The camera is not fixed.
    "model": "doubao-seedance-1-5-Pro-251215",
    "content": [
        {
            "type": "text",
            "text": "小猫对着镜头打哈欠"
        }
    ],
    // All parameters must be written in full; abbreviations are not supported
    "resolution": "720p",
    "ratio":"16:9",
    "duration": 5,
    // "frames": 29, Either duration or frames is required
    "seed": 11,
    "camera_fixed": false,
    "watermark": true
...
```




**旧方式：在文本提示词后追加 \-\-[parameters]** 

```JSON
...
   // Specify the aspect ratio of the generated video as 16:9, duration as 5 seconds, resolution as 720p, seed as 11, and include a watermark. The camera is not fixed.
    "model": "doubao-seedance-1-5-Pro-251215",
    "content": [
        {
            "type": "text",
            "text": "小猫对着镜头打哈欠 --rs 720p --rt 16:9 --dur 5 --seed 11 --cf false --wm true"
            // "text": "小猫对着镜头打哈欠 --resolution 720p --ratio 16:9 --duration 5 --seed 11 --camerafixed false --watermark true"
        }
    ]
...
```




---



**resolution** `string`

> Seedance 2.0 系列、Seedance 1.5 Pro 默认值：`720p`

> Seedance 1.0 Pro、Seedance 1.0 Pro Fast 默认值：`1080p`


视频分辨率，枚举值：


* 480p

* 720p

* 1080p：Seedance 2.0 Fast 和 2.0 Seedance 2.0 Mini 不支持。

* 4k **<mark><sup>new</sup></mark>**：仅 Seedance 2.0 支持。


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">说明</div>



* <div data-tips="true" data-tips-type="tip">相较于一般的 8bit 位深，Seedance 2.0 输出的 4k 视频采用 10bit 位深编码，能够完整保留丰富的色彩层次与平滑的渐变过渡，满足专业影视制作与 HDR 视频内容的要求。</div>


* <div data-tips="true" data-tips-type="tip">4k 视频采用 H.265 (HEVC) 编码格式输出，部分播放器/浏览器可能无法直接播放。</div>




---



**ratio** `string`

> Seedance 2.0 系列、Seedance 1.5 Pro 默认值为 `adaptive`

> 其他模型：文生视频默认值 `16:9`，图生视频默认值 `adaptive`


生成视频的宽高比例。不同宽高比对应的宽高像素值见下方表格。


* 16:9

* 4:3

* 1:1

* 3:4

* 9:16

* 21:9

* adaptive：根据输入自动选择最合适的宽高比（详见下文说明）


<div data-tips="true" data-tips-type="warning" data-tips-is-title="true">注意</div>


<div data-tips="true" data-tips-type="warning"><strong>adaptive</strong> 适配规则</div>


<div data-tips="true" data-tips-type="warning">当配置 <strong>ratio</strong> 为 <code>adaptive</code> 时，模型会根据生成场景自动适配宽高比；实际生成的视频宽高比可通过 <a href="https://www.volcengine.com/docs/82379/1521309?lang=zh">查询视频生成任务 API</a> 返回的 <strong>ratio</strong> 字段获取。</div>


<div data-tips="true" data-tips-type="warning"><strong>支持模型</strong>：</div>



* <div data-tips="true" data-tips-type="warning">Seedance 2.0 系列、Seedance 1.5 Pro 支持</div>


* <div data-tips="true" data-tips-type="warning">其他模型仅图生视频场景支持</div>


   <div data-tips="true" data-tips-type="warning"><strong>取值规则</strong>：   </div>
   

* <div data-tips="true" data-tips-type="warning">文生视频：根据输入的提示词，智能选择最合适的宽高比。</div>


* <div data-tips="true" data-tips-type="warning">首帧 / 首尾帧生视频：根据上传的首帧图片比例，自动选择最接近的宽高比。</div>


* <div data-tips="true" data-tips-type="warning">多模态参考生视频：根据用户提示词意图判断，如果是首帧生视频/编辑视频/延长视频，以该图片/视频为准选择最接近的宽高比；否则，以传入的第一个媒体文件为准（优先级：视频＞图片）选择最接近的宽高比。</div>




不同宽高比对应的宽高像素值

Note：图生视频，选择的宽高比与您上传的图片宽高比不一致时，方舟会对您的图片进行裁剪，裁剪时会居中裁剪，详细规则见 [图片裁剪规则](https://www.volcengine.com/docs/82379/1366799?lang=zh#f76aafc8)。


|分辨率 |宽高比 |宽高像素值<br><br>Seedance 2.0 系列 |宽高像素值<br><br>Seedance 1.5 pro |宽高像素值<br><br>Seedance 1.0 系列 |
|---|---|---|---|---|
|480p |16:9 |864×496 |864×496 |864×480 |
||4:3 |752×560 |752×560 |736×544 |
||1:1 |640×640 |640×640 |640×640 |
||3:4 |560×752 |560×752 |544×736 |
||9:16 |496×864 |496×864 |480×864 |
||21:9 |992×432 |992×432 |960×416 |
|720p |16:9 |1280×720 |1280×720 |1248×704 |
||4:3 |1112×834 |1112×834 |1120×832 |
||1:1 |960×960 |960×960 |960×960 |
||3:4 |834×1112 |834×1112 |832×1120 |
||9:16 |720×1280 |720×1280 |704×1248 |
||21:9 |1470×630 |1470×630 |1504×640 |
|1080p<br><br>> Seedance 2.0 Fast、Seedance 2.0 Mini 不支持 |16:9 |1920×1080 |1920×1080 |1920×1088 |
||4:3 |1664×1248 |1664×1248 |1664×1248 |
||1:1 |1440×1440 |1440×1440 |1440×1440 |
||3:4 |1248×1664 |1248×1664 |1248×1664 |
||9:16 |1080×1920 |1080×1920 |1088×1920 |
||21:9 |2206×946 |2206×946 |2176×928 |
|4k<br><br>> 仅 Seedance 2.0 支持 |16:9 |3840×2160 |— |— |
||4:3 |3326×2494 |— |— |
||1:1 |2880×2880 |— |— |
||3:4 |2494×3326 |— |— |
||9:16 |2160×3840 |— |— |
||21:9 |4398×1886 |— |— |




---



**duration** `integer` `默认值 5`

> duration 和 frames 二选一即可，frames 的优先级高于 duration。如果您希望生成整数秒的视频，建议指定 duration。


生成视频时长，仅支持整数，单位：秒。


* Seedance 1.0 Pro、Seedance 1.0 Pro Fast: [2, 12] s。

* Seedance 1.5 Pro: [4,12] 或设置为`-1`

* Seedance 2.0 系列: [4,15] 或设置为`-1`


<div data-tips="true" data-tips-type="warning" data-tips-is-title="true">注意</div>


<div data-tips="true" data-tips-type="warning">Seedance 2.0 系列、Seedance 1.5 Pro 支持两种配置方法</div>



* <div data-tips="true" data-tips-type="warning">指定具体时长：支持有效范围内的任一整数。</div>


* <div data-tips="true" data-tips-type="warning">智能指定：设置为 <code>-1</code>，表示由模型在有效范围内自主选择合适的视频长度（整数秒）。实际生成视频的时长可通过 <a href="https://www.volcengine.com/docs/82379/1521309?lang=zh">查询视频生成任务 API</a> 返回的 <strong>duration</strong> 字段获取。注意视频时长与计费相关，请谨慎设置。</div>




---



**frames** `integer`

> Seedance 2.0 系列、Seedance 1.5 Pro 暂不支持

> duration 和 frames 二选一即可，frames 的优先级高于 duration。如果您希望生成小数秒的视频，建议指定 frames。


生成视频的帧数。通过指定帧数，可以灵活控制生成视频的长度，生成小数秒的视频。

由于 frames 的取值限制，仅能支持有限小数秒，您需要根据公式推算最接近的帧数。


* 计算公式：帧数 = 时长 × 帧率（24）。

* 取值范围：支持 [29, 289] 区间内所有满足 `25 + 4n` 格式的整数值，其中 n 为正整数。

   例如：假设需要生成 2.4 秒的视频，帧数=2.4×24=57.6。由于 frames 不支持 57.6，此时您只能选择一个最接近的值。根据 25+4n 计算出最接近的帧数为 57，实际生成的视频为 57/24=2.375 秒。



---



**seed** `integer` `默认值 -1`

> Seedance 2.0 系列暂不支持


种子整数，用于控制生成内容的随机性。

取值范围：[\-1, 2^32\-1]之间的整数。

<div data-tips="true" data-tips-type="warning" data-tips-is-title="true">注意</div>



* <div data-tips="true" data-tips-type="warning">相同的请求下，模型收到不同的 seed 值，如：不指定 seed 值或令 seed 取值为\-1（会使用随机数替代）、或手动变更 seed 值，将生成不同的结果。</div>


* <div data-tips="true" data-tips-type="warning">相同的请求下，模型收到相同的 seed 值，会生成类似的结果，但不保证完全一致。</div>




---



**camera_fixed** `boolean` `默认值 false`

> 参考图场景不支持，Seedance 2.0 系列 暂不支持


是否固定摄像头。枚举值：


* true：固定摄像头。平台会在用户提示词中追加固定摄像头，实际效果不保证。

* false：不固定摄像头。



---



**watermark** `boolean` `默认值 false`

生成视频是否包含水印。枚举值：


* false：生成视频不含水印。

* true：生成视频右下角会展示`AI 生成`水印。



---



<span id="oCS1tULg"></span>
## 响应参数

> 跳转 [请求参数](https://www.volcengine.com/docs/82379/1520757#RxN8G2nH)


**id** `string`

视频生成任务 ID 。仅保存 7 天（从 **created at** 时间戳开始计算），超时后将自动清除。


* 设置`"draft": true`，为 Draft 视频任务 ID。

* 设置 `"draft": false`，为正常视频任务 ID。

   创建视频生成任务为异步接口，获取 ID 后，需要通过 [查询视频生成任务 API](https://www.volcengine.com/docs/82379/1521309) 来查询视频生成任务的状态。任务成功后，会输出生成视频的`video_url`。




Doubao Seedance 2.0 系列（下文简称 Seedance 2.0 系列）模型支持图像、视频、音频、文本等多种模态内容输入，具备视频生成、视频编辑、视频延长等能力，可高精度还原物品细节、音色、效果、风格、运镜等，保持稳定角色特征，赋予使用者如同导演般的掌控权。本文介绍 Seedance 2.0 系列模型的专属能力，帮助您快速实现 [Video Generation API](https://www.volcengine.com/docs/82379/1520758) 调用。

<div data-tips="true" data-tips-type="warning" data-tips-is-title="true">注意</div>


<div data-tips="true" data-tips-type="warning">火山方舟现已上线 Seedance 2.0 mini 模型。当前仅支持 <a href="https://console.volcengine.com/ark/region:ark+cn-beijing/experience/vision?modelId=doubao-seedance-2-0-mini-260615">控制台体验中心</a> 调试体验（体验期内控制台体验中心的并发数限制为 1，体验期结束后将恢复默认限流），预计北京时间 6月25日 支持 API 调用。</div>


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">说明</div>


<div data-tips="true" data-tips-type="tip">开通 Seedance 2.0 系列模型前，请确保您满足以下任一条件：</div>



* <div data-tips="true" data-tips-type="tip">账户余额 \> 200 元（<a href="https://console.volcengine.com/finance/fund/recharge">前往充值</a>）</div>


* <div data-tips="true" data-tips-type="tip">已购买 Seedance 2.0 系列资源包且有可用余量 （<a href="https://console.volcengine.com/common-buy/fast/ark_bd%7C%7Cd682ppeeq1mp7kd5q0e0">前往购买</a>）</div>



<div data-tips="true" data-tips-type="tip">详细规则见 <a href="https://www.volcengine.com/docs/82379/2191775?lang=zh">Seedance 2.0 系列模型资源包使用规则</a>。</div>


<span id="e000144b"></span>
# 新手入门

本入门教程专为 **API 新手用户** 设计，帮助您一键搭建 Python 开发环境、完成虚拟环境创建和方舟 SDK 安装，并提供直接可运行的 Seedance 2.0 系列调用代码，您只需修改对应的输入素材，即可开始您的视频生成创作。

**1. 准备工作**

在开始之前，请确保您已经完成以下准备：


1. **注册账号**：确保您拥有火山引擎账号并已[登录](https://console.volcengine.com/)。

2. **获取 API Key**：访问 [API Key 管理页面](https://console.volcengine.com/ark/region:ark+cn-beijing/apikey)，点击 **创建 API Key**，并复制保存您的 API Key。注意请妥善保管您的 API Key，不要泄露给他人。

3. [开通模型](https://console.volcengine.com/ark/region:ark+cn-beijing/openManagement?LLM=%7B%7D&advancedActiveKey=model&projectName=default&tab=ComputerVision)：请确保您的账户余额大于等于 200 元，或已[购买资源包](https://console.volcengine.com/common-buy/fast/ark_bd%7C%7Cd682ppeeq1mp7kd5q0e0)，否则无法开通 Seedance 2.0 系列模型。

4. **下载并解压文件**：点击下载下方附件，将其解压到您的本地目录（如桌面或“下载”文件夹）。

   <Attachment link="https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/1c5fc49ecf2d40b89ef7dd12765e23e7~tplv-goo7wpa0wc-image.image" name="ark_seedance2.0_quickstart_package.zip">ark_seedance2.0_quickstart_package.zip</Attachment>
   


**2.操作步骤**


<Tabs>
<Tab zoneid="FCY4sDan26" title="Windows 用户">
<TabTitle>Windows 用户</TabTitle>

1. 进入 `scripts/init_dev_env` 目录。

2. 双击运行 `setup_windows.bat`。

3. 脚本会自动执行以下操作：

   * 下载 uv 工具。

   * 自动下载 Python 3.12（如果不干扰您的系统 Python）。

   * 创建虚拟环境 .`venv`。

   * 安装方舟 SDK。

4. 完成后，在项目根目录会生成一个 `run_demo.bat`。

5. 双击 `run_demo.bat`，即可运行 Python SDK 示例代码(python/demo_standard.py)。


</Tab>
<Tab zoneid="h4y4PSUkpp" title="macOS 用户">
<TabTitle>macOS 用户</TabTitle>

1. 打开终端，进入 `scripts/init_dev_env` 目录。

2. 运行构建脚本：


```Plain
./setup_mac.sh
```



3. 脚本会自动配置好所有环境。

4. 完成后，在项目根目录会生成一个 `run_demo.sh`。

5. 运行 `./``run_demo.sh` 即可运行 Python SDK 示例代码(python/demo_standard.py)。


</Tab>
</Tabs>


**3.运行说明**

运行脚本后，您将看到如下流程：


1. **API Key 校验**：脚本会自动检测您本地是否配置了`ARK_API_KEY`环境变量。如果没有，会提示您手动输入。

2. **素材预览**：脚本会自动在您的默认浏览器中弹出一个本地生成的 HTML 页面，直观地展示本次任务的文本提示词、待替换的参考图片以及原始参考视频。

3. **任务创建与轮询**：脚本向火山方舟服务器发起异步请求。由于视频生成需要一定时间，控制台会每隔 30 秒打印一次任务状态（如 `running`等）。

4. **获取结果**：任务成功后，控制台会输出一段最终生成的视频 URL。您可以复制该链接到浏览器下载或在线播放。


**4.下一步**

在成功跑通本示例后，您可以尝试修改 `python/``demo_standard.py`，来打造您专属的视频生成任务：


1. 修改文本提示词


找到代码中的 `user_content` 变量，更改为您想要的画面描述。

2. 替换输入素材 (图片、视频、音频)

您可以将 `reference_image_url`、`reference_video_url` 和 `reference_audio_url` 替换为您自己的素材链接。

**注意**：请确保 URL 是公网可公开访问的链接（建议存放在 TOS 对象存储服务中，并配置为公共读）。

3. 继续学习下文中丰富的使用示例。

<span id="fd30cc1a"></span>
# 模型能力

Seedance 2.0 系列模型目前包括 Doubao Seedance 2.0（下文简称 Seedance 2.0）和 Doubao Seedance 2.0 Fast（下文简称 Seedance 2.0 Fast），它们的模型能力相同。追求最高生成品质，推荐使用 Seedance 2.0；更注重成本与生成速度，不要求极限品质，推荐使用 Seedance 2.0 Fast。


<span aceTableMode="list" aceTableWidth="4,4,4,4"></span>
|模型名称 | |[Seedance 2.0](https://console.volcengine.com/ark/region:ark+cn-beijing/model/detail?Id=doubao-seedance-2-0&projectName=default) |[Seedance 2.0 Fast](https://console.volcengine.com/ark/region:ark+cn-beijing/model/detail?Id=doubao-seedance-2-0-fast&projectName=default) |
|---|---|---|---|
|Model ID | |doubao\-seedance\-2\-0\-260128 |doubao\-seedance\-2\-0\-fast\-260128 |
|[文生视频](https://www.volcengine.com/docs/82379/2298881?lang=zh#4e74bcee) | |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|[图生视频-首帧](https://www.volcengine.com/docs/82379/2298881?lang=zh#979b2d28) | |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|[图生视频-首尾帧](https://www.volcengine.com/docs/82379/2298881?lang=zh#0d55ca07) | |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|[多模态参考](https://www.volcengine.com/docs/82379/2291680?lang=zh#50e1b4ea)【New】 |图片参考 |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
||视频参考 |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
||组合参考<br><br><br>* 图片 + 音频<br><br>* 图片 + 视频<br><br>* 视频 + 音频<br><br>* 图片 + 视频 + 音频 |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|[编辑视频](https://www.volcengine.com/docs/82379/2291680?lang=zh#75a28782)【New】 | |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|[延长视频](https://www.volcengine.com/docs/82379/2291680?lang=zh#46d77653)【New】 | |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|[生成有声视频](https://www.volcengine.com/docs/82379/2298881?lang=zh#979b2d28)<br><br>> "generate_audio": "true" | |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|[联网搜索工具](https://www.volcengine.com/docs/82379/2291680?lang=zh#c40ed3ef)【New】 | |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|[样片模式](https://www.volcengine.com/docs/82379/2298881?lang=zh#5acd28c8) | |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) </span> |
|[返回视频产物对应的尾帧图](https://www.volcengine.com/docs/82379/2298881?lang=zh#141cf7fa)<br><br>> "return_last_frame":<br><br>> "true" | |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|[输出视频规格](https://www.volcengine.com/docs/82379/2298881?lang=zh#9fe4cce0) |输出分辨率<br><br>> "resolution": "720p" |480p, 720p, 1080p, 4k（10bit 位深） |480p, 720p |
| |输出宽高比<br><br>> "ratio":"16:9" |21:9, 16:9, 4:3,<br><br>1:1, 3:4, 9:16 |21:9, 16:9, 4:3,<br><br>1:1, 3:4, 9:16 |
| |输出时长<br><br>> "duration": 5 |4~15 秒 |4~15 秒 |
| |输出视频格式 |mp4 |mp4 |
|[离线推理](https://www.volcengine.com/docs/82379/2298881?lang=zh#c3588bd1)<br><br>> "service_tier": "flex" | |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) </span> |
|在线推理限流 |最大 RPM |非 4k 分辨率：<br><br><br>* 企业用户：600<br><br>* 个人用户：180<br><br><br>4k 分辨率：<br><br><br>* 企业用户：15<br><br>* 个人用户：15 |* 企业用户：600<br><br>* 个人用户：180 |
| |最大并发数 |非 4k 分辨率：<br><br><br>* 企业用户：10<br><br>* 个人用户：3<br><br><br>4k 分辨率：<br><br><br>* 企业用户：1<br><br>* 个人用户：1 |* 企业用户：10<br><br>* 个人用户：3 |
|离线推理限流 |TPD |\- |\- |


<span id="dcb767c3"></span>
# 基础使用

<span id="50e1b4ea"></span>
## 多模态参考

输入文本、参考图、视频（可带音轨）和音频等内容，来生成一段新视频。可继承参考图片的角色形象、视觉风格、画面构图；参考视频的主体内容、运镜方式、动作表现、整体风格；以及参考音频的音色、音乐旋律、对话内容等核心信息。

效果预览如下（访问[模型卡片](https://console.volcengine.com/ark/region:ark+cn-beijing/model/detail?Id=doubao-seedance-2-0)查看更多示例）：


<span aceTableMode="list" aceTableWidth="4,5,5"></span>
|输入：文本 |输入：图片、视频、音频 |输出 |
|---|---|---|
|全程使用**视频1**的第一视角构图，全程使用**音频1**作为背景音乐。第一人称视角果茶宣传广告，seedance牌「苹苹安安」苹果果茶限定款；首帧为**图片1**，你的手摘下一颗带晨露的阿克苏红苹果，轻脆的苹果碰撞声；2\-4 秒：快速切镜，你的手将苹果块投入雪克杯，加入冰块与茶底，用力摇晃，冰块碰撞声与摇晃声卡点轻快鼓点，背景音：「鲜切现摇」；4\-6 秒：第一人称成品特写，分层果茶倒入透明杯，你的手轻挤奶盖在顶部铺展，在杯身贴上粉红包标，镜头拉近看奶盖与果茶的分层纹理；6\-8 秒：第一人称手持举杯，你将**图片2**中的果茶举到镜头前（模拟递到观众面前的视角），杯身标签清晰可见，背景音「来一口鲜爽」，尾帧定格为**图片2**。背景声音统一为女生音色。 |<video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/0ba05cd435f543c5bc65c378d94d094a" controls></video><br><br><br><span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/37ef4b6af8944a6d9b54ef1c541c1b0e~tplv-goo7wpa0wc-image.image) </span> <span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/7b904d6b46d24f059de7697620058b7f~tplv-goo7wpa0wc-image.image) </span><br><br><Attachment link="https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/8bbbacecfd7d48dfa7ec6ec74125eb04~tplv-goo7wpa0wc-image.image" name="r2v_tea_audio1.mp3">r2v_tea_audio1.mp3</Attachment><br> |<video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/dab46ce2289a4a8ead76711bb02f2e1d" controls></video><br> |



<Tabs>
<Tab zoneid="LG83VqlsDX" title="Python">
<TabTitle>Python</TabTitle>

```Python
import os
import time
# Install SDK:  pip install 'volcengine-python-sdk[ark]'
from volcenginesdkarkruntime import Ark 

client = Ark(
    # The base URL for model invocation
    base_url='https://ark.cn-beijing.volces.com/api/v3',
    # Get API Key：https://console.volcengine.com/ark/region:ark+cn-beijing/apikey
    api_key=os.environ.get("ARK_API_KEY"),
)

if __name__ == "__main__":
    print("----- create request -----")
    create_result = client.content_generation.tasks.create(
        model="doubao-seedance-2-0-260128", # Replace with Model ID 
        content=[
            {
                "type": "text",
                "text": "全程使用视频1的第一视角构图，全程使用音频1作为背景音乐。第一人称视角果茶宣传广告，seedance牌「苹苹安安」苹果果茶限定款；首帧为图片1，你的手摘下一颗带晨露的阿克苏红苹果，轻脆的苹果碰撞声；2-4 秒：快速切镜，你的手将苹果块投入雪克杯，加入冰块与茶底，用力摇晃，冰块碰撞声与摇晃声卡点轻快鼓点，背景音：「鲜切现摇」；4-6 秒：第一人称成品特写，分层果茶倒入透明杯，你的手轻挤奶盖在顶部铺展，在杯身贴上粉红包标，镜头拉近看奶盖与果茶的分层纹理；6-8 秒：第一人称手持举杯，你将图片2中的果茶举到镜头前（模拟递到观众面前的视角），杯身标签清晰可见，背景音「来一口鲜爽」，尾帧定格为图片2。背景声音统一为女生音色。",
            },
            {
                "type": "image_url",
                "image_url": {
                    "url": "https://ark-project.tos-cn-beijing.volces.com/doc_image/r2v_tea_pic1.jpg"
                },
                "role": "reference_image",
            },
            {
                "type": "image_url",
                "image_url": {
                    "url": "https://ark-project.tos-cn-beijing.volces.com/doc_image/r2v_tea_pic2.jpg"
                },
                "role": "reference_image",
            },
            {
                "type": "video_url",
                "video_url": {
                    "url": "https://ark-project.tos-cn-beijing.volces.com/doc_video/r2v_tea_video1.mp4"
                },
                "role": "reference_video",
            },
            {
                "type": "audio_url",
                "audio_url": {
                    "url": "https://ark-project.tos-cn-beijing.volces.com/doc_audio/r2v_tea_audio1.mp3"
                },
                "role": "reference_audio",
            },
        ],
        generate_audio=True,
        ratio="16:9",
        duration=11,
        watermark=True,
    )
    print(create_result)


    # Polling query section
    print("----- polling task status -----")
    task_id = create_result.id
    while True:
        get_result = client.content_generation.tasks.get(task_id=task_id)
        status = get_result.status
        if status == "succeeded":
            print("----- task succeeded -----")
            print(get_result)
            break
        elif status == "failed":
            print("----- task failed -----")
            print(f"Error: {get_result.error}")
            break
        else:
            print(f"Current status: {status}, Retrying after 30 seconds...")
            time.sleep(30)
```



</Tab>
<Tab zoneid="lXSoaEFhZ2" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.sample;

import com.volcengine.ark.runtime.model.content.generation.*;
import com.volcengine.ark.runtime.model.content.generation.CreateContentGenerationTaskRequest.Content;
import com.volcengine.ark.runtime.service.ArkService;
import okhttp3.ConnectionPool;
import okhttp3.Dispatcher;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

public class ContentGenerationTaskExample {

    // Client initialization
    static String apiKey = System.getenv("ARK_API_KEY");
    static ConnectionPool connectionPool = new ConnectionPool(5, 1, TimeUnit.SECONDS);
    static Dispatcher dispatcher = new Dispatcher();
    static ArkService service = ArkService.builder()
           .baseUrl("https://ark.cn-beijing.volces.com/api/v3") // The base URL for model invocation
           .dispatcher(dispatcher)
           .connectionPool(connectionPool)
           .apiKey(apiKey)
           .build();
           
    public static void main(String[] args) {
        
        // Model ID
        final String modelId = "doubao-seedance-2-0-260128";
        // Text prompt
        final String prompt = "全程使用视频1的第一视角构图，全程使用音频1作为背景音乐。第一人称视角果茶宣传广告，seedance牌「苹苹安安」苹果果茶限定款；" +
                "首帧为图片1，你的手摘下一颗带晨露的阿克苏红苹果，轻脆的苹果碰撞声；" +
                "2-4 秒：快速切镜，你的手将苹果块投入雪克杯，加入冰块与茶底，用力摇晃，冰块碰撞声与摇晃声卡点轻快鼓点，背景音：「鲜切现摇」；" +
                "4-6 秒：第一人称成品特写，分层果茶倒入透明杯，你的手轻挤奶盖在顶部铺展，在杯身贴上粉红包标，镜头拉近看奶盖与果茶的分层纹理；" +
                "6-8 秒：第一人称手持举杯，你将图片2中的果茶举到镜头前（模拟递到观众面前的视角），杯身标签清晰可见，背景音「来一口鲜爽」，尾帧定格为图片2。" +
                "背景声音统一为女生音色。";
        
        // Example resource URLs
        final String refImage1 = "https://ark-project.tos-cn-beijing.volces.com/doc_image/r2v_tea_pic1.jpg";
        final String refImage2 = "https://ark-project.tos-cn-beijing.volces.com/doc_image/r2v_tea_pic2.jpg";
        final String refVideo = "https://ark-project.tos-cn-beijing.volces.com/doc_video/r2v_tea_video1.mp4";
        final String refAudio = "https://ark-project.tos-cn-beijing.volces.com/doc_audio/r2v_tea_audio1.mp3";

        // Output video parameters
        final boolean generateAudio = true;
        final String videoRatio = "16:9";      
        final long videoDuration = 11L;          
        final boolean showWatermark = true;

        System.out.println("----- create request -----");
        // Build request content
        List<Content> contents = new ArrayList<>();
        
        // 1. Text prompt
        contents.add(Content.builder()
                .type("text")
                .text(prompt)
                .build());
                
        // 2. Reference image 1
        contents.add(Content.builder()
                .type("image_url")
                .imageUrl(CreateContentGenerationTaskRequest.ImageUrl.builder()
                        .url(refImage1)
                        .build())
                .role("reference_image")
                .build());

        // 3. Reference image 2
        contents.add(Content.builder()
                .type("image_url")
                .imageUrl(CreateContentGenerationTaskRequest.ImageUrl.builder()
                        .url(refImage2)
                        .build())
                .role("reference_image")
                .build());

        // 4. Reference video
        contents.add(Content.builder()
                .type("video_url")
                .videoUrl(CreateContentGenerationTaskRequest.VideoUrl.builder()
                        .url(refVideo)  
                        .build())
                .role("reference_video")
                .build());

        // 5. Reference audio
        contents.add(Content.builder()
                .type("audio_url")
                .audioUrl(CreateContentGenerationTaskRequest.AudioUrl.builder()
                        .url(refAudio)
                        .build())
                .role("reference_audio")
                .build());

        // Create video generation task
        CreateContentGenerationTaskRequest createRequest = CreateContentGenerationTaskRequest.builder()
                .generateAudio(generateAudio)
                .model(modelId)
                .content(contents)
                .ratio(videoRatio)
                .duration(videoDuration)
                .watermark(showWatermark)
                .build();

        CreateContentGenerationTaskResult createResult = service.createContentGenerationTask(createRequest);
        System.out.println("Task Created: " + createResult);

        // Get task details and poll status
        String taskId = createResult.getId();
        pollTaskStatus(taskId);
    }

    /**
     * Poll task status
     * @param taskId Task ID
     */

    private static void pollTaskStatus(String taskId) {
        GetContentGenerationTaskRequest getRequest = GetContentGenerationTaskRequest.builder()
                .taskId(taskId)
                .build();

        System.out.println("----- polling task status -----");
        try {
            while (true) {
                GetContentGenerationTaskResponse getResponse = service.getContentGenerationTask(getRequest);
                String status = getResponse.getStatus();

                if ("succeeded".equalsIgnoreCase(status)) {
                    System.out.println("----- task succeeded -----");
                    System.out.println(getResponse);
                    break;
                } else if ("failed".equalsIgnoreCase(status)) {
                    System.out.println("----- task failed -----");
                    if (getResponse.getError() != null) {
                        System.out.println("Error: " + getResponse.getError().getMessage());
                    }
                    break;
                } else {
                    System.out.printf("Current status: %s, Retrying in 10 seconds...%n", status);
                    TimeUnit.SECONDS.sleep(10);
                }
            }
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            System.err.println("Polling interrupted");
        } catch (Exception e) {
            System.err.println("Error occurred: " + e.getMessage());
        } finally {
            service.shutdownExecutor();
        }
    }
}
```



</Tab>
<Tab zoneid="lEupKhJKdV" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "os"
    "time"

    "github.com/volcengine/volcengine-go-sdk/service/arkruntime"
    "github.com/volcengine/volcengine-go-sdk/service/arkruntime/model"
    "github.com/volcengine/volcengine-go-sdk/volcengine"
)

func main() {
    // Initialize Ark client
    client := arkruntime.NewClientWithApiKey(
        os.Getenv("ARK_API_KEY"),
        // The base URL for model invocation
        arkruntime.WithBaseUrl("https://ark.cn-beijing.volces.com/api/v3"),
    )
    ctx := context.Background()

    // Model ID
    modelID := "doubao-seedance-2-0-260128"
    // Text prompt
    prompt := "全程使用视频1的第一视角构图，全程使用音频1作为背景音乐。第一人称视角果茶宣传广告，seedance牌「苹苹安安」苹果果茶限定款；" +
        "首帧为图片1，你的手摘下一颗带晨露的阿克苏红苹果，轻脆的苹果碰撞声；" +
        "2-4 秒：快速切镜，你的手将苹果块投入雪克杯，加入冰块与茶底，用力摇晃，冰块碰撞声与摇晃声卡点轻快鼓点，背景音：「鲜切现摇」；" +
        "4-6 秒：第一人称成品特写，分层果茶倒入透明杯，你的手轻挤奶盖在顶部铺展，在杯身贴上粉红包标，镜头拉近看奶盖与果茶的分层纹理；" +
        "6-8 秒：第一人称手持举杯，你将图片2中的果茶举到镜头前（模拟递到观众面前的视角），杯身标签清晰可见，背景音「来一口鲜爽」，尾帧定格为图片2。" +
        "背景声音统一为女生音色。"

    // Example resource URLs
    refImage1 := "https://ark-project.tos-cn-beijing.volces.com/doc_image/r2v_tea_pic1.jpg"
    refImage2 := "https://ark-project.tos-cn-beijing.volces.com/doc_image/r2v_tea_pic2.jpg"
    refVideo := "https://ark-project.tos-cn-beijing.volces.com/doc_video/r2v_tea_video1.mp4"
    refAudio := "https://ark-project.tos-cn-beijing.volces.com/doc_audio/r2v_tea_audio1.mp3"

    // Output video parameters
    generateAudio := true
    videoRatio := "16:9"
    videoDuration := int64(11)
    showWatermark := true

    // 1. Create video generation task
    fmt.Println("----- create request -----")
    createReq := model.CreateContentGenerationTaskRequest{
        Model:         modelID,
        GenerateAudio: volcengine.Bool(generateAudio),
        Ratio:         volcengine.String(videoRatio),
        Duration:      volcengine.Int64(videoDuration),
        Watermark:     volcengine.Bool(showWatermark),
        Content: []*model.CreateContentGenerationContentItem{
            {
                Type: model.ContentGenerationContentItemTypeText,
                Text: volcengine.String(prompt),
            },
            {
                Type: model.ContentGenerationContentItemType("image_url"),
                ImageURL: &model.ImageURL{
                    URL: refImage1,
                },
                Role: volcengine.String("reference_image"),
            },
            {
                Type: model.ContentGenerationContentItemType("image_url"),
                ImageURL: &model.ImageURL{
                    URL: refImage2,
                },
                Role: volcengine.String("reference_image"),
            },
            {
                Type: model.ContentGenerationContentItemType("video_url"),
                VideoURL: &model.VideoUrl{
                    Url: refVideo,
                },
                Role: volcengine.String("reference_video"),
            },
            {
                Type: model.ContentGenerationContentItemType("audio_url"),
                AudioURL: &model.AudioUrl{
                    Url: refAudio,
                },
                Role: volcengine.String("reference_audio"),
            },
        },
    }

    createResp, err := client.CreateContentGenerationTask(ctx, createReq)
    if err != nil {
        fmt.Printf("create content generation error: %v\n", err)
        return
    }

    taskID := createResp.ID
    fmt.Printf("Task Created with ID: %s\n", taskID)

    // 2. Poll task status
    pollTaskStatus(ctx, client, taskID)
}

// poll task status
func pollTaskStatus(ctx context.Context, client *arkruntime.Client, taskID string) {
    fmt.Println("----- polling task status -----")
    for {
        getReq := model.GetContentGenerationTaskRequest{ID: taskID}
        getResp, err := client.GetContentGenerationTask(ctx, getReq)
        if err != nil {
            fmt.Printf("get content generation task error: %v\n", err)
            return
        }

        status := getResp.Status
        if status == "succeeded" {
            fmt.Println("----- task succeeded -----")
            fmt.Printf("Task ID: %s \n", getResp.ID)
            fmt.Printf("Model: %s \n", getResp.Model)
            fmt.Printf("Video URL: %s \n", getResp.Content.VideoURL)
            fmt.Printf("Completion Tokens: %d \n", getResp.Usage.CompletionTokens)
            fmt.Printf("Created At: %d, Updated At: %d\n", getResp.CreatedAt, getResp.UpdatedAt)
            return
        } else if status == "failed" {
            fmt.Println("----- task failed -----")
            if getResp.Error != nil {
                fmt.Printf("Error Code: %s, Message: %s\n", getResp.Error.Code, getResp.Error.Message)
            }
            return
        } else {
            fmt.Printf("Current status: %s, Retrying in 10 seconds... \n", status)
            time.Sleep(10 * time.Second)
        }
    }
}
```



</Tab>
</Tabs>


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">说明</div>



* <div data-tips="true" data-tips-type="tip">您可任意组合以下模态内容，注意不支持“文本+音频”、“纯音频” 输入。</div>


   * <div data-tips="true" data-tips-type="tip">文本</div>


   * <div data-tips="true" data-tips-type="tip">图片：0~9 张</div>


   * <div data-tips="true" data-tips-type="tip">视频：0~3 个</div>


   * <div data-tips="true" data-tips-type="tip">音频：0~3 个</div>


* <div data-tips="true" data-tips-type="tip"><strong>进阶用法</strong>：多模态生视频可通过提示词指定参考图片作为首帧/尾帧，间接实现“首尾帧+多模态参考”效果。若需严格保障首尾帧和指定图片一致，<strong>优先使用图生视频\-首尾帧</strong>（配置 role 为 first_frame/last_frame）。</div>


* <div data-tips="true" data-tips-type="tip">各个模态信息输入要求参见<a href="https://www.volcengine.com/docs/82379/1366799#63a97f09">多模态输入</a>。</div>



<span id="75a28782"></span>
## 编辑视频

您可以提供待编辑的视频、参考图片或音频，并结合使用提示词，完成多种视频编辑任务，例如：替换视频主体、视频中对象增删改、局部画面重绘/修复等。

效果预览如下（访问[模型卡片](https://console.volcengine.com/ark/region:ark+cn-beijing/model/detail?Id=doubao-seedance-2-0)查看更多示例）：


<span aceTableMode="list" aceTableWidth="4,5,5"></span>
|输入：文本 |输入：视频&图片 |输出 |
|---|---|---|
|将**视频1**礼盒中的香水替换成**图像1**中的面霜，运镜不变 |<video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/0a1afd3250d84b8995e9c0aa61b57d38" controls></video><br><br><br><span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/791b783fc6cd4394b13f41b66b5ff461~tplv-goo7wpa0wc-image.image) </span> |<video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/fd7bcf4eaf504f50aeeebd48ce35c06a" controls></video><br> |



<Tabs>
<Tab zoneid="sgO29rMlDT" title="Python">
<TabTitle>Python</TabTitle>

```Python
import os
import time
# Install SDK:  pip install 'volcengine-python-sdk[ark]'
from volcenginesdkarkruntime import Ark 

client = Ark(
    # The base URL for model invocation
    base_url='https://ark.cn-beijing.volces.com/api/v3',
    # Get API Key：https://console.volcengine.com/ark/region:ark+cn-beijing/apikey
    api_key=os.environ.get("ARK_API_KEY"),
)

if __name__ == "__main__":
    print("----- create request -----")
    create_result = client.content_generation.tasks.create(
        model="doubao-seedance-2-0-260128", # Replace with Model ID 
        content=[
            {
                "type": "text",
                "text": "将视频1礼盒中的香水替换成图片1中的面霜，运镜不变",
            },
            {
                "type": "image_url",
                "image_url": {
                    "url": "https://ark-project.tos-cn-beijing.volces.com/doc_image/r2v_edit_pic1.jpg"
                },
                "role": "reference_image",
            },
            {
                "type": "video_url",
                "video_url": {
                    "url": "https://ark-project.tos-cn-beijing.volces.com/doc_video/r2v_edit_video1.mp4"
                },
                "role": "reference_video",
            },
        ],
        generate_audio=True,
        ratio="16:9",
        duration=5,
        watermark=True,
    )
    print(create_result)


    # Polling query section
    print("----- polling task status -----")
    task_id = create_result.id
    while True:
        get_result = client.content_generation.tasks.get(task_id=task_id)
        status = get_result.status
        if status == "succeeded":
            print("----- task succeeded -----")
            print(get_result)
            break
        elif status == "failed":
            print("----- task failed -----")
            print(f"Error: {get_result.error}")
            break
        else:
            print(f"Current status: {status}, Retrying after 30 seconds...")
            time.sleep(30)
```



</Tab>
<Tab zoneid="TLFq0dLPtu" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.sample;

import com.volcengine.ark.runtime.model.content.generation.*;
import com.volcengine.ark.runtime.model.content.generation.CreateContentGenerationTaskRequest.Content;
import com.volcengine.ark.runtime.service.ArkService;
import okhttp3.ConnectionPool;
import okhttp3.Dispatcher;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

public class ContentGenerationTaskExample {

    // Client initialization
    static String apiKey = System.getenv("ARK_API_KEY");
    static ConnectionPool connectionPool = new ConnectionPool(5, 1, TimeUnit.SECONDS);
    static Dispatcher dispatcher = new Dispatcher();
    static ArkService service = ArkService.builder()
           .baseUrl("https://ark.cn-beijing.volces.com/api/v3") // The base URL for model invocation
           .dispatcher(dispatcher)
           .connectionPool(connectionPool)
           .apiKey(apiKey)
           .build();
           
    public static void main(String[] args) {
        
        // Model ID
        final String modelId = "doubao-seedance-2-0-260128"; 
        // Text prompt
        final String prompt = "将视频1礼盒中的香水替换成图片1中的面霜，运镜不变";
        
        // Example resource URLs
        final String refImage1 = "https://ark-project.tos-cn-beijing.volces.com/doc_image/r2v_edit_pic1.jpg";
        final String refVideo = "https://ark-project.tos-cn-beijing.volces.com/doc_video/r2v_edit_video1.mp4";

        // Output video parameters
        final boolean generateAudio = true;
        final String videoRatio = "16:9";      
        final long videoDuration = 5L;          
        final boolean showWatermark = true;

        System.out.println("----- create request -----");
        // Build request content
        List<Content> contents = new ArrayList<>();
        
        // 1. Text prompt
        contents.add(Content.builder()
                .type("text")
                .text(prompt)
                .build());
                
        // 2. Reference image 1
        contents.add(Content.builder()
                .type("image_url")
                .imageUrl(CreateContentGenerationTaskRequest.ImageUrl.builder()
                        .url(refImage1)
                        .build())
                .role("reference_image")
                .build());

        // 3. Reference video
        contents.add(Content.builder()
                .type("video_url")
                .videoUrl(CreateContentGenerationTaskRequest.VideoUrl.builder()
                        .url(refVideo)  
                        .build())
                .role("reference_video")
                .build());

        // Create video generation task
        CreateContentGenerationTaskRequest createRequest = CreateContentGenerationTaskRequest.builder()
                .generateAudio(generateAudio)
                .model(modelId)
                .content(contents)
                .ratio(videoRatio)
                .duration(videoDuration)
                .watermark(showWatermark)
                .build();

        CreateContentGenerationTaskResult createResult = service.createContentGenerationTask(createRequest);
        System.out.println("Task Created: " + createResult);

        // Get task details and poll status
        String taskId = createResult.getId();
        pollTaskStatus(taskId);
    }

    /**
     * Poll task status
     * @param taskId Task ID
     */

    private static void pollTaskStatus(String taskId) {
        GetContentGenerationTaskRequest getRequest = GetContentGenerationTaskRequest.builder()
                .taskId(taskId)
                .build();

        System.out.println("----- polling task status -----");
        try {
            while (true) {
                GetContentGenerationTaskResponse getResponse = service.getContentGenerationTask(getRequest);
                String status = getResponse.getStatus();

                if ("succeeded".equalsIgnoreCase(status)) {
                    System.out.println("----- task succeeded -----");
                    System.out.println(getResponse);
                    break;
                } else if ("failed".equalsIgnoreCase(status)) {
                    System.out.println("----- task failed -----");
                    if (getResponse.getError() != null) {
                        System.out.println("Error: " + getResponse.getError().getMessage());
                    }
                    break;
                } else {
                    System.out.printf("Current status: %s, Retrying in 10 seconds...%n", status);
                    TimeUnit.SECONDS.sleep(10);
                }
            }
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            System.err.println("Polling interrupted");
        } catch (Exception e) {
            System.err.println("Error occurred: " + e.getMessage());
        } finally {
            service.shutdownExecutor();
        }
    }
}
```



</Tab>
<Tab zoneid="ad6ro5Vx4B" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "os"
    "time"

    "github.com/volcengine/volcengine-go-sdk/service/arkruntime"
    "github.com/volcengine/volcengine-go-sdk/service/arkruntime/model"
    "github.com/volcengine/volcengine-go-sdk/volcengine"
)

func main() {
    // Initialize Ark client
    client := arkruntime.NewClientWithApiKey(
        os.Getenv("ARK_API_KEY"),
        // The base URL for model invocation
        arkruntime.WithBaseUrl("https://ark.cn-beijing.volces.com/api/v3"),
    )
    ctx := context.Background()

    // Model ID
    modelID := "doubao-seedance-2-0-260128"
    // Text prompt
    prompt := "将视频1礼盒中的香水替换成图片1中的面霜，运镜不变"

    // Example resource URLs
    refImage1 := "https://ark-project.tos-cn-beijing.volces.com/doc_image/r2v_edit_pic1.jpg"
    refVideo1 := "https://ark-project.tos-cn-beijing.volces.com/doc_video/r2v_edit_video1.mp4"

    // Output video parameters
    generateAudio := true
    videoRatio := "16:9"
    videoDuration := int64(5)
    showWatermark := true

    // 1. Create video generation task
    fmt.Println("----- create request -----")
    createReq := model.CreateContentGenerationTaskRequest{
        Model:         modelID,
        GenerateAudio: volcengine.Bool(generateAudio),
        Ratio:         volcengine.String(videoRatio),
        Duration:      volcengine.Int64(videoDuration),
        Watermark:     volcengine.Bool(showWatermark),
        Content: []*model.CreateContentGenerationContentItem{
            {
                Type: model.ContentGenerationContentItemTypeText,
                Text: volcengine.String(prompt),
            },
            {
                Type: model.ContentGenerationContentItemType("image_url"),
                ImageURL: &model.ImageURL{
                    URL: refImage1,
                },
                Role: volcengine.String("reference_image"),
            },
            {
                Type: model.ContentGenerationContentItemType("video_url"),
                VideoURL: &model.VideoUrl{
                    Url: refVideo1,
                },
                Role: volcengine.String("reference_video"),
            },
        },
    }

    createResp, err := client.CreateContentGenerationTask(ctx, createReq)
    if err != nil {
        fmt.Printf("create content generation error: %v\n", err)
        return
    }

    taskID := createResp.ID
    fmt.Printf("Task Created with ID: %s\n", taskID)

    // 2. Poll task status
    pollTaskStatus(ctx, client, taskID)
}

// poll task status
func pollTaskStatus(ctx context.Context, client *arkruntime.Client, taskID string) {
    fmt.Println("----- polling task status -----")
    for {
        getReq := model.GetContentGenerationTaskRequest{ID: taskID}
        getResp, err := client.GetContentGenerationTask(ctx, getReq)
        if err != nil {
            fmt.Printf("get content generation task error: %v\n", err)
            return
        }

        status := getResp.Status
        if status == "succeeded" {
            fmt.Println("----- task succeeded -----")
            fmt.Printf("Task ID: %s \n", getResp.ID)
            fmt.Printf("Model: %s \n", getResp.Model)
            fmt.Printf("Video URL: %s \n", getResp.Content.VideoURL)
            fmt.Printf("Completion Tokens: %d \n", getResp.Usage.CompletionTokens)
            fmt.Printf("Created At: %d, Updated At: %d\n", getResp.CreatedAt, getResp.UpdatedAt)
            return
        } else if status == "failed" {
            fmt.Println("----- task failed -----")
            if getResp.Error != nil {
                fmt.Printf("Error Code: %s, Message: %s\n", getResp.Error.Code, getResp.Error.Message)
            }
            return
        } else {
            fmt.Printf("Current status: %s, Retrying in 10 seconds... \n", status)
            time.Sleep(10 * time.Second)
        }
    }
}
```



</Tab>
</Tabs>


<span id="46d77653"></span>
## 延长视频

在原有视频基础上，向前或者向后延长视频，或多个视频片段（最多 3 个视频片段）串联成一个连贯视频。

效果预览如下（访问[模型卡片](https://console.volcengine.com/ark/region:ark+cn-beijing/model/detail?Id=doubao-seedance-2-0)查看更多示例）：


<span aceTableMode="list" aceTableWidth="4,5,5"></span>
|输入：文本 |输入：待延长视频 |输出 |
|---|---|---|
|**视频1**中的拱形窗户打开，进入美术馆室内，接**视频2**，之后镜头进入画内，接**视频3** |<video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/54519ff7266d4f1caa12b8cc95e2dd1d" controls></video><br><br><br><video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/b15d56c80c884faa8526beb6ca540b98" controls></video><br><br><br><video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/f5d327311e094361b15dca0a37b14ab4" controls></video><br> |<video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/849b3f86f609495ca09d559aa14c79ed" controls></video><br> |



<Tabs>
<Tab zoneid="plvU0Zi73L" title="Python">
<TabTitle>Python</TabTitle>

```Python
import os
import time
# Install SDK:  pip install 'volcengine-python-sdk[ark]'
from volcenginesdkarkruntime import Ark 

client = Ark(
    # The base URL for model invocation
    base_url='https://ark.cn-beijing.volces.com/api/v3',
    # Get API Key：https://console.volcengine.com/ark/region:ark+cn-beijing/apikey
    api_key=os.environ.get("ARK_API_KEY"),
)

if __name__ == "__main__":
    print("----- create request -----")
    create_result = client.content_generation.tasks.create(
        model="doubao-seedance-2-0-260128", # Replace with Model ID 
        content=[
            {
                "type": "text",
                "text": "视频1中的拱形窗户打开，进入美术馆室内，接视频2，之后镜头进入画内，接视频3",
                
            },
            {
                "type": "video_url",
                "video_url": {
                    "url": "https://ark-project.tos-cn-beijing.volces.com/doc_video/r2v_extend_video1.mp4"
                },
                "role": "reference_video",
            },
            {
                "type": "video_url",
                "video_url": {
                    "url": "https://ark-project.tos-cn-beijing.volces.com/doc_video/r2v_extend_video2.mp4"
                },
                "role": "reference_video",
            },
            {
                "type": "video_url",
                "video_url": {
                    "url": "https://ark-project.tos-cn-beijing.volces.com/doc_video/r2v_extend_video3.mp4"
                },
                "role": "reference_video",
            },
        ],
        generate_audio=True,
        ratio="16:9",
        duration=8,
        watermark=True,
    )
    print(create_result)


    # Polling query section
    print("----- polling task status -----")
    task_id = create_result.id
    while True:
        get_result = client.content_generation.tasks.get(task_id=task_id)
        status = get_result.status
        if status == "succeeded":
            print("----- task succeeded -----")
            print(get_result)
            break
        elif status == "failed":
            print("----- task failed -----")
            print(f"Error: {get_result.error}")
            break
        else:
            print(f"Current status: {status}, Retrying after 30 seconds...")
            time.sleep(30)
```



</Tab>
<Tab zoneid="p7pZkfKtFa" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.sample;

import com.volcengine.ark.runtime.model.content.generation.*;
import com.volcengine.ark.runtime.model.content.generation.CreateContentGenerationTaskRequest.Content;
import com.volcengine.ark.runtime.service.ArkService;
import okhttp3.ConnectionPool;
import okhttp3.Dispatcher;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

public class ContentGenerationTaskExample {

    // Client initialization
    static String apiKey = System.getenv("ARK_API_KEY");
    static ConnectionPool connectionPool = new ConnectionPool(5, 1, TimeUnit.SECONDS);
    static Dispatcher dispatcher = new Dispatcher();
    static ArkService service = ArkService.builder()
           .baseUrl("https://ark.cn-beijing.volces.com/api/v3") // The base URL for model invocation
           .dispatcher(dispatcher)
           .connectionPool(connectionPool)
           .apiKey(apiKey)
           .build();
           
    public static void main(String[] args) {
        
        // Model ID
        final String modelId = "doubao-seedance-2-0-260128";
        // Text prompt
        final String prompt = "视频1中的拱形窗户打开，进入美术馆室内，接视频2，之后镜头进入画内，接视频3";
        
        // Example resource URLs
        final String refVideo1 = "https://ark-project.tos-cn-beijing.volces.com/doc_video/r2v_extend_video1.mp4";
        final String refVideo2 = "https://ark-project.tos-cn-beijing.volces.com/doc_video/r2v_extend_video2.mp4";
        final String refVideo3 = "https://ark-project.tos-cn-beijing.volces.com/doc_video/r2v_extend_video3.mp4";

        // Output video parameters
        final boolean generateAudio = true;
        final String videoRatio = "16:9";      
        final long videoDuration = 8L;          
        final boolean showWatermark = true;

        System.out.println("----- create request -----");
        // Build request content
        List<Content> contents = new ArrayList<>();
        
        // 1. Text prompt
        contents.add(Content.builder()
                .type("text")
                .text(prompt)
                .build());
                
        // 2. Reference video 1
        contents.add(Content.builder()
                .type("video_url")
                .videoUrl(CreateContentGenerationTaskRequest.VideoUrl.builder()
                        .url(refVideo1)  
                        .build())
                .role("reference_video")
                .build());

        // 3. Reference video 2
        contents.add(Content.builder()
                .type("video_url")
                .videoUrl(CreateContentGenerationTaskRequest.VideoUrl.builder()
                        .url(refVideo2)  
                        .build())
                .role("reference_video")
                .build());

        // 4. Reference video 3
        contents.add(Content.builder()
                .type("video_url")
                .videoUrl(CreateContentGenerationTaskRequest.VideoUrl.builder()
                        .url(refVideo3)  
                        .build())
                .role("reference_video")
                .build());

        // Create video generation task
        CreateContentGenerationTaskRequest createRequest = CreateContentGenerationTaskRequest.builder()
                .generateAudio(generateAudio)
                .model(modelId)
                .content(contents)
                .ratio(videoRatio)
                .duration(videoDuration)
                .watermark(showWatermark)
                .build();

        CreateContentGenerationTaskResult createResult = service.createContentGenerationTask(createRequest);
        System.out.println("Task Created: " + createResult);

        // Get task details and poll status
        String taskId = createResult.getId();
        pollTaskStatus(taskId);
    }

    /**
     * Poll task status
     * @param taskId Task ID
     */

    private static void pollTaskStatus(String taskId) {
        GetContentGenerationTaskRequest getRequest = GetContentGenerationTaskRequest.builder()
                .taskId(taskId)
                .build();

        System.out.println("----- polling task status -----");
        try {
            while (true) {
                GetContentGenerationTaskResponse getResponse = service.getContentGenerationTask(getRequest);
                String status = getResponse.getStatus();

                if ("succeeded".equalsIgnoreCase(status)) {
                    System.out.println("----- task succeeded -----");
                    System.out.println(getResponse);
                    break;
                } else if ("failed".equalsIgnoreCase(status)) {
                    System.out.println("----- task failed -----");
                    if (getResponse.getError() != null) {
                        System.out.println("Error: " + getResponse.getError().getMessage());
                    }
                    break;
                } else {
                    System.out.printf("Current status: %s, Retrying in 10 seconds...%n", status);
                    TimeUnit.SECONDS.sleep(10);
                }
            }
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            System.err.println("Polling interrupted");
        } catch (Exception e) {
            System.err.println("Error occurred: " + e.getMessage());
        } finally {
            service.shutdownExecutor();
        }
    }
}
```



</Tab>
<Tab zoneid="E7vbghOhTA" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "os"
    "time"

    "github.com/volcengine/volcengine-go-sdk/service/arkruntime"
    "github.com/volcengine/volcengine-go-sdk/service/arkruntime/model"
    "github.com/volcengine/volcengine-go-sdk/volcengine"
)

func main() {
    // Initialize Ark client
    client := arkruntime.NewClientWithApiKey(
        os.Getenv("ARK_API_KEY"),
        // The base URL for model invocation
        arkruntime.WithBaseUrl("https://ark.cn-beijing.volces.com/api/v3"),
    )
    ctx := context.Background()

    // Model ID
    modelID := "doubao-seedance-2-0-260128"
    // Text prompt
    prompt := "视频1中的拱形窗户打开，进入美术馆室内，接视频2，之后镜头进入画内，接视频3"

    // Example resource URLs
    refVideo1 := "https://ark-project.tos-cn-beijing.volces.com/doc_video/r2v_extend_video1.mp4"
    refVideo2 := "https://ark-project.tos-cn-beijing.volces.com/doc_video/r2v_extend_video2.mp4"
    refVideo3 := "https://ark-project.tos-cn-beijing.volces.com/doc_video/r2v_extend_video3.mp4"

    // Output video parameters
    generateAudio := true
    videoRatio := "16:9"
    videoDuration := int64(8)
    showWatermark := true

    // 1. Create video generation task
    fmt.Println("----- create request -----")
    createReq := model.CreateContentGenerationTaskRequest{
        Model:         modelID,
        GenerateAudio: volcengine.Bool(generateAudio),
        Ratio:         volcengine.String(videoRatio),
        Duration:      volcengine.Int64(videoDuration),
        Watermark:     volcengine.Bool(showWatermark),
        Content: []*model.CreateContentGenerationContentItem{
            {
                Type: model.ContentGenerationContentItemTypeText,
                Text: volcengine.String(prompt),
            },
            {
                Type: model.ContentGenerationContentItemType("video_url"),
                VideoURL: &model.VideoUrl{
                    Url: refVideo1,
                },
                Role: volcengine.String("reference_video"),
            },
            {
                Type: model.ContentGenerationContentItemType("video_url"),
                VideoURL: &model.VideoUrl{
                    Url: refVideo2,
                },
                Role: volcengine.String("reference_video"),
            },
            {
                Type: model.ContentGenerationContentItemType("video_url"),
                VideoURL: &model.VideoUrl{
                    Url: refVideo3,
                },
                Role: volcengine.String("reference_video"),
            },
        },
    }

    createResp, err := client.CreateContentGenerationTask(ctx, createReq)
    if err != nil {
        fmt.Printf("create content generation error: %v\n", err)
        return
    }

    taskID := createResp.ID
    fmt.Printf("Task Created with ID: %s\n", taskID)

    // 2. Poll task status
    pollTaskStatus(ctx, client, taskID)
}

// poll task status
func pollTaskStatus(ctx context.Context, client *arkruntime.Client, taskID string) {
    fmt.Println("----- polling task status -----")
    for {
        getReq := model.GetContentGenerationTaskRequest{ID: taskID}
        getResp, err := client.GetContentGenerationTask(ctx, getReq)
        if err != nil {
            fmt.Printf("get content generation task error: %v\n", err)
            return
        }

        status := getResp.Status
        if status == "succeeded" {
            fmt.Println("----- task succeeded -----")
            fmt.Printf("Task ID: %s \n", getResp.ID)
            fmt.Printf("Model: %s \n", getResp.Model)
            fmt.Printf("Video URL: %s \n", getResp.Content.VideoURL)
            fmt.Printf("Completion Tokens: %d \n", getResp.Usage.CompletionTokens)
            fmt.Printf("Created At: %d, Updated At: %d\n", getResp.CreatedAt, getResp.UpdatedAt)
            return
        } else if status == "failed" {
            fmt.Println("----- task failed -----")
            if getResp.Error != nil {
                fmt.Printf("Error Code: %s, Message: %s\n", getResp.Error.Code, getResp.Error.Message)
            }
            return
        } else {
            fmt.Printf("Current status: %s, Retrying in 10 seconds... \n", status)
            time.Sleep(10 * time.Second)
        }
    }
}
```



</Tab>
</Tabs>


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">说明</div>



* <div data-tips="true" data-tips-type="tip">向前或向后延长 1 段视频，生成的视频一般只包含原视频的尾部画面。但您也可以通过提示词灵活控制，使其包含原视频内容。 例如：向前延长视频1，[延长内容描述...]，<strong>最后接视频1</strong>。</div>


* <div data-tips="true" data-tips-type="tip">传入 2~3 段视频，补全中间过渡部分，生成的视频会包含原视频内容和新生成的视频内容。</div>



<span id=".6L6T5Ye6LTRrLeinhumikQ=="></span>
## 输出 4k 视频

> 仅 Seedance 2.0 支持


Seedance 2.0 支持输出 4k 视频，并采用 10bit 位深编码，能够完整保留丰富的色彩层次与平滑的渐变过渡，满足专业影视制作与 HDR 视频内容的要求。

<div data-tips="true" data-tips-type="warning" data-tips-is-title="true">注意</div>


<div data-tips="true" data-tips-type="warning">4k 视频采用 H.265 (HEVC) 编码格式输出，部分播放器/浏览器可能无法直接播放。</div>



<span aceTableMode="list" aceTableWidth="1,1"></span>
|效果预览1 |效果预览2 |
|---|---|
|<video src="https://ark-project.tos-cn-beijing.volces.com/doc_audio/4K%E5%BD%A9%E5%A6%86-%E9%9F%B3%E4%B9%90.mov" controls></video><br> |<video src="https://ark-project.tos-cn-beijing.volces.com/doc_audio/4K%E6%91%A9%E6%89%98-%E9%9F%B3%E4%B9%90.mov" controls></video><br> |


> 注：效果展示视频由 Seedance 2.0 生成的多个分镜拼接而成，非下述示例代码直接生成。



<Tabs>
<Tab zoneid="gik6FBWRAD" title="Python">
<TabTitle>Python</TabTitle>

```Python
import os
import time
# Install SDK:  pip install 'volcengine-python-sdk[ark]'
from volcenginesdkarkruntime import Ark 

client = Ark(
    # The base URL for model invocation
    base_url='https://ark.cn-beijing.volces.com/api/v3',
    # Get API Key：https://console.volcengine.com/ark/region:ark+cn-beijing/apikey
    api_key=os.environ.get("ARK_API_KEY"),
)

if __name__ == "__main__":
    print("----- create request -----")
    create_result = client.content_generation.tasks.create(
        model="doubao-seedance-2-0-260128",
        content=[
            {
                "type": "text",
                "text": "生成一段15秒的越野摩托竞技广告感短片。参考图片作为中段飞跃高潮的参考。镜头逻辑依次为：1）中景跟拍，车手从远处沿土坡高速逼近跳台；2）超近低机位后轮飞砂特写，轮胎抓地甩出大量泥土和砂石；3）中近景展示骑手控车、手部发力、悬挂压缩与机械震动；4）侧向英雄中景拍车手冲坡腾空飞跃，画面状态接近图一，泥土在逆光中大面积飞散；5）腾空近景帅气细节，突出头盔护目镜、手部控把、轮胎悬空或车身侧面局部；6）中景跟拍落地，悬挂压缩回弹，随后继续沿土坡赛道高速冲刺收尾。全片同一名骑手、同一辆车、同一条赛道，镜头景别和角度区分清楚，不重复，动作连贯,画面有真实越野跟拍抖动感、速度感、扬土感和夕阳逆光竞技氛围。",
            },
            {
                "type": "image_url",
                "image_url": {
                    "url": "https://ark-project.tos-cn-beijing.volces.com/doc_image/i2v_4k.png"
                },
                "role": "reference_image",
            },
        ],
        generate_audio=True,
        resolution="4k",
        ratio="adaptive",
        duration=15,
        watermark=True,
    )
    print(create_result)


    # Polling query section
    print("----- polling task status -----")
    task_id = create_result.id
    while True:
        get_result = client.content_generation.tasks.get(task_id=task_id)
        status = get_result.status
        if status == "succeeded":
            print("----- task succeeded -----")
            print(get_result)
            break
        elif status == "failed":
            print("----- task failed -----")
            print(f"Error: {get_result.error}")
            break
        else:
            print(f"Current status: {status}, Retrying after 30 seconds...")
            time.sleep(30)
```



</Tab>
<Tab zoneid="bmPBHCkRcM" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.sample;

import com.volcengine.ark.runtime.model.content.generation.*;
import com.volcengine.ark.runtime.model.content.generation.CreateContentGenerationTaskRequest.Content;
import com.volcengine.ark.runtime.service.ArkService;
import okhttp3.ConnectionPool;
import okhttp3.Dispatcher;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

public class ContentGenerationTaskExample {

    // Client initialization
    static String apiKey = System.getenv("ARK_API_KEY");
    static ConnectionPool connectionPool = new ConnectionPool(5, 1, TimeUnit.SECONDS);
    static Dispatcher dispatcher = new Dispatcher();
    static ArkService service = ArkService.builder()
           .baseUrl("https://ark.cn-beijing.volces.com/api/v3") // The base URL for model invocation
           .dispatcher(dispatcher)
           .connectionPool(connectionPool)
           .apiKey(apiKey)
           .build();
           
    public static void main(String[] args) {
        
        // Model ID
        final String modelId = "doubao-seedance-2-0-260128";
        // Text prompt
        final String prompt = "生成一段15秒的越野摩托竞技广告感短片。参考图片作为中段飞跃高潮的参考。" +
                "镜头逻辑依次为：1）中景跟拍，车手从远处沿土坡高速逼近跳台；" +
                "2）超近低机位后轮飞砂特写，轮胎抓地甩出大量泥土和砂石；" +
                "3）中近景展示骑手控车、手部发力、悬挂压缩与机械震动；" +
                "4）侧向英雄中景拍车手冲坡腾空飞跃，画面状态接近图一，泥土在逆光中大面积飞散；" +
                "5）腾空近景帅气细节，突出头盔护目镜、手部控把、轮胎悬空或车身侧面局部；" +
                "6）中景跟拍落地，悬挂压缩回弹，随后继续沿土坡赛道高速冲刺收尾。" +
                "全片同一名骑手、同一辆车、同一条赛道，镜头景别和角度区分清楚，不重复，动作连贯,画面有真实越野跟拍抖动感、速度感、扬土感和夕阳逆光竞技氛围。";
        
        // Example resource URLs
        final String refImage = "https://ark-project.tos-cn-beijing.volces.com/doc_image/i2v_4k.png";

        // Output video parameters
        final boolean generateAudio = true;
        final String videoResolution = "4k";
        final String videoRatio = "adaptive";
        final long videoDuration = 15L;
        final boolean showWatermark = true;

        System.out.println("----- create request -----");
        // Build request content
        List<Content> contents = new ArrayList<>();
        
        // 1. Text prompt
        contents.add(Content.builder()
                .type("text")
                .text(prompt)
                .build());
                
        // 2. Reference image
        contents.add(Content.builder()
                .type("image_url")
                .imageUrl(CreateContentGenerationTaskRequest.ImageUrl.builder()
                        .url(refImage)
                        .build())
                .role("reference_image")
                .build());

        // Create video generation task
        CreateContentGenerationTaskRequest createRequest = CreateContentGenerationTaskRequest.builder()
                .generateAudio(generateAudio)
                .model(modelId)
                .content(contents)
                .resolution(videoResolution)
                .ratio(videoRatio)
                .duration(videoDuration)
                .watermark(showWatermark)
                .build();

        CreateContentGenerationTaskResult createResult = service.createContentGenerationTask(createRequest);
        System.out.println("Task Created: " + createResult);

        // Get task details and poll status
        String taskId = createResult.getId();
        pollTaskStatus(taskId);
    }

    /**
     * Poll task status
     * @param taskId Task ID
     */

    private static void pollTaskStatus(String taskId) {
        GetContentGenerationTaskRequest getRequest = GetContentGenerationTaskRequest.builder()
                .taskId(taskId)
                .build();

        System.out.println("----- polling task status -----");
        try {
            while (true) {
                GetContentGenerationTaskResponse getResponse = service.getContentGenerationTask(getRequest);
                String status = getResponse.getStatus();

                if ("succeeded".equalsIgnoreCase(status)) {
                    System.out.println("----- task succeeded -----");
                    System.out.println(getResponse);
                    break;
                } else if ("failed".equalsIgnoreCase(status)) {
                    System.out.println("----- task failed -----");
                    if (getResponse.getError() != null) {
                        System.out.println("Error: " + getResponse.getError().getMessage());
                    }
                    break;
                } else {
                    System.out.printf("Current status: %s, Retrying in 10 seconds...%n", status);
                    TimeUnit.SECONDS.sleep(10);
                }
            }
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            System.err.println("Polling interrupted");
        } catch (Exception e) {
            System.err.println("Error occurred: " + e.getMessage());
        } finally {
            service.shutdownExecutor();
        }
    }
}
```



</Tab>
<Tab zoneid="OxUkwSf2xw" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "os"
    "time"

    "github.com/volcengine/volcengine-go-sdk/service/arkruntime"
    "github.com/volcengine/volcengine-go-sdk/service/arkruntime/model"
    "github.com/volcengine/volcengine-go-sdk/volcengine"
)

func main() {
    // Initialize Ark client
    client := arkruntime.NewClientWithApiKey(
        os.Getenv("ARK_API_KEY"),
        // The base URL for model invocation
        arkruntime.WithBaseUrl("https://ark.cn-beijing.volces.com/api/v3"),
    )
    ctx := context.Background()

    // Model ID
    modelID := "doubao-seedance-2-0-260128"
    // Text prompt
    prompt := "生成一段15秒的越野摩托竞技广告感短片。参考图片作为中段飞跃高潮的参考。" +
        "镜头逻辑依次为：1）中景跟拍，车手从远处沿土坡高速逼近跳台；" +
        "2）超近低机位后轮飞砂特写，轮胎抓地甩出大量泥土和砂石；" +
        "3）中近景展示骑手控车、手部发力、悬挂压缩与机械震动；" +
        "4）侧向英雄中景拍车手冲坡腾空飞跃，画面状态接近图一，泥土在逆光中大面积飞散；" +
        "5）腾空近景帅气细节，突出头盔护目镜、手部控把、轮胎悬空或车身侧面局部；" +
        "6）中景跟拍落地，悬挂压缩回弹，随后继续沿土坡赛道高速冲刺收尾。" +
        "全片同一名骑手、同一辆车、同一条赛道，镜头景别和角度区分清楚，不重复，动作连贯,画面有真实越野跟拍抖动感、速度感、扬土感和夕阳逆光竞技氛围。"

    // Example resource URLs
    refImage := "https://ark-project.tos-cn-beijing.volces.com/doc_image/i2v_4k.png"

    // Output video parameters
    generateAudio := true
    videoResolution := "4k"
    videoRatio := "adaptive"
    videoDuration := int64(15)
    showWatermark := true

    // 1. Create video generation task
    fmt.Println("----- create request -----")
    createReq := model.CreateContentGenerationTaskRequest{
        Model:         modelID,
        GenerateAudio: volcengine.Bool(generateAudio),
        Resolution:    volcengine.String(videoResolution),
        Ratio:         volcengine.String(videoRatio),
        Duration:      volcengine.Int64(videoDuration),
        Watermark:     volcengine.Bool(showWatermark),
        Content: []*model.CreateContentGenerationContentItem{
            {
                Type: model.ContentGenerationContentItemTypeText,
                Text: volcengine.String(prompt),
            },
            {
                Type: model.ContentGenerationContentItemType("image_url"),
                ImageURL: &model.ImageURL{
                    URL: refImage,
                },
                Role: volcengine.String("reference_image"),
            },
        },
    }

    createResp, err := client.CreateContentGenerationTask(ctx, createReq)
    if err != nil {
        fmt.Printf("create content generation error: %v\n", err)
        return
    }

    taskID := createResp.ID
    fmt.Printf("Task Created with ID: %s\n", taskID)

    // 2. Poll task status
    pollTaskStatus(ctx, client, taskID)
}

// poll task status
func pollTaskStatus(ctx context.Context, client *arkruntime.Client, taskID string) {
    fmt.Println("----- polling task status -----")
    for {
        getReq := model.GetContentGenerationTaskRequest{ID: taskID}
        getResp, err := client.GetContentGenerationTask(ctx, getReq)
        if err != nil {
            fmt.Printf("get content generation task error: %v\n", err)
            return
        }

        status := getResp.Status
        if status == "succeeded" {
            fmt.Println("----- task succeeded -----")
            fmt.Printf("Task ID: %s \n", getResp.ID)
            fmt.Printf("Model: %s \n", getResp.Model)
            fmt.Printf("Video URL: %s \n", getResp.Content.VideoURL)
            fmt.Printf("Completion Tokens: %d \n", getResp.Usage.CompletionTokens)
            fmt.Printf("Created At: %d, Updated At: %d\n", getResp.CreatedAt, getResp.UpdatedAt)
            return
        } else if status == "failed" {
            fmt.Println("----- task failed -----")
            if getResp.Error != nil {
                fmt.Printf("Error Code: %s, Message: %s\n", getResp.Error.Code, getResp.Error.Message)
            }
            return
        } else {
            fmt.Printf("Current status: %s, Retrying in 10 seconds... \n", status)
            time.Sleep(10 * time.Second)
        }
    }
}
```



</Tab>
</Tabs>


<span id="c40ed3ef"></span>
## 使用联网搜索

> 联网搜索能力仅适用于纯文本输入


通过配置 tools.**type** 参数为`web_search`即可使用联网搜索工具。


* 开启联网搜索后，模型会根据用户的提示词自主判断是否搜索互联网内容（如商品、天气等）。可提升生成视频的时效性，但也会增加一定的时延。

* 实际搜索次数可通过 [查询视频生成任务 API](https://www.volcengine.com/docs/82379/1521309?lang=zh) 返回的 usage.tool_usage.**web_search** 字段获取，如果为 0 表示未搜索。



<span aceTableMode="list" aceTableWidth="5,5"></span>
|输入：文本 |输出 |
|---|---|
|微距镜头对准叶片上翠绿的玻璃蛙。焦点逐渐从它光滑的皮肤，转移到它完全透明的腹部，一颗鲜红的心脏正在有力地、规律地收缩扩张。<br><br><div data-tips="true" data-tips-type="tip" data-tips-is-title="true">说明</div><br><br><br><div data-tips="true" data-tips-type="tip">联网搜索玻璃蛙的容貌特征。</div><br> |<video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/afad79fc76a34d1fbe7b2c809d1e19f1" controls></video><br> |



<Tabs>
<Tab zoneid="QO5Uq6fzCQ" title="Python">
<TabTitle>Python</TabTitle>

```Python
import os
import time  
# Install SDK:  pip install 'volcengine-python-sdk[ark]'
from volcenginesdkarkruntime import Ark 
# Make sure that you have stored the API Key in the environment variable ARK_API_KEY
# Initialize the Ark client to read your API Key from an environment variable
client = Ark(
    # This is the default path. You can configure it based on the service location
    base_url="https://ark.cn-beijing.volces.com/api/v3",
    # Get API Key：https://console.volcengine.com/ark/region:ark+cn-beijing/apikey
    api_key=os.environ.get("ARK_API_KEY"),
)
if __name__ == "__main__":
    print("----- create request -----")
    create_result = client.content_generation.tasks.create(
        model="doubao-seedance-2-0-260128", # Replace with Model ID 
        content=[
            {
                # text prompt
                "type": "text",
                "text": "微距镜头对准叶片上翠绿的玻璃蛙。焦点逐渐从它光滑的皮肤，转移到它完全透明的腹部，一颗鲜红的心脏正在有力地、规律地收缩扩张。"
            }
        ],
        ratio="16:9",
        duration=11,
        watermark=False,
        tools=[{"type": "web_search"}],
    )
    print(create_result)
    
    # Polling query section
    print("----- polling task status -----")
    task_id = create_result.id
    while True:
        get_result = client.content_generation.tasks.get(task_id=task_id)
        status = get_result.status
        if status == "succeeded":
            print("----- task succeeded -----")
            print(get_result)
            break
        elif status == "failed":
            print("----- task failed -----")
            print(f"Error: {get_result.error}")
            break
        else:
            print(f"Current status: {status}, Retrying after 10 seconds...")
            time.sleep(10)
```



</Tab>
<Tab zoneid="MPoUxTMuVK" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.sample;

import com.volcengine.ark.runtime.model.content.generation.*;
import com.volcengine.ark.runtime.model.content.generation.CreateContentGenerationTaskRequest.Content;
import com.volcengine.ark.runtime.service.ArkService;
import okhttp3.ConnectionPool;
import okhttp3.Dispatcher;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.Collections;

public class ContentGenerationTaskExample {
    // Make sure that you have stored the API Key in the environment variable ARK_API_KEY
    // Initialize the Ark client to read your API Key from an environment variable
    static String apiKey = System.getenv("ARK_API_KEY");
    static ConnectionPool connectionPool = new ConnectionPool(5, 1, TimeUnit.SECONDS);
    static Dispatcher dispatcher = new Dispatcher();
    static ArkService service = ArkService.builder()
           .baseUrl("https://ark.cn-beijing.volces.com/api/v3") // The base URL for model invocation
           .dispatcher(dispatcher)
           .connectionPool(connectionPool)
           .apiKey(apiKey)
           .build();
           
    public static void main(String[] args) {
        String model = "doubao-seedance-2-0-260128"; // Replace with Model ID
        String prompt = "微距镜头对准叶片上翠绿的玻璃蛙。焦点逐渐从它光滑的皮肤，转移到它完全透明的腹部，一颗鲜红的心脏正在有力地、规律地收缩扩张。";
        
        Boolean generateAudio = true;
        String videoRatio = "16:9";
        Long videoDuration = 11L;
        Boolean showWatermark = true;
        
        // Create ContentGenerationTool
        CreateContentGenerationTaskRequest.ContentGenerationTool webSearchTool = new CreateContentGenerationTaskRequest.ContentGenerationTool();
        webSearchTool.setType("web_search");
        
        System.out.println("----- create request -----");
        List<Content> contents = new ArrayList<>();
        
        // text prompt
        contents.add(Content.builder()
                .type("text")
                .text(prompt)
                .build());
         
        // Create a video generation task
        CreateContentGenerationTaskRequest createRequest = CreateContentGenerationTaskRequest.builder()
                .model(modelId)
                .content(contents)
                .generateAudio(generateAudio)
                .ratio(videoRatio)
                .duration(videoDuration)
                .watermark(showWatermark)
                .tools(Collections.singletonList(webSearchTool))
                .build();
        CreateContentGenerationTaskResult createResult = service.createContentGenerationTask(createRequest);
        System.out.println(createResult);
        // Get the details of the task
        String taskId = createResult.getId();
        GetContentGenerationTaskRequest getRequest = GetContentGenerationTaskRequest.builder()
                .taskId(taskId)
                .build();
        
        // Polling query section
        System.out.println("----- polling task status -----");
        while (true) {
            try {
                GetContentGenerationTaskResponse getResponse = service.getContentGenerationTask(getRequest);
                String status = getResponse.getStatus();
                if ("succeeded".equalsIgnoreCase(status)) {
                    System.out.println("----- task succeeded -----");
                    System.out.println(getResponse);
                    break;
                } else if ("failed".equalsIgnoreCase(status)) {
                    System.out.println("----- task failed -----");
                    System.out.println("Error: " + getResponse.getStatus());
                    break;
                } else {
                    System.out.printf("Current status: %s, Retrying in 10 seconds...", status);
                    TimeUnit.SECONDS.sleep(10);
                }
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
                System.err.println("Polling interrupted");
                break;
            }
        }
    }
}
```



</Tab>
<Tab zoneid="lzaESkXzVH" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "os"
    "time"

    "github.com/volcengine/volcengine-go-sdk/service/arkruntime"
    "github.com/volcengine/volcengine-go-sdk/service/arkruntime/model"
    "github.com/volcengine/volcengine-go-sdk/volcengine"
)

func main() {
    // Make sure that you have stored the API Key in the environment variable ARK_API_KEY
    // Initialize the Ark client to read your API Key from an environment variable
    client := arkruntime.NewClientWithApiKey(
        // Get your API Key from the environment variable. This is the default mode and you can modify it as required
        os.Getenv("ARK_API_KEY"),
        // The base URL for model invocation
        arkruntime.WithBaseUrl("https://ark.cn-beijing.volces.com/api/v3"),
    )
    ctx := context.Background()
    
    // Model ID
    modelID := "doubao-seedance-2-0-260128"
    // Text prompt
    prompt := "微距镜头对准叶片上翠绿的玻璃蛙。焦点逐渐从它光滑的皮肤，转移到它完全透明的腹部，一颗鲜红的心脏正在有力地、规律地收缩扩张。"

    // Output video parameters
    generateAudio := true
    videoRatio := "adaptive"
    videoDuration := int64(11)
    showWatermark := true

    // Create ContentGenerationTool
    tools := []*model.ContentGenerationTool{
        {Type: model.ToolTypeWebSearch},
    }

    // Generate a task
    fmt.Println("----- create request -----")
    createReq := model.CreateContentGenerationTaskRequest{
        Model:     modelID,
        GenerateAudio: volcengine.Bool(generateAudio),
        Ratio:     volcengine.String(videoRatio),
        Duration:  volcengine.Int64(videoDuration),
        Watermark: volcengine.Bool(showWatermark),
        Tools:     tools,
        Content: []*model.CreateContentGenerationContentItem{
            {
                // Combination of text prompt and parameters
                Type: model.ContentGenerationContentItemTypeText,
                Text: volcengine.String(prompt),
            },
        },
    }
    createResp, err := client.CreateContentGenerationTask(ctx, createReq)
    if err != nil {
        fmt.Printf("create content generation error: %v\n", err)
        return
    }

    taskID := createResp.ID
    fmt.Printf("Task Created with ID: %s\n", taskID)

    // 2. Poll task status
    pollTaskStatus(ctx, client, taskID)
}

    // poll task status
func pollTaskStatus(ctx context.Context, client *arkruntime.Client, taskID string) {
    fmt.Println("----- polling task status -----")
    for {
        getReq := model.GetContentGenerationTaskRequest{ID: taskID}
        getResp, err := client.GetContentGenerationTask(ctx, getReq)
        if err != nil {
            fmt.Printf("get content generation task error: %v\n", err)
            return
        }

        status := getResp.Status
        if status == "succeeded" {
            fmt.Println("----- task succeeded -----")
            fmt.Printf("Task ID: %s \n", getResp.ID)
            fmt.Printf("Model: %s \n", getResp.Model)
            fmt.Printf("Video URL: %s \n", getResp.Content.VideoURL)
            fmt.Printf("Completion Tokens: %d \n", getResp.Usage.CompletionTokens)
            fmt.Printf("Created At: %d, Updated At: %d\n", getResp.CreatedAt, getResp.UpdatedAt)
            return
        } else if status == "failed" {
            fmt.Println("----- task failed -----")
            if getResp.Error != nil {
                fmt.Printf("Error Code: %s, Message: %s\n", getResp.Error.Code, getResp.Error.Message)
            }
            return
        } else {
            fmt.Printf("Current status: %s, Retrying in 10 seconds... \n", status)
            time.Sleep(10 * time.Second)
        }
    }
}
```



</Tab>
</Tabs>


<span id="17c64b2e"></span>
## 更多能力

Seedance 2.0 系列模型也支持文生视频、首帧图生视频、首尾帧图生视频、自定义视频输出规格（包括：分辨率、宽高比、视频时长、视频中是否包含水印）等通用基础能力，详情请参见 [视频生成教程](https://www.volcengine.com/docs/82379/2298881)。

<span id="5c67c9a1"></span>
# 便利创作

Seedance 2.0 系列模型不支持直接上传含有真人人脸的参考图/视频。为便利创作者使用肖像，平台推出了以下解决方案。


<span aceTableMode="list" aceTableWidth="2,4"></span>
|方案 |介绍 |
|---|---|
|[信任模型产物作为输入素材](https://www.volcengine.com/docs/82379/2291680#341d7f71) |本账号下部分模型生成的含人脸原始产物可作为输入素材，再次调用 Seedance 2.0 系列模型进行二次创作，不会触发输入审核拦截。 |
|[使用预置虚拟人像](https://www.volcengine.com/docs/82379/2291680#2bf01416) |平台预置虚拟人像库，为创作者提供免费、合规、丰富多样的肖像素材。适用于需真人风格人脸但无需指定具体人物，追求零合规风险、快速创作的场景。 |
|[使用已授权真人素材](https://www.volcengine.com/docs/82379/2291680#f952d0c3) |支持使用已获得授权的真人肖像素材进行视频生成。 |


<span id="341d7f71"></span>
## 信任模型产物作为输入素材

Seedance 2.0 系列模型不支持直接上传含有真人人脸的参考图/视频。为了便利创作者在含人脸场景的二次创作需求，方舟平台信任以下模型生成的含人脸产物，您可使用**本账号下近30天内由以下模型生成的含人脸原始产物**，作为输入素材，再次调用 Seedance 2.0 系列模型进行二次创作。


|信任产物范围 |生效时间<br><br>> 信任该时间之后生成的产物 |有效期<br><br>> 从产物生成时间开始计算 |
|---|---|---|
|Seedance 2.0 系列 生成的含人脸视频 |2026年03月11日起 |30天 |
|Seedance 2.0 系列 生成的含人脸视频对应的尾帧图片 |2026年04月16日起 |30天 |
|[Seedream 5.0 lite 文生图](https://www.volcengine.com/docs/82379/1824121?lang=zh#9695d195)得到的含人脸图片 |2026年04月16日起 |30天 |


<div data-tips="true" data-tips-type="warning" data-tips-is-title="true">注意</div>



* <div data-tips="true" data-tips-type="warning">仅信任方舟平台的产物，不支持跨平台使用。</div>


* <div data-tips="true" data-tips-type="warning">仅信任同账号下的产物，不支持跨账号使用。</div>


* <div data-tips="true" data-tips-type="warning">仅信任模型原始产物，二次剪辑或超过有效期后均不可使用。</div>


* <div data-tips="true" data-tips-type="warning">压缩或转发文件易引发信任失效，建议直接将模型原始产物转存至 TOS 使用。</div>


* <div data-tips="true" data-tips-type="warning">仅对输入的产物进行信任，输出依然有可能因命中方舟安全审核策略而失败，详情参见 <a href="https://www.volcengine.com/docs/82379/1299023?lang=zh">错误码</a>。</div>


* <div data-tips="true" data-tips-type="warning">信任仅对命中人脸审核生效，对于不含人脸场景，模型产物不存在受信问题，支持自由剪辑后进行二次创作。</div>




<span aceTableMode="list" aceTableWidth="7,16"></span>
|输入：同账号生成的视频 |输出 |
|---|---|
|<video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/24e27818aeb644b6942c2cbc949ddc86" controls></video><br><br><br>> [使用预置虚拟人像](https://www.volcengine.com/docs/82379/2291680#2bf01416)示例生成的视频 |<video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/44d52b9f0768460c8c86b81d2df40350" controls></video><br><br><br>> 输入：将面霜的颜色修改为白色。<br><br>> ratio 修改为16:9 |



<Tabs>
<Tab zoneid="uDnEAkVrnf" title="Python">
<TabTitle>Python</TabTitle>

1. 首次生视频，并获取视频 URL。此处直接用[使用预置虚拟人像](https://www.volcengine.com/docs/82379/2291680#2bf01416)示例生成的视频。

2. 对 Seedance 2.0 生成的视频进行再次编辑。视频原始 URL 的有效期仅 24 小时，本示例将原始视频转存至 TOS 使用。


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">说明</div>


<div data-tips="true" data-tips-type="tip">视频原始 URL 的有效期仅 24 小时，实际使用时，建议您提前转存视频文件。推荐配置火山引擎 TOS 提供的数据订阅功能，将您的视频产物自动转存到自己的 TOS 桶中，便于长期备份或二次加工。详细介绍请参见 <a href="https://www.volcengine.com/docs/6349/2280949?lang=zh">TOS 数据订阅</a>。</div>


```Python
import os
import time
# Install SDK:  pip install 'volcengine-python-sdk[ark]'
from volcenginesdkarkruntime import Ark 

client = Ark(
    # The base URL for model invocation
    base_url='https://ark.cn-beijing.volces.com/api/v3',
    # Get API Key：https://console.volcengine.com/ark/region:ark+cn-beijing/apikey
    api_key=os.environ.get("ARK_API_KEY"),
)

if __name__ == "__main__":
    print("----- create request -----")
    create_result = client.content_generation.tasks.create(
        model="doubao-seedance-2-0-260128", # Replace with Model ID 
        content=[
            {
                "type": "text",
                "text": "将面霜的颜色修改为白色。"
            },                
            {
                "type": "video_url",
                "video_url": {
                    "url": "https://ark-project.tos-cn-beijing.volces.com/doc_video/video_by_sd2.mp4"
                },
                "role": "reference_video"
            },
        ],
        generate_audio=True,
        ratio="16:9",
        duration=11,
        watermark=True,
    )
    print(create_result)
    print("----- polling task status -----")
    task_id = create_result.id
    while True:
        get_result = client.content_generation.tasks.get(task_id=task_id)
        status = get_result.status
        if status == "succeeded":
            print("----- task succeeded -----")
            print(get_result)
            break
        elif status == "failed":
            print("----- task failed -----")
            print(f"Error: {get_result.error}")
            break
        else:
            print(f"Current status: {status}, Retrying after 30 seconds...")
            time.sleep(30)
```



</Tab>
<Tab zoneid="hjVOlHNAuV" title="Java">
<TabTitle>Java</TabTitle>

1. 首次生视频，并获取视频 URL。此处直接用[使用预置虚拟人像](https://www.volcengine.com/docs/82379/2291680#2bf01416)示例生成的视频。

2. 对 Seedance 2.0 生成的视频进行再次编辑。视频原始 URL 的有效期仅 24 小时，本示例将原始视频转存至 TOS 使用。


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">说明</div>


<div data-tips="true" data-tips-type="tip">视频原始 URL 的有效期仅 24 小时，实际使用时，建议您提前转存视频文件。推荐配置火山引擎 TOS 提供的数据订阅功能，将您的视频产物自动转存到自己的 TOS 桶中，便于长期备份或二次加工。详细介绍请参见 <a href="https://www.volcengine.com/docs/6349/2280949?lang=zh">TOS 数据订阅</a>。</div>


```Java
package com.ark.sample;

import com.volcengine.ark.runtime.model.content.generation.*;
import com.volcengine.ark.runtime.model.content.generation.CreateContentGenerationTaskRequest.Content;
import com.volcengine.ark.runtime.service.ArkService;
import okhttp3.ConnectionPool;
import okhttp3.Dispatcher;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

public class ContentGenerationTaskExample {

    // Client initialization
    static String apiKey = System.getenv("ARK_API_KEY");
    static ConnectionPool connectionPool = new ConnectionPool(5, 1, TimeUnit.SECONDS);
    static Dispatcher dispatcher = new Dispatcher();
    static ArkService service = ArkService.builder()
           .baseUrl("https://ark.cn-beijing.volces.com/api/v3") // The base URL for model invocation
           .dispatcher(dispatcher)
           .connectionPool(connectionPool)
           .apiKey(apiKey)
           .build();
           
    public static void main(String[] args) {
        
        // Model ID
        final String modelId = "doubao-seedance-2-0-260128";
        // Text prompt
        final String prompt = "将面霜的颜色修改为白色。";
        
        // Example resource URLs
        final String refVideo = "https://ark-project.tos-cn-beijing.volces.com/doc_video/video_by_sd2.mp4";

        // Output video parameters
        final boolean generateAudio = true;
        final String videoRatio = "16:9";      
        final long videoDuration = 11L;          
        final boolean showWatermark = true;

        System.out.println("----- create request -----");
        // Build request content
        List<Content> contents = new ArrayList<>();
        
        // 1. Text prompt
        contents.add(Content.builder()
                .type("text")
                .text(prompt)
                .build());
                
        // 2. Reference video
        contents.add(Content.builder()
                .type("video_url")
                .videoUrl(CreateContentGenerationTaskRequest.VideoUrl.builder()
                        .url(refVideo)
                        .build())
                .role("reference_video")
                .build());

        // Create video generation task
        CreateContentGenerationTaskRequest createRequest = CreateContentGenerationTaskRequest.builder()
                .generateAudio(generateAudio)
                .model(modelId)
                .content(contents)
                .ratio(videoRatio)
                .duration(videoDuration)
                .watermark(showWatermark)
                .build();

        CreateContentGenerationTaskResult createResult = service.createContentGenerationTask(createRequest);
        System.out.println("Task Created: " + createResult);

        // Get task details and poll status
        String taskId = createResult.getId();
        pollTaskStatus(taskId);
    }

    /**
     * Poll task status
     * @param taskId Task ID
     */

    private static void pollTaskStatus(String taskId) {
        GetContentGenerationTaskRequest getRequest = GetContentGenerationTaskRequest.builder()
                .taskId(taskId)
                .build();

        System.out.println("----- polling task status -----");
        try {
            while (true) {
                GetContentGenerationTaskResponse getResponse = service.getContentGenerationTask(getRequest);
                String status = getResponse.getStatus();

                if ("succeeded".equalsIgnoreCase(status)) {
                    System.out.println("----- task succeeded -----");
                    System.out.println(getResponse);
                    break;
                } else if ("failed".equalsIgnoreCase(status)) {
                    System.out.println("----- task failed -----");
                    if (getResponse.getError() != null) {
                        System.out.println("Error: " + getResponse.getError().getMessage());
                    }
                    break;
                } else {
                    System.out.printf("Current status: %s, Retrying in 10 seconds...%n", status);
                    TimeUnit.SECONDS.sleep(10);
                }
            }
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            System.err.println("Polling interrupted");
        } catch (Exception e) {
            System.err.println("Error occurred: " + e.getMessage());
        } finally {
            service.shutdownExecutor();
        }
    }
}
```



</Tab>
<Tab zoneid="zefvdht12C" title="Go">
<TabTitle>Go</TabTitle>

1. 首次生视频，并获取视频 URL。此处直接用[使用预置虚拟人像](https://www.volcengine.com/docs/82379/2291680#2bf01416)示例生成的视频。

2. 对 Seedance 2.0 生成的视频进行再次编辑。视频原始 URL 的有效期仅 24 小时，本示例将原始视频转存至 TOS 使用。


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">说明</div>


<div data-tips="true" data-tips-type="tip">视频原始 URL 的有效期仅 24 小时，实际使用时，建议您提前转存视频文件。推荐配置火山引擎 TOS 提供的数据订阅功能，将您的视频产物自动转存到自己的 TOS 桶中，便于长期备份或二次加工。详细介绍请参见 <a href="https://www.volcengine.com/docs/6349/2280949?lang=zh">TOS 数据订阅</a>。</div>


```Go
package main

import (
    "context"
    "fmt"
    "os"
    "time"

    "github.com/volcengine/volcengine-go-sdk/service/arkruntime"
    "github.com/volcengine/volcengine-go-sdk/service/arkruntime/model"
    "github.com/volcengine/volcengine-go-sdk/volcengine"
)

func main() {
    // Initialize Ark client
    client := arkruntime.NewClientWithApiKey(
        os.Getenv("ARK_API_KEY"),
        // The base URL for model invocation
        arkruntime.WithBaseUrl("https://ark.cn-beijing.volces.com/api/v3"),
    )
    ctx := context.Background()

    // Model ID
    modelID := "doubao-seedance-2-0-260128"
    // Text prompt
    prompt := "将面霜的颜色修改为白色。"

    // Example resource URLs
    refVideo1 := "https://ark-project.tos-cn-beijing.volces.com/doc_video/video_by_sd2.mp4"

    // Output video parameters
    generateAudio := true
    videoRatio := "16:9"
    videoDuration := int64(11)
    showWatermark := true

    // 1. Create video generation task
    fmt.Println("----- create request -----")
    createReq := model.CreateContentGenerationTaskRequest{
        Model:         modelID,
        GenerateAudio: volcengine.Bool(generateAudio),
        Ratio:         volcengine.String(videoRatio),
        Duration:      volcengine.Int64(videoDuration),
        Watermark:     volcengine.Bool(showWatermark),
        Content: []*model.CreateContentGenerationContentItem{
            {
                Type: model.ContentGenerationContentItemTypeText,
                Text: volcengine.String(prompt),
            },
            {
                Type: model.ContentGenerationContentItemType("video_url"),
                VideoURL: &model.VideoUrl{
                    Url: refVideo1,
                },
                Role: volcengine.String("reference_video"),
            },
        },
    }

    createResp, err := client.CreateContentGenerationTask(ctx, createReq)
    if err != nil {
        fmt.Printf("create content generation error: %v\n", err)
        return
    }

    taskID := createResp.ID
    fmt.Printf("Task Created with ID: %s\n", taskID)

    // 2. Poll task status
    pollTaskStatus(ctx, client, taskID)
}

// poll task status
func pollTaskStatus(ctx context.Context, client *arkruntime.Client, taskID string) {
    fmt.Println("----- polling task status -----")
    for {
        getReq := model.GetContentGenerationTaskRequest{ID: taskID}
        getResp, err := client.GetContentGenerationTask(ctx, getReq)
        if err != nil {
            fmt.Printf("get content generation task error: %v\n", err)
            return
        }

        status := getResp.Status
        if status == "succeeded" {
            fmt.Println("----- task succeeded -----")
            fmt.Printf("Task ID: %s \n", getResp.ID)
            fmt.Printf("Model: %s \n", getResp.Model)
            fmt.Printf("Video URL: %s \n", getResp.Content.VideoURL)
            fmt.Printf("Completion Tokens: %d \n", getResp.Usage.CompletionTokens)
            fmt.Printf("Created At: %d, Updated At: %d\n", getResp.CreatedAt, getResp.UpdatedAt)
            return
        } else if status == "failed" {
            fmt.Println("----- task failed -----")
            if getResp.Error != nil {
                fmt.Printf("Error Code: %s, Message: %s\n", getResp.Error.Code, getResp.Error.Message)
            }
            return
        } else {
            fmt.Printf("Current status: %s, Retrying in 10 seconds... \n", status)
            time.Sleep(10 * time.Second)
        }
    }
}
```



</Tab>
</Tabs>


&nbsp;

<span id="2bf01416"></span>
## 使用预置虚拟人像

对写实风格视频，可通过虚拟人像库预置人像来控制角色样貌。每个素材对应一个独立素材 ID (asset ID)， 在 **content.<模态\>_url.url** 字段中传入 `asset://<asset ID>` 即可生成视频。

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">说明</div>


<div data-tips="true" data-tips-type="tip">开通虚拟人像库，浏览及检索虚拟人像请参见<a href="https://www.volcengine.com/docs/82379/2223965">虚拟人像库</a>。</div>



<span aceTableMode="list" aceTableWidth="3,3,4"></span>
|输入：文本 |输入：虚拟人像、图片 |输出 |
|---|---|---|
|固定机位，近景镜头，清新自然风格。在室内自然光下，**图片1**中美妆博主面带笑容，向镜头介绍**图片2**中的面霜。博主将手里的面霜展示给镜头，开心地说“挖到本命面霜了！”；接着她一边用手指轻轻蘸取面霜展示那种软糯感，一边说“质地像云朵一样软糯，一抹就吸收”；最后她把面霜涂抹在脸颊上，展示着水润透亮的皮肤，同时自信地说“熬夜急救、补水保湿全搞定”。要求画面中人物居中，完整展示人物的整个脑袋和上半身，始终对焦人脸，人脸始终清晰，纯净无任何字幕。<br><br><div data-tips="true" data-tips-type="warning" data-tips-is-title="true">注意</div><br><br><br><div data-tips="true" data-tips-type="warning">Asset ID 仅用来向模型传入素材，提示词中仍需使用"<strong>素材类型+序号</strong>”格式引用素材，序号为请求体中该素材在同类素材中的排序。</div><br><br><br><div data-tips="true" data-tips-type="warning">正确用法：<strong>图片1</strong>中美妆博主</div><br><br><br><div data-tips="true" data-tips-type="warning">错误用法：asset\-2026\*\*\*\*是美妆博主</div><br> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/946509d1f37f476c9ff29e0adaf187eb~tplv-goo7wpa0wc-image.image) </span><br><br>> 虚拟人像<br><br><br><span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/791b783fc6cd4394b13f41b66b5ff461~tplv-goo7wpa0wc-image.image) </span><br><br>> 产品图像 |<video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/0bd96f702bdf48bab1a9505710d9e1f9" controls></video><br> |



<Tabs>
<Tab zoneid="jkyYJdMzkv" title="Python">
<TabTitle>Python</TabTitle>

```Python
import os
import time
# Install SDK:  pip install 'volcengine-python-sdk[ark]'
from volcenginesdkarkruntime import Ark 

client = Ark(
    # The base URL for model invocation
    base_url='https://ark.cn-beijing.volces.com/api/v3',
    # Get API Key：https://console.volcengine.com/ark/region:ark+cn-beijing/apikey
    api_key=os.environ.get("ARK_API_KEY"),
)

if __name__ == "__main__":
    print("----- create request -----")
    create_result = client.content_generation.tasks.create(
        model="doubao-seedance-2-0-260128", # Replace with Model ID 
        content=[
            {
                "type": "text",
                "text": "固定机位，近景镜头，清新自然风格。在室内自然光下，图片1中美妆博主面带笑容，向镜头介绍图片2中的面霜。博主将手里的面霜展示给镜头，开心地说“挖到本命面霜了！”；接着她一边用手指轻轻蘸取面霜展示那种软糯感，一边说“质地像云朵一样软糯，一抹就吸收”；最后她把面霜涂抹在脸颊上，展示着水润透亮的皮肤，同时自信地说“熬夜急救、补水保湿全搞定”。要求画面中人物居中，完整展示人物的整个脑袋和上半身，始终对焦人脸，人脸始终清晰，纯净无任何字幕。"
            },        
            {
                "type": "image_url",
                "image_url": {
                    "url": "asset://asset-20260401123823-6d4x2"
                },
                "role": "reference_image"
            },
            {
                "type": "image_url",
                "image_url": {
                    "url": "https://ark-project.tos-cn-beijing.volces.com/doc_image/r2v_edit_pic1.jpg"
                },
                "role": "reference_image"
            },
        ],
        generate_audio=True,
        ratio="adaptive",
        duration=11,
        watermark=True,
    )
    print(create_result)

    print("----- polling task status -----")
    task_id = create_result.id
    while True:
        get_result = client.content_generation.tasks.get(task_id=task_id)
        status = get_result.status
        if status == "succeeded":
            print("----- task succeeded -----")
            print(get_result)
            break
        elif status == "failed":
            print("----- task failed -----")
            print(f"Error: {get_result.error}")
            break
        else:
            print(f"Current status: {status}, Retrying after 30 seconds...")
            time.sleep(30)
```



</Tab>
<Tab zoneid="U6zzzWUPp4" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.sample;

import com.volcengine.ark.runtime.model.content.generation.*;
import com.volcengine.ark.runtime.model.content.generation.CreateContentGenerationTaskRequest.Content;
import com.volcengine.ark.runtime.service.ArkService;
import okhttp3.ConnectionPool;
import okhttp3.Dispatcher;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

public class ContentGenerationTaskExample {

    // Client initialization
    static String apiKey = System.getenv("ARK_API_KEY");
    static ConnectionPool connectionPool = new ConnectionPool(5, 1, TimeUnit.SECONDS);
    static Dispatcher dispatcher = new Dispatcher();
    static ArkService service = ArkService.builder()
           .baseUrl("https://ark.cn-beijing.volces.com/api/v3") // The base URL for model invocation
           .dispatcher(dispatcher)
           .connectionPool(connectionPool)
           .apiKey(apiKey)
           .build();
           
    public static void main(String[] args) {
        
        // Model ID
        final String modelId = "doubao-seedance-2-0-260128";
        // Text prompt
        final String prompt = "固定机位，近景镜头，清新自然风格。在室内自然光下，图片1中美妆博主面带笑容，向镜头介绍图片2中的面霜。博主将手里的面霜展示给镜头，开心地说“挖到本命面霜了！”；接着她一边用手指轻轻蘸取面霜展示那种软糯感，一边说“质地像云朵一样软糯，一抹就吸收”；最后她把面霜涂抹在脸颊上，展示着水润透亮的皮肤，同时自信地说“熬夜急救、补水保湿全搞定”。要求画面中人物居中，完整展示人物的整个脑袋和上半身，始终对焦人脸，人脸始终清晰，纯净无任何字幕。";
        
        // Example resource URLs
        final String refImage1 = "asset://asset-20260401123823-6d4x2";
        final String refImage2 = "https://ark-project.tos-cn-beijing.volces.com/doc_image/r2v_edit_pic1.jpg";

        // Output video parameters
        final boolean generateAudio = true;
        final String videoRatio = "adaptive";      
        final long videoDuration = 11L;          
        final boolean showWatermark = true;

        System.out.println("----- create request -----");
        // Build request content
        List<Content> contents = new ArrayList<>();
        
        // 1. Text prompt
        contents.add(Content.builder()
                .type("text")
                .text(prompt)
                .build());
                
        // 2. Reference image 1
        contents.add(Content.builder()
                .type("image_url")
                .imageUrl(CreateContentGenerationTaskRequest.ImageUrl.builder()
                        .url(refImage1)
                        .build())
                .role("reference_image")
                .build());

        // 3. Reference image 2
        contents.add(Content.builder()
                .type("image_url")
                .imageUrl(CreateContentGenerationTaskRequest.ImageUrl.builder()
                        .url(refImage2)
                        .build())
                .role("reference_image")
                .build());

        // Create video generation task
        CreateContentGenerationTaskRequest createRequest = CreateContentGenerationTaskRequest.builder()
                .generateAudio(generateAudio)
                .model(modelId)
                .content(contents)
                .ratio(videoRatio)
                .duration(videoDuration)
                .watermark(showWatermark)
                .build();

        CreateContentGenerationTaskResult createResult = service.createContentGenerationTask(createRequest);
        System.out.println("Task Created: " + createResult);

        // Get task details and poll status
        String taskId = createResult.getId();
        pollTaskStatus(taskId);
    }

    /**
     * Poll task status
     * @param taskId Task ID
     */

    private static void pollTaskStatus(String taskId) {
        GetContentGenerationTaskRequest getRequest = GetContentGenerationTaskRequest.builder()
                .taskId(taskId)
                .build();

        System.out.println("----- polling task status -----");
        try {
            while (true) {
                GetContentGenerationTaskResponse getResponse = service.getContentGenerationTask(getRequest);
                String status = getResponse.getStatus();

                if ("succeeded".equalsIgnoreCase(status)) {
                    System.out.println("----- task succeeded -----");
                    System.out.println(getResponse);
                    break;
                } else if ("failed".equalsIgnoreCase(status)) {
                    System.out.println("----- task failed -----");
                    if (getResponse.getError() != null) {
                        System.out.println("Error: " + getResponse.getError().getMessage());
                    }
                    break;
                } else {
                    System.out.printf("Current status: %s, Retrying in 10 seconds...%n", status);
                    TimeUnit.SECONDS.sleep(10);
                }
            }
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            System.err.println("Polling interrupted");
        } catch (Exception e) {
            System.err.println("Error occurred: " + e.getMessage());
        } finally {
            service.shutdownExecutor();
        }
    }
}
```



</Tab>
<Tab zoneid="AR1pzaWkUS" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "os"
    "time"

    "github.com/volcengine/volcengine-go-sdk/service/arkruntime"
    "github.com/volcengine/volcengine-go-sdk/service/arkruntime/model"
    "github.com/volcengine/volcengine-go-sdk/volcengine"
)

func main() {
    // Initialize Ark client
    client := arkruntime.NewClientWithApiKey(
        os.Getenv("ARK_API_KEY"),
        // The base URL for model invocation
        arkruntime.WithBaseUrl("https://ark.cn-beijing.volces.com/api/v3"),
    )
    ctx := context.Background()

    // Model ID
    modelID := "doubao-seedance-2-0-260128"
    // Text prompt
    prompt := "固定机位，近景镜头，清新自然风格。在室内自然光下，图片1中美妆博主面带笑容，向镜头介绍图片2中的面霜。博主将手里的面霜展示给镜头，开心地说“挖到本命面霜了！”；接着她一边用手指轻轻蘸取面霜展示那种软糯感，一边说“质地像云朵一样软糯，一抹就吸收”；最后她把面霜涂抹在脸颊上，展示着水润透亮的皮肤，同时自信地说“熬夜急救、补水保湿全搞定”。要求画面中人物居中，完整展示人物的整个脑袋和上半身，始终对焦人脸，人脸始终清晰，纯净无任何字幕。"

    // Example resource URLs
    refImage1 := "asset://asset-20260401123823-6d4x2"
    refImage2 := "https://ark-project.tos-cn-beijing.volces.com/doc_image/r2v_edit_pic1.jpg"

    // Output video parameters
    generateAudio := true
    videoRatio := "adaptive"
    videoDuration := int64(11)
    showWatermark := true

    // 1. Create video generation task
    fmt.Println("----- create request -----")
    createReq := model.CreateContentGenerationTaskRequest{
        Model:         modelID,
        GenerateAudio: volcengine.Bool(generateAudio),
        Ratio:         volcengine.String(videoRatio),
        Duration:      volcengine.Int64(videoDuration),
        Watermark:     volcengine.Bool(showWatermark),
        Content: []*model.CreateContentGenerationContentItem{
            {
                Type: model.ContentGenerationContentItemTypeText,
                Text: volcengine.String(prompt),
            },
            {
                Type: model.ContentGenerationContentItemType("image_url"),
                ImageURL: &model.ImageURL{
                    URL: refImage1,
                },
                Role: volcengine.String("reference_image"),
            },
            {
                Type: model.ContentGenerationContentItemType("image_url"),
                ImageURL: &model.ImageURL{
                    URL: refImage2,
                },
                Role: volcengine.String("reference_image"),
            },
        },
    }

    createResp, err := client.CreateContentGenerationTask(ctx, createReq)
    if err != nil {
        fmt.Printf("create content generation error: %v\n", err)
        return
    }

    taskID := createResp.ID
    fmt.Printf("Task Created with ID: %s\n", taskID)

    // 2. Poll task status
    pollTaskStatus(ctx, client, taskID)
}

// poll task status
func pollTaskStatus(ctx context.Context, client *arkruntime.Client, taskID string) {
    fmt.Println("----- polling task status -----")
    for {
        getReq := model.GetContentGenerationTaskRequest{ID: taskID}
        getResp, err := client.GetContentGenerationTask(ctx, getReq)
        if err != nil {
            fmt.Printf("get content generation task error: %v\n", err)
            return
        }

        status := getResp.Status
        if status == "succeeded" {
            fmt.Println("----- task succeeded -----")
            fmt.Printf("Task ID: %s \n", getResp.ID)
            fmt.Printf("Model: %s \n", getResp.Model)
            fmt.Printf("Video URL: %s \n", getResp.Content.VideoURL)
            fmt.Printf("Completion Tokens: %d \n", getResp.Usage.CompletionTokens)
            fmt.Printf("Created At: %d, Updated At: %d\n", getResp.CreatedAt, getResp.UpdatedAt)
            return
        } else if status == "failed" {
            fmt.Println("----- task failed -----")
            if getResp.Error != nil {
                fmt.Printf("Error Code: %s, Message: %s\n", getResp.Error.Code, getResp.Error.Message)
            }
            return
        } else {
            fmt.Printf("Current status: %s, Retrying in 10 seconds... \n", status)
            time.Sleep(10 * time.Second)
        }
    }
}
```



</Tab>
</Tabs>


<span id="f952d0c3"></span>
## 使用已授权真人素材

通过真人认证和本人授权后，可将该真人的相关素材（例如该真人的图片、视频、音频）上传至方舟。素材入库成功后，每个素材将获得一个独立素材 ID (asset ID)， 在 **content.<模态\>_url.url** 字段中传入 `asset://<asset ID>`即可使用该素材生成视频。真人认证及素材入库流程请参见[录入真人形象素材](https://www.volcengine.com/docs/82379/2315856)。

```text
...
"content": [
         {
            "type": "text",
            "text": "<your prompt>"
        },
        {
            "type": "image_url",
            "image_url": {
                "url": "asset://<asset ID>"
            },
            "role": "reference_image"
        },
        {
            "type": "video_url",
            "video_url": {
                "url": "asset://<asset ID>"
            },
            "role": "reference_video"
        },
        {
            "type": "audio_url",
            "audio_url": {
                "url": "asset://<asset ID>"
            },
            "role": "reference_audio"
        }
    ]
...
```


&nbsp;

<span id="2d8359f8"></span>
# 提示词技巧

<span id=".5o-Q56S66K-NLXNraWxs"></span>
## 提示词 Skill

平台提供 **Seedance 2.0 提示词优化技能**，方便您对提示词进行调优。


* **配置方式**：可将技能文件配置到 Code Agent / AI Agent 中使用。以 OpenClaw 为例，下载该 SKILL.md 文件，复制完整内容至对话输入框中，并发送”请帮我安装这个技能”，等待工具自动完成安装。

* **使用方式**：在 AI 对话框输入 `/sd2-pe + 你的提示词内容`，开始调试提示词。


<Attachment link="https://arkdoc.tos-cn-beijing.volces.com/files/video-generation/SKILL.md" name="SKILL.md">SKILL.md</Attachment>


<span id=".5o-Q56S66K-N6KeE5YiZ"></span>
## 提示词规则


* 提示词中必须使用"**素材类型+序号**”格式引用素材，序号为请求体中该素材在同类素材中的排序。例如 「图片 n」指代`content`数组中第 n 个`type="image_url"`的参考图片（按数组顺序从1开始计数）。**注意不支持使用 Asset ID 指代素材**。

* 不同任务的提示词公式及详细规则请参见 [Doubao Seedance 2.0 系列提示词指南](https://www.volcengine.com/docs/82379/2222480)。


<span id="66cb028f"></span>
# 使用限制

参见[使用限制](https://www.volcengine.com/docs/82379/1366799#66cb028f)。

<span id="d21b3c92"></span>
# 常见问题

<span id="1df655fb"></span>
## 视频画面存在跳变

**典型现象**

**首帧图生视频**、**首尾帧图生视频**场景中，生成视频部分帧出现画面拉伸、压缩等跳变问题。

**根因分析**

输入图片与输出视频的分辨率宽高不一致，引发视频画面帧间跳变。

**解决方案**


1. 裁剪输入图片：参考 Seedance 2.0 系列模型支持的宽高像素值表格（见 [创建视频生成任务 API](https://www.volcengine.com/docs/82379/1520757?lang=zh) ratio 字段），将输入图片裁剪为目标宽高像素值。

2. 将 API 的 **ratio** 字段设置为`adaptive`。

3. 使用 Seedance 2.0 系列模型重新发起首帧/首尾帧图生视频任务。





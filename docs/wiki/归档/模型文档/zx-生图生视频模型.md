# 文生图

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /images/generations:
    post:
      summary: 文生图
      deprecated: false
      description: 根据文本提示词生成图片。
      operationId: createImageGeneration
      tags:
        - 绘画模型
        - 绘画模型
      parameters: []
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ImageGenerationRequest'
            examples:
              基础文生图:
                value:
                  model: grok-imagine
                  prompt: 一只在草地上奔跑的柯基犬，卡通风格
                  'n': 1
                  size: 1024x1024
                summary: 基础文生图
      responses:
        '200':
          description: 成功
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ImageResponse'
              example:
                created: 1730000000
                data:
                  - url: https://cdn.example.com/generated/image1.png
                    revised_prompt: 一只在阳光洒满的绿色草地上奔跑的柯基犬，卡通风格插画
          headers: {}
          x-apifox-name: ''
        '400':
          description: 请求参数错误
          content:
            application/json:
              schema: &ref_0
                $ref: '#/components/schemas/ErrorResponse'
          headers: {}
          x-apifox-name: BadRequest
        '401':
          description: API Key 缺失或无效
          content:
            application/json:
              schema: *ref_0
          headers: {}
          x-apifox-name: Unauthorized
        '403':
          description: 当前分组无绘画权限
          content:
            application/json:
              schema: *ref_0
          headers: {}
          x-apifox-name: ''
        '429':
          description: 请求过于频繁或额度不足，响应头可能包含 `Retry-After`
          content:
            application/json:
              schema: *ref_0
          headers: {}
          x-apifox-name: RateLimited
        '500':
          description: 服务端或上游错误
          content:
            application/json:
              schema: *ref_0
          headers: {}
          x-apifox-name: ServerError
      security:
        - BearerAuth: []
          x-apifox:
            schemeGroups:
              - id: XOuIzenrMxlUyZuIeLKNb
                schemeIds:
                  - BearerAuth
            required: true
            use:
              id: XOuIzenrMxlUyZuIeLKNb
            scopes:
              XOuIzenrMxlUyZuIeLKNb:
                BearerAuth: []
      x-apifox-folder: 绘画模型
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/7607380/apis/api-485249872-run
components:
  schemas:
    ImageGenerationRequest:
      type: object
      required:
        - model
        - prompt
      properties:
        model:
          type: string
          enum:
            - grok-imagine
            - grok-imagine-image
            - grok-imagine-image-quality
          examples:
            - grok-imagine
        prompt:
          type: string
          description: 图片描述提示词
        'n':
          type: integer
          default: 1
          description: 生成图片数量
        size:
          type: string
          description: 期望的图片尺寸，如 1024x1024、1024x1792 等（用于计费分档，不同尺寸档位可能影响出图效果）
          examples:
            - 1024x1024
      x-apifox-orders:
        - model
        - prompt
        - 'n'
        - size
      x-apifox-ignore-properties: []
      x-apifox-folder: ''
    ImageResponse:
      type: object
      properties:
        created:
          type: integer
        data:
          type: array
          items:
            type: object
            properties:
              url:
                type: string
                description: 生成图片的下载地址（与 b64_json 二选一返回）
              b64_json:
                type: string
                description: Base64 编码的图片内容（与 url 二选一返回）
              revised_prompt:
                type: string
                description: 模型实际使用的（可能被优化过的）提示词
            x-apifox-orders:
              - url
              - b64_json
              - revised_prompt
            x-apifox-ignore-properties: []
      x-apifox-orders:
        - created
        - data
      x-apifox-ignore-properties: []
      x-apifox-folder: ''
    ErrorResponse:
      type: object
      properties:
        error:
          type: object
          properties:
            type:
              type: string
              examples:
                - invalid_request_error
            message:
              type: string
              examples:
                - model is required
          x-apifox-orders:
            - type
            - message
          x-apifox-ignore-properties: []
      x-apifox-orders:
        - error
      x-apifox-ignore-properties: []
      x-apifox-folder: ''
  securitySchemes:
    BearerAuth:
      type: bearer
      scheme: bearer
      bearerFormat: API Key
      description: '在请求头中传入 `Authorization: Bearer <你的API Key>`'
servers: []
security:
  - BearerAuth: []
    x-apifox:
      schemeGroups:
        - id: XOuIzenrMxlUyZuIeLKNb
          schemeIds:
            - BearerAuth
      required: true
      use:
        id: XOuIzenrMxlUyZuIeLKNb
      scopes:
        XOuIzenrMxlUyZuIeLKNb:
          BearerAuth: []

```

# 图片编辑 / 图生图

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /images/edits:
    post:
      summary: 图片编辑 / 图生图
      deprecated: false
      description: |
        对已有图片进行局部重绘或基于参考图生成新图，支持 `application/json`
        （图片以 URL 传入）与 `multipart/form-data`（直接上传图片文件）两种方式。
      operationId: createImageEdit
      tags:
        - 绘画模型
        - 绘画模型
      parameters: []
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ImageEditRequestJSON'
            examples:
              基于URL编辑:
                value:
                  model: grok-imagine-edit
                  prompt: 把背景换成海边日落
                  image: https://example.com/source.png
                  mask:
                    image_url: https://example.com/mask.png
                  'n': 1
                summary: 基于URL编辑
      responses:
        '200':
          description: 成功
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ImageResponse'
              example:
                created: 1730000000
                data:
                  - url: https://cdn.example.com/generated/edited1.png
          headers: {}
          x-apifox-name: ''
        '400':
          description: 请求参数错误
          content:
            application/json:
              schema: &ref_0
                $ref: '#/components/schemas/ErrorResponse'
          headers: {}
          x-apifox-name: BadRequest
        '401':
          description: API Key 缺失或无效
          content:
            application/json:
              schema: *ref_0
          headers: {}
          x-apifox-name: Unauthorized
        '403':
          description: 当前分组无绘画权限
          content:
            application/json:
              schema: *ref_0
          headers: {}
          x-apifox-name: ''
        '429':
          description: 请求过于频繁或额度不足，响应头可能包含 `Retry-After`
          content:
            application/json:
              schema: *ref_0
          headers: {}
          x-apifox-name: RateLimited
        '500':
          description: 服务端或上游错误
          content:
            application/json:
              schema: *ref_0
          headers: {}
          x-apifox-name: ServerError
      security:
        - BearerAuth: []
          x-apifox:
            schemeGroups:
              - id: XOuIzenrMxlUyZuIeLKNb
                schemeIds:
                  - BearerAuth
            required: true
            use:
              id: XOuIzenrMxlUyZuIeLKNb
            scopes:
              XOuIzenrMxlUyZuIeLKNb:
                BearerAuth: []
      x-apifox-folder: 绘画模型
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/7607380/apis/api-485249873-run
components:
  schemas:
    ImageEditRequestJSON:
      type: object
      required:
        - model
        - prompt
        - image
      properties:
        model:
          type: string
          enum:
            - grok-imagine-edit
        prompt:
          type: string
          description: 编辑指令描述
        image:
          description: 原图，支持字符串 URL/DataURL，或数组形式传入多张参考图
          oneOf:
            - type: string
            - type: array
              items:
                type: object
                properties:
                  image_url:
                    type: string
                x-apifox-orders:
                  - image_url
                x-apifox-ignore-properties: []
        mask:
          type: object
          description: 蒙版图（可选），指定需要重绘的区域
          properties:
            image_url:
              type: string
          x-apifox-orders:
            - image_url
          x-apifox-ignore-properties: []
        'n':
          type: integer
          default: 1
      x-apifox-orders:
        - model
        - prompt
        - image
        - mask
        - 'n'
      x-apifox-ignore-properties: []
      x-apifox-folder: ''
    ImageResponse:
      type: object
      properties:
        created:
          type: integer
        data:
          type: array
          items:
            type: object
            properties:
              url:
                type: string
                description: 生成图片的下载地址（与 b64_json 二选一返回）
              b64_json:
                type: string
                description: Base64 编码的图片内容（与 url 二选一返回）
              revised_prompt:
                type: string
                description: 模型实际使用的（可能被优化过的）提示词
            x-apifox-orders:
              - url
              - b64_json
              - revised_prompt
            x-apifox-ignore-properties: []
      x-apifox-orders:
        - created
        - data
      x-apifox-ignore-properties: []
      x-apifox-folder: ''
    ErrorResponse:
      type: object
      properties:
        error:
          type: object
          properties:
            type:
              type: string
              examples:
                - invalid_request_error
            message:
              type: string
              examples:
                - model is required
          x-apifox-orders:
            - type
            - message
          x-apifox-ignore-properties: []
      x-apifox-orders:
        - error
      x-apifox-ignore-properties: []
      x-apifox-folder: ''
  securitySchemes:
    BearerAuth:
      type: bearer
      scheme: bearer
      bearerFormat: API Key
      description: '在请求头中传入 `Authorization: Bearer <你的API Key>`'
servers: []
security:
  - BearerAuth: []
    x-apifox:
      schemeGroups:
        - id: XOuIzenrMxlUyZuIeLKNb
          schemeIds:
            - BearerAuth
      required: true
      use:
        id: XOuIzenrMxlUyZuIeLKNb
      scopes:
        XOuIzenrMxlUyZuIeLKNb:
          BearerAuth: []

```

# 视频生成

# 视频生成（OpenAI Sora 标准路径）

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /v1/videos:
    post:
      summary: 视频生成（OpenAI Sora 标准路径）
      deprecated: false
      description: >
        支持三种模式，由请求携带的字段决定，三选一、不可混用：


        | 模式 | 触发字段 | `prompt` 要求 | 说明 |

        | --- | --- | --- | --- |

        | 文生视频（T2V） | 只有 `prompt` | 必填 | 纯文本描述生成视频 |

        | 图生视频（I2V） | 单张 `image` | 可选（不传则仅根据图片生成） | 以该图片为起始帧生成动态视频 |

        | 参考图生视频（R2V） | 多张 `image`/`images`/`reference_images` | 必填 | 以多张参考图的内容为
        guide 生成视频（不锁定首帧），**仅 `grok-imagine-video` 支持**，`grok-imagine-video-1.5`
        会被自动降级 |


        该接口为异步任务：提交成功后返回任务信息（OpenAI Sora 标准的 video

        对象），需通过 `GET /v1/videos/{id}` 轮询生成状态，完成后可直接从状态

        响应的 `video_url` 字段获取下载直链，或调用

        `GET /v1/videos/{id}/content` 下载视频文件二进制内容。


        这是 OpenAI 官方 Sora Video API 的路径约定，也是 new-api 等中转程序把

        渠道类型配置为 "Sora"/"OpenAI" 时固定请求上游的路径 —— 把本服务的地址

        配置为该类渠道的 Base URL，即可把此处的视频能力接入 new-api 转发使用。

        `/v1/videos/generations`、`/v1/video/generations` 是完全等价的兼容别名。


        **多图格式兼容**：无论客户端传入的 `image`/`images`/`reference_images`/

        `input_reference` 字段是纯字符串（URL）、字符串数组，还是

        `{"url": "..."}` / `{"image_url": "..."}` 对象（数组），服务端都会

        自动识别并转换为 xAI 官方要求的 `{"url": "..."}` 对象格式，单图归位到

        `image`，多图归位到 `reference_images`，调用方无需手动拼接。
      operationId: createVideo
      tags:
        - 视频模型
        - 视频模型
      parameters: []
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/VideoGenerationRequest'
            examples:
              文生视频:
                value:
                  model: grok-imagine-video
                  prompt: 海浪拍打礁石，慢镜头，电影感
                  resolution: 720p
                  duration: 8
                summary: 文生视频
              图生视频（单图，1.5支持）:
                value:
                  model: grok-imagine-video-1.5
                  prompt: 让画面中的云朵缓慢飘动
                  image: https://example.com/source.jpg
                  resolution: 720p
                  duration: 5
                summary: 图生视频（单图，1.5支持）
              参考图生视频（多图，仅grok-imagine-video支持）:
                value:
                  model: grok-imagine-video
                  prompt: 模特穿着参考图中的服装走秀
                  reference_images:
                    - url: https://example.com/model.jpg
                    - url: https://example.com/outfit.jpg
                  duration: 10
                  resolution: 720p
                summary: 参考图生视频（多图，仅grok-imagine-video支持）
              new-api风格多图（自动转换为reference_images）:
                value:
                  model: sora-2-pro
                  prompt: 模特穿着参考图中的服装走秀
                  images:
                    - https://example.com/model.jpg
                    - https://example.com/outfit.jpg
                  seconds: '10'
                summary: new-api风格多图（自动转换为reference_images）
              Sora风格请求（经new-api转发）:
                value:
                  model: sora-2
                  prompt: 一只猫在阳光下打盹
                  size: 1280x720
                  seconds: '8'
                summary: Sora风格请求（经new-api转发）
      responses:
        '200':
          description: 任务已提交
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/VideoObject'
              example:
                id: video-req-abc123
                object: video
                model: grok-imagine-video
                status: queued
                progress: 0
                created_at: 1730000000
                seconds: '8'
                size: 1280x720
          headers: {}
          x-apifox-name: ''
        '400':
          description: 请求参数错误
          content:
            application/json:
              schema: &ref_0
                $ref: '#/components/schemas/ErrorResponse'
          headers: {}
          x-apifox-name: BadRequest
        '401':
          description: API Key 缺失或无效
          content:
            application/json:
              schema: *ref_0
          headers: {}
          x-apifox-name: Unauthorized
        '403':
          description: 当前分组无绘画/视频生成权限
          content:
            application/json:
              schema: *ref_0
          headers: {}
          x-apifox-name: ''
        '429':
          description: 请求过于频繁或额度不足，响应头可能包含 `Retry-After`
          content:
            application/json:
              schema: *ref_0
          headers: {}
          x-apifox-name: RateLimited
        '500':
          description: 服务端或上游错误
          content:
            application/json:
              schema: *ref_0
          headers: {}
          x-apifox-name: ServerError
      security:
        - BearerAuth: []
          x-apifox:
            schemeGroups:
              - id: lvyU21G6mbzAHA12d62Iy
                schemeIds:
                  - BearerAuth
            required: true
            use:
              id: lvyU21G6mbzAHA12d62Iy
            scopes:
              lvyU21G6mbzAHA12d62Iy:
                BearerAuth: []
      x-apifox-folder: 视频模型
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/7607380/apis/api-428600316-run
components:
  schemas:
    VideoGenerationRequest:
      type: object
      required:
        - model
      properties:
        model:
          type: string
          description: |
            视频模型 ID，见顶部支持模型列表（必填）。也接受 `sora-2`/
            `sora-2-pro`（自动映射为 `grok-imagine-video`/
            `grok-imagine-video-1.5`），方便直接对接以 OpenAI Sora 模型名
            请求的中转程序。若请求携带多张参考图（`reference_images`/多图
            `image`/`images`），无论指定哪个模型，都会被自动改用
            `grok-imagine-video` 转发。
          enum:
            - grok-imagine-video
            - grok-imagine-video-1.5
            - sora-2
            - sora-2-pro
          examples:
            - grok-imagine-video-1.5
        prompt:
          type: string
          description: |
            视频内容描述提示词。文生视频（T2V）和参考图生视频（R2V）模式下
            必填；图生视频（I2V，单图）模式下可选——不提供时模型仅根据图片
            内容生成视频。
        resolution:
          type: string
          enum:
            - 480p
            - 720p
            - 1080p
          default: 480p
          description: |
            视频分辨率（Grok 原生参数）。`1080p` 仅 `grok-imagine-video-1.5`
            的图生视频模式支持。
        duration:
          type: integer
          minimum: 1
          maximum: 15
          default: 8
          description: |
            视频时长（秒，Grok 原生参数），取值范围 1-15，默认 8 秒。使用
            参考图（`reference_images`/多图）时最大只允许 10 秒。同时支持
            数字（`8`）与字符串（`"8"`）两种写法。
        aspect_ratio:
          type: string
          enum:
            - '1:1'
            - '16:9'
            - '9:16'
            - '4:3'
            - '3:4'
            - '3:2'
            - '2:3'
          default: '16:9'
          description: |
            视频宽高比。图生视频（I2V）默认继承输入图片的宽高比，除非显式
            指定该参数覆盖；若同时指定该参数会拉伸图片以匹配目标比例。
        size:
          type: string
          description: |
            OpenAI Sora 风格的像素尺寸（如 `1280x720`），作为 `resolution`
            的等价别名，两者任选其一即可。
          examples:
            - 1280x720
        seconds:
          type: string
          description: OpenAI Sora 风格的时长（字符串），作为 `duration` 的等价别名，效果和取值范围完全相同。
          examples:
            - '8'
        image:
          description: |
            输入图片，决定图生视频（单图）或参考图生视频（多图）模式，与
            `reference_images`/`images` 三个字段等价（服务端会统一按数量归位
            到互斥的 `image`/`reference_images` 字段再转发）：
            - 提供单张图片（字符串或对象）→ 图生视频（I2V），该图作为起始帧
            - 提供多张图片（数组，最多 7 张）→ 参考图生视频（R2V），内容作为
              视觉参考、不锁定首帧，**仅 `grok-imagine-video` 支持**
            - 不提供 → 纯文生视频（T2V）

            单个元素支持字符串 URL/DataURL，或 `{"url": "..."}` /
            `{"image_url": "..."}` 对象；new-api 等中转程序常用的纯字符串数组
            （`["url1", "url2"]`）也会被自动识别并转换。
          oneOf:
            - type: string
              description: 图片 URL 或 data URL（单图，图生视频）
            - type: object
              description: 单图对象形式
              properties:
                url:
                  type: string
                  description: 图片的公网 URL 或 base64 data URL（JPEG/PNG/WebP），与 file_id 二选一
                image_url:
                  type: string
                  description: 兼容旧版键名，等价于 url
                file_id:
                  type: string
                  description: Files API 上传后得到的文件 ID
              x-apifox-orders:
                - url
                - image_url
                - file_id
              x-apifox-ignore-properties: []
            - type: array
              description: 多图数组（参考图生视频），数组元素可以是字符串或对象
              maxItems: 7
              items:
                oneOf:
                  - type: string
                  - type: object
                    properties:
                      url:
                        type: string
                      image_url:
                        type: string
                      file_id:
                        type: string
                    x-apifox-orders:
                      - url
                      - image_url
                      - file_id
                    x-apifox-ignore-properties: []
        images:
          description: |
            **推荐用于传多图**：与 `image`（多图写法）/`reference_images`
            等价的别名字段（new-api 等中转程序的多图字段通常就叫这个名字），
            数组形式，最多 7 张，效果与传入数组形式的 `image` 完全相同，
            会被服务端统一规整为 xAI 官方的 `reference_images` 格式转发。
          type: array
          maxItems: 7
          items:
            oneOf:
              - type: string
              - type: object
                properties:
                  url:
                    type: string
                  image_url:
                    type: string
                  file_id:
                    type: string
                x-apifox-orders:
                  - url
                  - image_url
                  - file_id
                x-apifox-ignore-properties: []
        reference_images:
          description: |
            xAI 官方参考图生视频（R2V）字段名，效果与传入数组形式的
            `image`/`images` 完全相同。xAI 官方要求数组元素固定为
            `{"url": "..."}` 对象；本服务额外兼容元素为纯字符串的写法并
            自动转换成对象格式。最多 7 张。
          type: array
          maxItems: 7
          items:
            type: object
            properties:
              url:
                type: string
              image_url:
                type: string
                description: 兼容旧版键名，等价于 url
            x-apifox-orders:
              - url
              - image_url
            x-apifox-ignore-properties: []
        input_reference:
          description: OpenAI Sora 风格的参考图字段，作为 `image` 的等价别名（单图/多图写法均兼容）。
          oneOf:
            - type: string
            - type: array
              items:
                type: string
      x-apifox-orders:
        - model
        - prompt
        - resolution
        - duration
        - aspect_ratio
        - size
        - seconds
        - image
        - images
        - reference_images
        - input_reference
      x-apifox-ignore-properties: []
      x-apifox-folder: ''
    VideoObject:
      type: object
      description: |
        OpenAI Sora 标准的视频对象。视频生成接口、状态查询接口统一返回该结构。
        `status` 为 `completed` 后额外携带 `video_url` 字段（本服务在标准
        Sora 字段基础上的扩展，方便直接拿到下载直链而无需再调用
        `GET /v1/videos/{id}/content`）。
      properties:
        id:
          type: string
          description: 视频生成任务 ID，用于后续状态查询与内容下载
        object:
          type: string
          examples:
            - video
        model:
          type: string
          description: 实际使用的模型；生成任务失败（status=failed）时该字段可能缺省
        status:
          type: string
          enum:
            - queued
            - in_progress
            - completed
            - failed
          description: |
            任务状态：`queued`（排队中，对应 xAI 原生 pending 且未开始处理）、
            `in_progress`（生成中）、`completed`（已完成）、`failed`（失败或已过期）
        progress:
          type: integer
          minimum: 0
          maximum: 100
          description: 生成进度百分比（0-100），完成后固定为 100，失败时可能缺省
        created_at:
          type: integer
          description: 任务创建时间（Unix 时间戳）
        completed_at:
          type: integer
          description: 任务完成时间（Unix 时间戳），仅 `completed` 状态返回
        seconds:
          type: string
          description: 视频实际时长（秒）
        size:
          type: string
          description: 视频尺寸（近似值，由分辨率档位换算，仅供展示参考）
        video_url:
          type: string
          description: 视频下载直链（xAI 侧的临时链接，有时效性，建议尽快下载或转存），仅 `completed` 状态返回
        error:
          type: object
          description: 生成失败后返回
          properties:
            message:
              type: string
              description: 错误信息
            code:
              type: string
              description: |
                错误代码，常见取值：`invalid_argument`（请求参数无效，如
                不支持的时长/图片格式/模式冲突/内容被审核拦截）、
                `permission_denied`（API Key 或团队无权限）、
                `failed_precondition`（当前模型/设置不支持该操作）、
                `service_unavailable`（服务临时过载）、
                `internal_error`（内部错误）、`expired`（任务已过期）
          x-apifox-orders:
            - message
            - code
          x-apifox-ignore-properties: []
      x-apifox-orders:
        - id
        - object
        - model
        - status
        - progress
        - created_at
        - completed_at
        - seconds
        - size
        - video_url
        - error
      x-apifox-ignore-properties: []
      x-apifox-folder: ''
    ErrorResponse:
      type: object
      properties:
        error:
          type: object
          properties:
            type:
              type: string
              examples:
                - invalid_request_error
            message:
              type: string
              examples:
                - model is required
          x-apifox-orders:
            - type
            - message
          x-apifox-ignore-properties: []
      x-apifox-orders:
        - error
      x-apifox-ignore-properties: []
      x-apifox-folder: ''
  securitySchemes:
    BearerAuth:
      type: bearer
      scheme: bearer
      bearerFormat: API Key
      description: '在请求头中传入 `Authorization: Bearer <你的API Key>`'
servers: []
security:
  - BearerAuth: []
    x-apifox:
      schemeGroups:
        - id: lvyU21G6mbzAHA12d62Iy
          schemeIds:
            - BearerAuth
      required: true
      use:
        id: lvyU21G6mbzAHA12d62Iy
      scopes:
        lvyU21G6mbzAHA12d62Iy:
          BearerAuth: []

```

# 视频生成（兼容别名，等价于 POST /v1/videos）

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /v1/videos/generations:
    post:
      summary: 视频生成（兼容别名，等价于 POST /v1/videos）
      deprecated: false
      description: 与 `POST /v1/videos` 完全等价，仅路径风格不同，保留用于兼容早期集成。支持的参数与请求模式完全一致。
      operationId: createVideoGenerationLegacy
      tags:
        - 视频模型
        - 视频模型
      parameters: []
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/VideoGenerationRequest'
      responses:
        '200':
          description: 任务已提交
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/VideoObject'
          headers: {}
          x-apifox-name: ''
        '400':
          description: 请求参数错误
          content:
            application/json:
              schema: &ref_0
                $ref: '#/components/schemas/ErrorResponse'
          headers: {}
          x-apifox-name: BadRequest
        '401':
          description: API Key 缺失或无效
          content:
            application/json:
              schema: *ref_0
          headers: {}
          x-apifox-name: Unauthorized
        '429':
          description: 请求过于频繁或额度不足，响应头可能包含 `Retry-After`
          content:
            application/json:
              schema: *ref_0
          headers: {}
          x-apifox-name: RateLimited
        '500':
          description: 服务端或上游错误
          content:
            application/json:
              schema: *ref_0
          headers: {}
          x-apifox-name: ServerError
      security:
        - BearerAuth: []
          x-apifox:
            schemeGroups:
              - id: lvyU21G6mbzAHA12d62Iy
                schemeIds:
                  - BearerAuth
            required: true
            use:
              id: lvyU21G6mbzAHA12d62Iy
            scopes:
              lvyU21G6mbzAHA12d62Iy:
                BearerAuth: []
      x-apifox-folder: 视频模型
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/7607380/apis/api-486090227-run
components:
  schemas:
    VideoGenerationRequest:
      type: object
      required:
        - model
      properties:
        model:
          type: string
          description: |
            视频模型 ID，见顶部支持模型列表（必填）。也接受 `sora-2`/
            `sora-2-pro`（自动映射为 `grok-imagine-video`/
            `grok-imagine-video-1.5`），方便直接对接以 OpenAI Sora 模型名
            请求的中转程序。若请求携带多张参考图（`reference_images`/多图
            `image`/`images`），无论指定哪个模型，都会被自动改用
            `grok-imagine-video` 转发。
          enum:
            - grok-imagine-video
            - grok-imagine-video-1.5
            - sora-2
            - sora-2-pro
          examples:
            - grok-imagine-video-1.5
        prompt:
          type: string
          description: |
            视频内容描述提示词。文生视频（T2V）和参考图生视频（R2V）模式下
            必填；图生视频（I2V，单图）模式下可选——不提供时模型仅根据图片
            内容生成视频。
        resolution:
          type: string
          enum:
            - 480p
            - 720p
            - 1080p
          default: 480p
          description: |
            视频分辨率（Grok 原生参数）。`1080p` 仅 `grok-imagine-video-1.5`
            的图生视频模式支持。
        duration:
          type: integer
          minimum: 1
          maximum: 15
          default: 8
          description: |
            视频时长（秒，Grok 原生参数），取值范围 1-15，默认 8 秒。使用
            参考图（`reference_images`/多图）时最大只允许 10 秒。同时支持
            数字（`8`）与字符串（`"8"`）两种写法。
        aspect_ratio:
          type: string
          enum:
            - '1:1'
            - '16:9'
            - '9:16'
            - '4:3'
            - '3:4'
            - '3:2'
            - '2:3'
          default: '16:9'
          description: |
            视频宽高比。图生视频（I2V）默认继承输入图片的宽高比，除非显式
            指定该参数覆盖；若同时指定该参数会拉伸图片以匹配目标比例。
        size:
          type: string
          description: |
            OpenAI Sora 风格的像素尺寸（如 `1280x720`），作为 `resolution`
            的等价别名，两者任选其一即可。
          examples:
            - 1280x720
        seconds:
          type: string
          description: OpenAI Sora 风格的时长（字符串），作为 `duration` 的等价别名，效果和取值范围完全相同。
          examples:
            - '8'
        image:
          description: |
            输入图片，决定图生视频（单图）或参考图生视频（多图）模式，与
            `reference_images`/`images` 三个字段等价（服务端会统一按数量归位
            到互斥的 `image`/`reference_images` 字段再转发）：
            - 提供单张图片（字符串或对象）→ 图生视频（I2V），该图作为起始帧
            - 提供多张图片（数组，最多 7 张）→ 参考图生视频（R2V），内容作为
              视觉参考、不锁定首帧，**仅 `grok-imagine-video` 支持**
            - 不提供 → 纯文生视频（T2V）

            单个元素支持字符串 URL/DataURL，或 `{"url": "..."}` /
            `{"image_url": "..."}` 对象；new-api 等中转程序常用的纯字符串数组
            （`["url1", "url2"]`）也会被自动识别并转换。
          oneOf:
            - type: string
              description: 图片 URL 或 data URL（单图，图生视频）
            - type: object
              description: 单图对象形式
              properties:
                url:
                  type: string
                  description: 图片的公网 URL 或 base64 data URL（JPEG/PNG/WebP），与 file_id 二选一
                image_url:
                  type: string
                  description: 兼容旧版键名，等价于 url
                file_id:
                  type: string
                  description: Files API 上传后得到的文件 ID
              x-apifox-orders:
                - url
                - image_url
                - file_id
              x-apifox-ignore-properties: []
            - type: array
              description: 多图数组（参考图生视频），数组元素可以是字符串或对象
              maxItems: 7
              items:
                oneOf:
                  - type: string
                  - type: object
                    properties:
                      url:
                        type: string
                      image_url:
                        type: string
                      file_id:
                        type: string
                    x-apifox-orders:
                      - url
                      - image_url
                      - file_id
                    x-apifox-ignore-properties: []
        images:
          description: |
            **推荐用于传多图**：与 `image`（多图写法）/`reference_images`
            等价的别名字段（new-api 等中转程序的多图字段通常就叫这个名字），
            数组形式，最多 7 张，效果与传入数组形式的 `image` 完全相同，
            会被服务端统一规整为 xAI 官方的 `reference_images` 格式转发。
          type: array
          maxItems: 7
          items:
            oneOf:
              - type: string
              - type: object
                properties:
                  url:
                    type: string
                  image_url:
                    type: string
                  file_id:
                    type: string
                x-apifox-orders:
                  - url
                  - image_url
                  - file_id
                x-apifox-ignore-properties: []
        reference_images:
          description: |
            xAI 官方参考图生视频（R2V）字段名，效果与传入数组形式的
            `image`/`images` 完全相同。xAI 官方要求数组元素固定为
            `{"url": "..."}` 对象；本服务额外兼容元素为纯字符串的写法并
            自动转换成对象格式。最多 7 张。
          type: array
          maxItems: 7
          items:
            type: object
            properties:
              url:
                type: string
              image_url:
                type: string
                description: 兼容旧版键名，等价于 url
            x-apifox-orders:
              - url
              - image_url
            x-apifox-ignore-properties: []
        input_reference:
          description: OpenAI Sora 风格的参考图字段，作为 `image` 的等价别名（单图/多图写法均兼容）。
          oneOf:
            - type: string
            - type: array
              items:
                type: string
      x-apifox-orders:
        - model
        - prompt
        - resolution
        - duration
        - aspect_ratio
        - size
        - seconds
        - image
        - images
        - reference_images
        - input_reference
      x-apifox-ignore-properties: []
      x-apifox-folder: ''
    VideoObject:
      type: object
      description: |
        OpenAI Sora 标准的视频对象。视频生成接口、状态查询接口统一返回该结构。
        `status` 为 `completed` 后额外携带 `video_url` 字段（本服务在标准
        Sora 字段基础上的扩展，方便直接拿到下载直链而无需再调用
        `GET /v1/videos/{id}/content`）。
      properties:
        id:
          type: string
          description: 视频生成任务 ID，用于后续状态查询与内容下载
        object:
          type: string
          examples:
            - video
        model:
          type: string
          description: 实际使用的模型；生成任务失败（status=failed）时该字段可能缺省
        status:
          type: string
          enum:
            - queued
            - in_progress
            - completed
            - failed
          description: |
            任务状态：`queued`（排队中，对应 xAI 原生 pending 且未开始处理）、
            `in_progress`（生成中）、`completed`（已完成）、`failed`（失败或已过期）
        progress:
          type: integer
          minimum: 0
          maximum: 100
          description: 生成进度百分比（0-100），完成后固定为 100，失败时可能缺省
        created_at:
          type: integer
          description: 任务创建时间（Unix 时间戳）
        completed_at:
          type: integer
          description: 任务完成时间（Unix 时间戳），仅 `completed` 状态返回
        seconds:
          type: string
          description: 视频实际时长（秒）
        size:
          type: string
          description: 视频尺寸（近似值，由分辨率档位换算，仅供展示参考）
        video_url:
          type: string
          description: 视频下载直链（xAI 侧的临时链接，有时效性，建议尽快下载或转存），仅 `completed` 状态返回
        error:
          type: object
          description: 生成失败后返回
          properties:
            message:
              type: string
              description: 错误信息
            code:
              type: string
              description: |
                错误代码，常见取值：`invalid_argument`（请求参数无效，如
                不支持的时长/图片格式/模式冲突/内容被审核拦截）、
                `permission_denied`（API Key 或团队无权限）、
                `failed_precondition`（当前模型/设置不支持该操作）、
                `service_unavailable`（服务临时过载）、
                `internal_error`（内部错误）、`expired`（任务已过期）
          x-apifox-orders:
            - message
            - code
          x-apifox-ignore-properties: []
      x-apifox-orders:
        - id
        - object
        - model
        - status
        - progress
        - created_at
        - completed_at
        - seconds
        - size
        - video_url
        - error
      x-apifox-ignore-properties: []
      x-apifox-folder: ''
    ErrorResponse:
      type: object
      properties:
        error:
          type: object
          properties:
            type:
              type: string
              examples:
                - invalid_request_error
            message:
              type: string
              examples:
                - model is required
          x-apifox-orders:
            - type
            - message
          x-apifox-ignore-properties: []
      x-apifox-orders:
        - error
      x-apifox-ignore-properties: []
      x-apifox-folder: ''
  securitySchemes:
    BearerAuth:
      type: bearer
      scheme: bearer
      bearerFormat: API Key
      description: '在请求头中传入 `Authorization: Bearer <你的API Key>`'
servers: []
security:
  - BearerAuth: []
    x-apifox:
      schemeGroups:
        - id: lvyU21G6mbzAHA12d62Iy
          schemeIds:
            - BearerAuth
      required: true
      use:
        id: lvyU21G6mbzAHA12d62Iy
      scopes:
        lvyU21G6mbzAHA12d62Iy:
          BearerAuth: []

```

# 视频生成（兼容别名，等价于 POST /v1/videos）

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /v1/video/generations:
    post:
      summary: 视频生成（兼容别名，等价于 POST /v1/videos）
      deprecated: false
      description: |
        与 `POST /v1/videos` 完全等价。部分中转程序（如 new-api）自身对外暴露的
        旧版任务提交路径使用的就是这个单数 `video` 的写法，这里一并支持。
        支持的参数与请求模式完全一致。
      operationId: createVideoGenerationAlias
      tags:
        - 视频模型
        - 视频模型
      parameters: []
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/VideoGenerationRequest'
      responses:
        '200':
          description: 任务已提交
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/VideoObject'
          headers: {}
          x-apifox-name: ''
        '400':
          description: 请求参数错误
          content:
            application/json:
              schema: &ref_0
                $ref: '#/components/schemas/ErrorResponse'
          headers: {}
          x-apifox-name: BadRequest
        '401':
          description: API Key 缺失或无效
          content:
            application/json:
              schema: *ref_0
          headers: {}
          x-apifox-name: Unauthorized
        '429':
          description: 请求过于频繁或额度不足，响应头可能包含 `Retry-After`
          content:
            application/json:
              schema: *ref_0
          headers: {}
          x-apifox-name: RateLimited
        '500':
          description: 服务端或上游错误
          content:
            application/json:
              schema: *ref_0
          headers: {}
          x-apifox-name: ServerError
      security:
        - BearerAuth: []
          x-apifox:
            schemeGroups:
              - id: lvyU21G6mbzAHA12d62Iy
                schemeIds:
                  - BearerAuth
            required: true
            use:
              id: lvyU21G6mbzAHA12d62Iy
            scopes:
              lvyU21G6mbzAHA12d62Iy:
                BearerAuth: []
      x-apifox-folder: 视频模型
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/7607380/apis/api-486090228-run
components:
  schemas:
    VideoGenerationRequest:
      type: object
      required:
        - model
      properties:
        model:
          type: string
          description: |
            视频模型 ID，见顶部支持模型列表（必填）。也接受 `sora-2`/
            `sora-2-pro`（自动映射为 `grok-imagine-video`/
            `grok-imagine-video-1.5`），方便直接对接以 OpenAI Sora 模型名
            请求的中转程序。若请求携带多张参考图（`reference_images`/多图
            `image`/`images`），无论指定哪个模型，都会被自动改用
            `grok-imagine-video` 转发。
          enum:
            - grok-imagine-video
            - grok-imagine-video-1.5
            - sora-2
            - sora-2-pro
          examples:
            - grok-imagine-video-1.5
        prompt:
          type: string
          description: |
            视频内容描述提示词。文生视频（T2V）和参考图生视频（R2V）模式下
            必填；图生视频（I2V，单图）模式下可选——不提供时模型仅根据图片
            内容生成视频。
        resolution:
          type: string
          enum:
            - 480p
            - 720p
            - 1080p
          default: 480p
          description: |
            视频分辨率（Grok 原生参数）。`1080p` 仅 `grok-imagine-video-1.5`
            的图生视频模式支持。
        duration:
          type: integer
          minimum: 1
          maximum: 15
          default: 8
          description: |
            视频时长（秒，Grok 原生参数），取值范围 1-15，默认 8 秒。使用
            参考图（`reference_images`/多图）时最大只允许 10 秒。同时支持
            数字（`8`）与字符串（`"8"`）两种写法。
        aspect_ratio:
          type: string
          enum:
            - '1:1'
            - '16:9'
            - '9:16'
            - '4:3'
            - '3:4'
            - '3:2'
            - '2:3'
          default: '16:9'
          description: |
            视频宽高比。图生视频（I2V）默认继承输入图片的宽高比，除非显式
            指定该参数覆盖；若同时指定该参数会拉伸图片以匹配目标比例。
        size:
          type: string
          description: |
            OpenAI Sora 风格的像素尺寸（如 `1280x720`），作为 `resolution`
            的等价别名，两者任选其一即可。
          examples:
            - 1280x720
        seconds:
          type: string
          description: OpenAI Sora 风格的时长（字符串），作为 `duration` 的等价别名，效果和取值范围完全相同。
          examples:
            - '8'
        image:
          description: |
            输入图片，决定图生视频（单图）或参考图生视频（多图）模式，与
            `reference_images`/`images` 三个字段等价（服务端会统一按数量归位
            到互斥的 `image`/`reference_images` 字段再转发）：
            - 提供单张图片（字符串或对象）→ 图生视频（I2V），该图作为起始帧
            - 提供多张图片（数组，最多 7 张）→ 参考图生视频（R2V），内容作为
              视觉参考、不锁定首帧，**仅 `grok-imagine-video` 支持**
            - 不提供 → 纯文生视频（T2V）

            单个元素支持字符串 URL/DataURL，或 `{"url": "..."}` /
            `{"image_url": "..."}` 对象；new-api 等中转程序常用的纯字符串数组
            （`["url1", "url2"]`）也会被自动识别并转换。
          oneOf:
            - type: string
              description: 图片 URL 或 data URL（单图，图生视频）
            - type: object
              description: 单图对象形式
              properties:
                url:
                  type: string
                  description: 图片的公网 URL 或 base64 data URL（JPEG/PNG/WebP），与 file_id 二选一
                image_url:
                  type: string
                  description: 兼容旧版键名，等价于 url
                file_id:
                  type: string
                  description: Files API 上传后得到的文件 ID
              x-apifox-orders:
                - url
                - image_url
                - file_id
              x-apifox-ignore-properties: []
            - type: array
              description: 多图数组（参考图生视频），数组元素可以是字符串或对象
              maxItems: 7
              items:
                oneOf:
                  - type: string
                  - type: object
                    properties:
                      url:
                        type: string
                      image_url:
                        type: string
                      file_id:
                        type: string
                    x-apifox-orders:
                      - url
                      - image_url
                      - file_id
                    x-apifox-ignore-properties: []
        images:
          description: |
            **推荐用于传多图**：与 `image`（多图写法）/`reference_images`
            等价的别名字段（new-api 等中转程序的多图字段通常就叫这个名字），
            数组形式，最多 7 张，效果与传入数组形式的 `image` 完全相同，
            会被服务端统一规整为 xAI 官方的 `reference_images` 格式转发。
          type: array
          maxItems: 7
          items:
            oneOf:
              - type: string
              - type: object
                properties:
                  url:
                    type: string
                  image_url:
                    type: string
                  file_id:
                    type: string
                x-apifox-orders:
                  - url
                  - image_url
                  - file_id
                x-apifox-ignore-properties: []
        reference_images:
          description: |
            xAI 官方参考图生视频（R2V）字段名，效果与传入数组形式的
            `image`/`images` 完全相同。xAI 官方要求数组元素固定为
            `{"url": "..."}` 对象；本服务额外兼容元素为纯字符串的写法并
            自动转换成对象格式。最多 7 张。
          type: array
          maxItems: 7
          items:
            type: object
            properties:
              url:
                type: string
              image_url:
                type: string
                description: 兼容旧版键名，等价于 url
            x-apifox-orders:
              - url
              - image_url
            x-apifox-ignore-properties: []
        input_reference:
          description: OpenAI Sora 风格的参考图字段，作为 `image` 的等价别名（单图/多图写法均兼容）。
          oneOf:
            - type: string
            - type: array
              items:
                type: string
      x-apifox-orders:
        - model
        - prompt
        - resolution
        - duration
        - aspect_ratio
        - size
        - seconds
        - image
        - images
        - reference_images
        - input_reference
      x-apifox-ignore-properties: []
      x-apifox-folder: ''
    VideoObject:
      type: object
      description: |
        OpenAI Sora 标准的视频对象。视频生成接口、状态查询接口统一返回该结构。
        `status` 为 `completed` 后额外携带 `video_url` 字段（本服务在标准
        Sora 字段基础上的扩展，方便直接拿到下载直链而无需再调用
        `GET /v1/videos/{id}/content`）。
      properties:
        id:
          type: string
          description: 视频生成任务 ID，用于后续状态查询与内容下载
        object:
          type: string
          examples:
            - video
        model:
          type: string
          description: 实际使用的模型；生成任务失败（status=failed）时该字段可能缺省
        status:
          type: string
          enum:
            - queued
            - in_progress
            - completed
            - failed
          description: |
            任务状态：`queued`（排队中，对应 xAI 原生 pending 且未开始处理）、
            `in_progress`（生成中）、`completed`（已完成）、`failed`（失败或已过期）
        progress:
          type: integer
          minimum: 0
          maximum: 100
          description: 生成进度百分比（0-100），完成后固定为 100，失败时可能缺省
        created_at:
          type: integer
          description: 任务创建时间（Unix 时间戳）
        completed_at:
          type: integer
          description: 任务完成时间（Unix 时间戳），仅 `completed` 状态返回
        seconds:
          type: string
          description: 视频实际时长（秒）
        size:
          type: string
          description: 视频尺寸（近似值，由分辨率档位换算，仅供展示参考）
        video_url:
          type: string
          description: 视频下载直链（xAI 侧的临时链接，有时效性，建议尽快下载或转存），仅 `completed` 状态返回
        error:
          type: object
          description: 生成失败后返回
          properties:
            message:
              type: string
              description: 错误信息
            code:
              type: string
              description: |
                错误代码，常见取值：`invalid_argument`（请求参数无效，如
                不支持的时长/图片格式/模式冲突/内容被审核拦截）、
                `permission_denied`（API Key 或团队无权限）、
                `failed_precondition`（当前模型/设置不支持该操作）、
                `service_unavailable`（服务临时过载）、
                `internal_error`（内部错误）、`expired`（任务已过期）
          x-apifox-orders:
            - message
            - code
          x-apifox-ignore-properties: []
      x-apifox-orders:
        - id
        - object
        - model
        - status
        - progress
        - created_at
        - completed_at
        - seconds
        - size
        - video_url
        - error
      x-apifox-ignore-properties: []
      x-apifox-folder: ''
    ErrorResponse:
      type: object
      properties:
        error:
          type: object
          properties:
            type:
              type: string
              examples:
                - invalid_request_error
            message:
              type: string
              examples:
                - model is required
          x-apifox-orders:
            - type
            - message
          x-apifox-ignore-properties: []
      x-apifox-orders:
        - error
      x-apifox-ignore-properties: []
      x-apifox-folder: ''
  securitySchemes:
    BearerAuth:
      type: bearer
      scheme: bearer
      bearerFormat: API Key
      description: '在请求头中传入 `Authorization: Bearer <你的API Key>`'
servers: []
security:
  - BearerAuth: []
    x-apifox:
      schemeGroups:
        - id: lvyU21G6mbzAHA12d62Iy
          schemeIds:
            - BearerAuth
      required: true
      use:
        id: lvyU21G6mbzAHA12d62Iy
      scopes:
        lvyU21G6mbzAHA12d62Iy:
          BearerAuth: []

```

# 查询视频生成状态/结果

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /v1/videos/{id}:
    get:
      summary: 查询视频生成状态/结果
      deprecated: false
      description: |
        使用生成接口返回的任务 `id` 轮询视频生成进度。响应体为 OpenAI Sora
        标准的 video 对象，`status` 取值为 `queued`/`in_progress`/`completed`/`failed`。

        当 `status` 为 `completed` 时，响应体会额外携带 `video_url` 字段，
        直接给出视频的临时下载直链（xAI 侧的直链有效期有限，请及时下载或
        转存）。也可以选择改用 `GET /v1/videos/{id}/content` 由服务端代理
        下载二进制内容。`GET /v1/video/generations/{id}` 为等价别名。
      operationId: getVideo
      tags:
        - 视频模型
        - 视频模型
      parameters:
        - name: id
          in: path
          description: 视频生成任务 ID（创建视频时返回的 `id`）
          required: true
          example: video-req-abc123
          schema:
            type: string
      responses:
        '200':
          description: 成功
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/VideoObject'
              examples:
                排队中:
                  summary: 排队中
                  value:
                    id: video-req-abc123
                    object: video
                    status: queued
                    progress: 0
                生成中:
                  summary: 生成中
                  value:
                    id: video-req-abc123
                    object: video
                    model: grok-imagine-video
                    status: in_progress
                    progress: 45
                生成完成:
                  summary: 生成完成
                  value:
                    id: video-req-abc123
                    object: video
                    model: grok-imagine-video
                    status: completed
                    progress: 100
                    completed_at: 1730000120
                    seconds: '8'
                    video_url: https://vidgen.x.ai/xxxxx/video.mp4
                生成失败:
                  summary: 生成失败
                  value:
                    id: video-req-abc123
                    object: video
                    status: failed
                    progress: 0
                    error:
                      message: 内容审核未通过
                      code: invalid_argument
          headers: {}
          x-apifox-name: ''
        '401':
          description: API Key 缺失或无效
          content:
            application/json:
              schema: &ref_0
                $ref: '#/components/schemas/ErrorResponse'
          headers: {}
          x-apifox-name: Unauthorized
        '404':
          description: 任务不存在或已过期
          content:
            application/json:
              schema: *ref_0
          headers: {}
          x-apifox-name: ''
        '500':
          description: 服务端或上游错误
          content:
            application/json:
              schema: *ref_0
          headers: {}
          x-apifox-name: ServerError
      security:
        - BearerAuth: []
          x-apifox:
            schemeGroups:
              - id: lvyU21G6mbzAHA12d62Iy
                schemeIds:
                  - BearerAuth
            required: true
            use:
              id: lvyU21G6mbzAHA12d62Iy
            scopes:
              lvyU21G6mbzAHA12d62Iy:
                BearerAuth: []
      x-apifox-folder: 视频模型
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/7607380/apis/api-486090229-run
components:
  schemas:
    VideoObject:
      type: object
      description: |
        OpenAI Sora 标准的视频对象。视频生成接口、状态查询接口统一返回该结构。
        `status` 为 `completed` 后额外携带 `video_url` 字段（本服务在标准
        Sora 字段基础上的扩展，方便直接拿到下载直链而无需再调用
        `GET /v1/videos/{id}/content`）。
      properties:
        id:
          type: string
          description: 视频生成任务 ID，用于后续状态查询与内容下载
        object:
          type: string
          examples:
            - video
        model:
          type: string
          description: 实际使用的模型；生成任务失败（status=failed）时该字段可能缺省
        status:
          type: string
          enum:
            - queued
            - in_progress
            - completed
            - failed
          description: |
            任务状态：`queued`（排队中，对应 xAI 原生 pending 且未开始处理）、
            `in_progress`（生成中）、`completed`（已完成）、`failed`（失败或已过期）
        progress:
          type: integer
          minimum: 0
          maximum: 100
          description: 生成进度百分比（0-100），完成后固定为 100，失败时可能缺省
        created_at:
          type: integer
          description: 任务创建时间（Unix 时间戳）
        completed_at:
          type: integer
          description: 任务完成时间（Unix 时间戳），仅 `completed` 状态返回
        seconds:
          type: string
          description: 视频实际时长（秒）
        size:
          type: string
          description: 视频尺寸（近似值，由分辨率档位换算，仅供展示参考）
        video_url:
          type: string
          description: 视频下载直链（xAI 侧的临时链接，有时效性，建议尽快下载或转存），仅 `completed` 状态返回
        error:
          type: object
          description: 生成失败后返回
          properties:
            message:
              type: string
              description: 错误信息
            code:
              type: string
              description: |
                错误代码，常见取值：`invalid_argument`（请求参数无效，如
                不支持的时长/图片格式/模式冲突/内容被审核拦截）、
                `permission_denied`（API Key 或团队无权限）、
                `failed_precondition`（当前模型/设置不支持该操作）、
                `service_unavailable`（服务临时过载）、
                `internal_error`（内部错误）、`expired`（任务已过期）
          x-apifox-orders:
            - message
            - code
          x-apifox-ignore-properties: []
      x-apifox-orders:
        - id
        - object
        - model
        - status
        - progress
        - created_at
        - completed_at
        - seconds
        - size
        - video_url
        - error
      x-apifox-ignore-properties: []
      x-apifox-folder: ''
    ErrorResponse:
      type: object
      properties:
        error:
          type: object
          properties:
            type:
              type: string
              examples:
                - invalid_request_error
            message:
              type: string
              examples:
                - model is required
          x-apifox-orders:
            - type
            - message
          x-apifox-ignore-properties: []
      x-apifox-orders:
        - error
      x-apifox-ignore-properties: []
      x-apifox-folder: ''
  securitySchemes:
    BearerAuth:
      type: bearer
      scheme: bearer
      bearerFormat: API Key
      description: '在请求头中传入 `Authorization: Bearer <你的API Key>`'
servers: []
security:
  - BearerAuth: []
    x-apifox:
      schemeGroups:
        - id: lvyU21G6mbzAHA12d62Iy
          schemeIds:
            - BearerAuth
      required: true
      use:
        id: lvyU21G6mbzAHA12d62Iy
      scopes:
        lvyU21G6mbzAHA12d62Iy:
          BearerAuth: []

```


# 查询视频生成状态/结果（兼容别名，等价于 GET /v1/videos/{id}）

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /v1/video/generations/{id}:
    get:
      summary: 查询视频生成状态/结果（兼容别名，等价于 GET /v1/videos/{id}）
      deprecated: false
      description: ''
      operationId: getVideoAlias
      tags:
        - 视频模型
        - 视频模型
      parameters:
        - name: id
          in: path
          description: ''
          required: true
          example: video-req-abc123
          schema:
            type: string
      responses:
        '200':
          description: 成功
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/VideoObject'
          headers: {}
          x-apifox-name: ''
        '401':
          description: API Key 缺失或无效
          content:
            application/json:
              schema: &ref_0
                $ref: '#/components/schemas/ErrorResponse'
          headers: {}
          x-apifox-name: Unauthorized
        '404':
          description: 任务不存在或已过期
          content:
            application/json:
              schema: *ref_0
          headers: {}
          x-apifox-name: ''
        '500':
          description: 服务端或上游错误
          content:
            application/json:
              schema: *ref_0
          headers: {}
          x-apifox-name: ServerError
      security:
        - BearerAuth: []
          x-apifox:
            schemeGroups:
              - id: lvyU21G6mbzAHA12d62Iy
                schemeIds:
                  - BearerAuth
            required: true
            use:
              id: lvyU21G6mbzAHA12d62Iy
            scopes:
              lvyU21G6mbzAHA12d62Iy:
                BearerAuth: []
      x-apifox-folder: 视频模型
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/7607380/apis/api-486090230-run
components:
  schemas:
    VideoObject:
      type: object
      description: |
        OpenAI Sora 标准的视频对象。视频生成接口、状态查询接口统一返回该结构。
        `status` 为 `completed` 后额外携带 `video_url` 字段（本服务在标准
        Sora 字段基础上的扩展，方便直接拿到下载直链而无需再调用
        `GET /v1/videos/{id}/content`）。
      properties:
        id:
          type: string
          description: 视频生成任务 ID，用于后续状态查询与内容下载
        object:
          type: string
          examples:
            - video
        model:
          type: string
          description: 实际使用的模型；生成任务失败（status=failed）时该字段可能缺省
        status:
          type: string
          enum:
            - queued
            - in_progress
            - completed
            - failed
          description: |
            任务状态：`queued`（排队中，对应 xAI 原生 pending 且未开始处理）、
            `in_progress`（生成中）、`completed`（已完成）、`failed`（失败或已过期）
        progress:
          type: integer
          minimum: 0
          maximum: 100
          description: 生成进度百分比（0-100），完成后固定为 100，失败时可能缺省
        created_at:
          type: integer
          description: 任务创建时间（Unix 时间戳）
        completed_at:
          type: integer
          description: 任务完成时间（Unix 时间戳），仅 `completed` 状态返回
        seconds:
          type: string
          description: 视频实际时长（秒）
        size:
          type: string
          description: 视频尺寸（近似值，由分辨率档位换算，仅供展示参考）
        video_url:
          type: string
          description: 视频下载直链（xAI 侧的临时链接，有时效性，建议尽快下载或转存），仅 `completed` 状态返回
        error:
          type: object
          description: 生成失败后返回
          properties:
            message:
              type: string
              description: 错误信息
            code:
              type: string
              description: |
                错误代码，常见取值：`invalid_argument`（请求参数无效，如
                不支持的时长/图片格式/模式冲突/内容被审核拦截）、
                `permission_denied`（API Key 或团队无权限）、
                `failed_precondition`（当前模型/设置不支持该操作）、
                `service_unavailable`（服务临时过载）、
                `internal_error`（内部错误）、`expired`（任务已过期）
          x-apifox-orders:
            - message
            - code
          x-apifox-ignore-properties: []
      x-apifox-orders:
        - id
        - object
        - model
        - status
        - progress
        - created_at
        - completed_at
        - seconds
        - size
        - video_url
        - error
      x-apifox-ignore-properties: []
      x-apifox-folder: ''
    ErrorResponse:
      type: object
      properties:
        error:
          type: object
          properties:
            type:
              type: string
              examples:
                - invalid_request_error
            message:
              type: string
              examples:
                - model is required
          x-apifox-orders:
            - type
            - message
          x-apifox-ignore-properties: []
      x-apifox-orders:
        - error
      x-apifox-ignore-properties: []
      x-apifox-folder: ''
  securitySchemes:
    BearerAuth:
      type: bearer
      scheme: bearer
      bearerFormat: API Key
      description: '在请求头中传入 `Authorization: Bearer <你的API Key>`'
servers: []
security:
  - BearerAuth: []
    x-apifox:
      schemeGroups:
        - id: lvyU21G6mbzAHA12d62Iy
          schemeIds:
            - BearerAuth
      required: true
      use:
        id: lvyU21G6mbzAHA12d62Iy
      scopes:
        lvyU21G6mbzAHA12d62Iy:
          BearerAuth: []

```


# 下载视频内容

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /v1/videos/{id}/content:
    get:
      summary: 下载视频内容
      deprecated: false
      description: |
        视频生成状态变为 `completed` 后，调用该接口以二进制流形式下载视频文件
        （`Content-Type: video/mp4`）。如果任务尚未完成会返回 400 错误。

        效果与直接使用状态查询响应里的 `video_url` 下载相同，区别是这里由
        服务端代为转发，不直接暴露 xAI 的临时直链和 Bearer token。
      operationId: getVideoContent
      tags:
        - 视频模型
        - 视频模型
      parameters:
        - name: id
          in: path
          description: 视频生成任务 ID
          required: true
          example: video-req-abc123
          schema:
            type: string
      responses:
        '200':
          description: 视频文件二进制内容
          content:
            video/mp4:
              schema:
                type: string
                format: binary
          headers: {}
          x-apifox-name: ''
        '400':
          description: 视频尚未生成完成
          content:
            application/json:
              schema: &ref_0
                $ref: '#/components/schemas/ErrorResponse'
          headers: {}
          x-apifox-name: ''
        '401':
          description: API Key 缺失或无效
          content:
            application/json:
              schema: *ref_0
          headers: {}
          x-apifox-name: Unauthorized
        '404':
          description: 任务不存在或已过期
          content:
            application/json:
              schema: *ref_0
          headers: {}
          x-apifox-name: ''
        '500':
          description: 服务端或上游错误
          content:
            application/json:
              schema: *ref_0
          headers: {}
          x-apifox-name: ServerError
      security:
        - BearerAuth: []
          x-apifox:
            schemeGroups:
              - id: lvyU21G6mbzAHA12d62Iy
                schemeIds:
                  - BearerAuth
            required: true
            use:
              id: lvyU21G6mbzAHA12d62Iy
            scopes:
              lvyU21G6mbzAHA12d62Iy:
                BearerAuth: []
      x-apifox-folder: 视频模型
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/7607380/apis/api-486090231-run
components:
  schemas:
    ErrorResponse:
      type: object
      properties:
        error:
          type: object
          properties:
            type:
              type: string
              examples:
                - invalid_request_error
            message:
              type: string
              examples:
                - model is required
          x-apifox-orders:
            - type
            - message
          x-apifox-ignore-properties: []
      x-apifox-orders:
        - error
      x-apifox-ignore-properties: []
      x-apifox-folder: ''
  securitySchemes:
    BearerAuth:
      type: bearer
      scheme: bearer
      bearerFormat: API Key
      description: '在请求头中传入 `Authorization: Bearer <你的API Key>`'
servers: []
security:
  - BearerAuth: []
    x-apifox:
      schemeGroups:
        - id: lvyU21G6mbzAHA12d62Iy
          schemeIds:
            - BearerAuth
      required: true
      use:
        id: lvyU21G6mbzAHA12d62Iy
      scopes:
        lvyU21G6mbzAHA12d62Iy:
          BearerAuth: []

```
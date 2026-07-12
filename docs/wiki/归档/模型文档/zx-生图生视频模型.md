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

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /videos/generations:
    post:
      summary: 视频生成
      deprecated: false
      description: |
        根据文本提示词生成视频（文生视频），或在提供输入图片时生成基于该图片的动态视频（图生视频）。
        该接口为异步任务：提交成功后返回任务信息，需通过
        `GET /v1/videos/{request_id}` 轮询生成状态与结果。
      operationId: createVideoGeneration
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
                  model: grok-imagine-video-1.5
                  prompt: 海浪拍打礁石，慢镜头，电影感
                  resolution: 720p
                  duration: 8
                summary: 文生视频
              图生视频:
                value:
                  model: grok-imagine-video-1.5
                  prompt: 让画面中的云朵缓慢飘动
                  image:
                    image_url: https://example.com/source.jpg
                  resolution: 720p
                  duration: 5
                summary: 图生视频
      responses:
        '200':
          description: 任务已提交
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/VideoGenerationResponse'
              example:
                id: video-req-abc123
                status: queued
                model: grok-imagine-video
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
              - id: XOuIzenrMxlUyZuIeLKNb
                schemeIds:
                  - BearerAuth
            required: true
            use:
              id: XOuIzenrMxlUyZuIeLKNb
            scopes:
              XOuIzenrMxlUyZuIeLKNb:
                BearerAuth: []
      x-apifox-folder: 视频模型
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/7607380/apis/api-485249874-run
components:
  schemas:
    VideoGenerationRequest:
      type: object
      required:
        - model
        - prompt
      properties:
        model:
          type: string
          enum:
            - grok-imagine-video
            - grok-imagine-video-1.5
          examples:
            - grok-imagine-video-1.5
        prompt:
          type: string
          description: 视频内容描述提示词
        resolution:
          type: string
          enum:
            - 480p
            - 720p
            - 1080p
          default: 480p
          description: 视频分辨率
        duration:
          type: integer
          minimum: 1
          maximum: 15
          default: 8
          description: 视频时长（秒）
        image:
          description: 输入参考图（可选）。提供该字段即为图生视频，不提供则为纯文生视频
          oneOf:
            - type: string
              description: 图片 URL 或 data URL
            - type: object
              properties:
                image_url:
                  type: string
              x-apifox-orders:
                - image_url
              x-apifox-ignore-properties: []
      x-apifox-orders:
        - model
        - prompt
        - resolution
        - duration
        - image
      x-apifox-ignore-properties: []
      x-apifox-folder: ''
    VideoGenerationResponse:
      type: object
      properties:
        id:
          type: string
          description: 视频生成任务 ID，用于后续状态查询
        status:
          type: string
          enum:
            - queued
            - processing
        model:
          type: string
      x-apifox-orders:
        - id
        - status
        - model
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

```# 查询视频生成状态/结果

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /videos/{request_id}:
    get:
      summary: 查询视频生成状态/结果
      deprecated: false
      description: |
        使用 `POST /v1/videos/generations` 返回的任务 ID 轮询视频生成进度，
        任务完成后返回可下载的视频地址。
      operationId: getVideoStatus
      tags:
        - 视频模型
        - 视频模型
      parameters:
        - name: request_id
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
                $ref: '#/components/schemas/VideoStatusResponse'
              examples:
                生成中:
                  summary: 生成中
                  value:
                    id: video-req-abc123
                    status: processing
                    progress: 45
                生成完成:
                  summary: 生成完成
                  value:
                    id: video-req-abc123
                    status: completed
                    video:
                      url: https://cdn.example.com/generated/video1.mp4
                      duration: 8
                      resolution: 720p
                生成失败:
                  summary: 生成失败
                  value:
                    id: video-req-abc123
                    status: failed
                    error:
                      message: 内容审核未通过
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
              - id: XOuIzenrMxlUyZuIeLKNb
                schemeIds:
                  - BearerAuth
            required: true
            use:
              id: XOuIzenrMxlUyZuIeLKNb
            scopes:
              XOuIzenrMxlUyZuIeLKNb:
                BearerAuth: []
      x-apifox-folder: 视频模型
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/7607380/apis/api-485249875-run
components:
  schemas:
    VideoStatusResponse:
      type: object
      properties:
        id:
          type: string
        status:
          type: string
          enum:
            - queued
            - processing
            - completed
            - failed
        progress:
          type: integer
          description: 生成进度百分比（0-100），仅 processing 阶段返回
        video:
          type: object
          description: 生成成功后返回
          properties:
            url:
              type: string
              description: 视频下载地址
            duration:
              type: integer
            resolution:
              type: string
          x-apifox-orders:
            - url
            - duration
            - resolution
          x-apifox-ignore-properties: []
        error:
          type: object
          description: 生成失败后返回
          properties:
            message:
              type: string
          x-apifox-orders:
            - message
          x-apifox-ignore-properties: []
      x-apifox-orders:
        - id
        - status
        - progress
        - video
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
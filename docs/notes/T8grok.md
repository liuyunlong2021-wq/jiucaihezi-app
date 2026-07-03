# Grok Image

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /v1/images/generations:
    post:
      summary: Grok Image
      deprecated: false
      description: ''
      tags:
        - 绘图模型/OpenAI Dall-e 格式
      parameters:
        - name: Authorization
          in: header
          description: ''
          required: false
          example: Bearer {{YOUR_API_KEY}}
          schema:
            type: string
            default: Bearer {{YOUR_API_KEY}}
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                model:
                  type: string
                  enum:
                    - grok-4.2-image
                    - grok-4.1-image
                  x-apifox-enum:
                    - value: grok-4.2-image
                      name: ''
                      description: ''
                    - value: grok-4.1-image
                      name: ''
                      description: ''
                prompt:
                  type: string
                aspect_ratio:
                  type: string
                  enum:
                    - '1:1'
                    - '2:3'
                    - '3:2'
                    - '9:16'
                    - '16:9'
                  x-apifox-enum:
                    - value: '1:1'
                      name: ''
                      description: ''
                    - value: '2:3'
                      name: ''
                      description: ''
                    - value: '3:2'
                      name: ''
                      description: ''
                    - value: '9:16'
                      name: ''
                      description: ''
                    - value: '16:9'
                      name: ''
                      description: ''
                  description: 如果加入参考图，按照参考图比例生成
                image:
                  type: array
                  items:
                    type: string
              required:
                - model
                - prompt
              x-apifox-orders:
                - model
                - prompt
                - aspect_ratio
                - image
            examples: {}
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                type: object
                properties: {}
                x-apifox-orders: []
          headers: {}
          x-apifox-name: 成功
      security: []
      x-apifox-folder: 绘图模型/OpenAI Dall-e 格式
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/3868318/apis/api-439071064-run
components:
  schemas: {}
  securitySchemes: {}
servers: []
security: []

```
# Grok创建视频

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /v2/videos/generations:
    post:
      summary: Grok创建视频
      deprecated: false
      description: |+
        此模型不直接对外开放，请联系管理员了解详情

      tags:
        - 视频模型/统一格式接口/Grok 视频
      parameters:
        - name: Authorization
          in: header
          description: ''
          required: false
          example: Bearer {{YOUR_API_KEY}}
          schema:
            type: string
            default: Bearer {{YOUR_API_KEY}}
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                prompt:
                  type: string
                model:
                  type: string
                  x-apifox-mock: grok-video-3
                  description: grok-video-3
                ratio:
                  type: string
                  enum:
                    - '2:3'
                    - '3:2'
                    - '1:1'
                    - '16:9'
                    - '9:16'
                  x-apifox-enum:
                    - value: '2:3'
                      name: ''
                      description: ''
                    - value: '3:2'
                      name: ''
                      description: ''
                    - value: '1:1'
                      name: ''
                      description: ''
                    - value: '16:9'
                      name: ''
                      description: ''
                    - value: '9:16'
                      name: ''
                      description: ''
                resolution:
                  type: string
                  enum:
                    - 720P
                    - 1080P
                  x-apifox-enum:
                    - value: 720P
                      name: ''
                      description: ''
                    - value: 1080P
                      name: ''
                      description: ''
                images:
                  type: array
                  items:
                    type: string
                  description: 支持一张参考图
                duration:
                  type: integer
                  enum:
                    - 6
                    - 10
                  x-apifox-enum:
                    - value: 6
                      name: ''
                      description: ''
                    - value: 10
                      name: ''
                      description: ''
              required:
                - prompt
                - model
              x-apifox-orders:
                - prompt
                - model
                - ratio
                - resolution
                - duration
                - images
            example:
              prompt: dance
              model: grok-video-3
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                type: object
                properties:
                  task_id:
                    type: string
                required:
                  - task_id
                x-apifox-orders:
                  - task_id
              example:
                task_id: grok:fa59842d-0252-455d-93ee-8f4b72bec9b1
          headers: {}
          x-apifox-name: 成功
      security: []
      x-apifox-folder: 视频模型/统一格式接口/Grok 视频
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/3868318/apis/api-375247345-run
components:
  schemas: {}
  securitySchemes: {}
servers: []
security: []

```
# Grok查询任务

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /v2/videos/generations/{task_id}:
    get:
      summary: Grok查询任务
      deprecated: false
      description: |-
        统一接口格式
        status 枚举：
        NOT_START ： 未开始
        IN_PROGRESS ： 正在执行
        SUCCESS ： 执行完成
        FAILURE ： 失败
      tags:
        - 视频模型/统一格式接口/Grok 视频
      parameters:
        - name: task_id
          in: path
          description: ''
          required: true
          schema:
            type: string
        - name: Authorization
          in: header
          description: ''
          required: false
          example: Bearer {{YOUR_API_KEY}}
          schema:
            type: string
            default: Bearer {{YOUR_API_KEY}}
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                type: object
                properties: {}
          headers: {}
          x-apifox-name: 成功
      security: []
      x-apifox-folder: 视频模型/统一格式接口/Grok 视频
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/3868318/apis/api-375249156-run
components:
  schemas: {}
  securitySchemes: {}
servers: []
security: []

```
# Grok视频-多图参考

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /v2/videos/generations:
    post:
      summary: Grok视频-多图参考
      deprecated: false
      description: |
        此模型不直接对外开放，请联系管理员了解详情
        最多支持 7张参考图，需要在 prompt 中描述 @img1 @img1... @img7 ，这是固定格式
        例如： @img1 一只猫拿着刀追 @img2
      tags:
        - 视频模型/统一格式接口/Grok 视频
      parameters:
        - name: Authorization
          in: header
          description: ''
          required: false
          example: Bearer {{YOUR_API_KEY}}
          schema:
            type: string
            default: Bearer {{YOUR_API_KEY}}
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                prompt:
                  type: string
                  x-apifox-mock: '@img1 一只猫拿着刀追 @img2'
                model:
                  type: string
                  x-apifox-mock: grok-video-3
                  description: grok-video-3
                ratio:
                  type: string
                  enum:
                    - '2:3'
                    - '3:2'
                    - '1:1'
                    - '16:9'
                    - '9:16'
                  x-apifox-enum:
                    - value: '2:3'
                      name: ''
                      description: ''
                    - value: '3:2'
                      name: ''
                      description: ''
                    - value: '1:1'
                      name: ''
                      description: ''
                    - value: '16:9'
                      name: ''
                      description: ''
                    - value: '9:16'
                      name: ''
                      description: ''
                resolution:
                  type: string
                  enum:
                    - 720P
                    - 1080P
                  x-apifox-enum:
                    - value: 720P
                      name: ''
                      description: ''
                    - value: 1080P
                      name: ''
                      description: ''
                images:
                  type: array
                  items:
                    type: string
                  description: 最多支持7张参考图
                duration:
                  type: integer
                  enum:
                    - 6
                    - 10
                  x-apifox-enum:
                    - value: 6
                      name: ''
                      description: ''
                    - value: 10
                      name: ''
                      description: ''
              required:
                - prompt
                - model
              x-apifox-orders:
                - prompt
                - model
                - ratio
                - resolution
                - duration
                - images
            example:
              prompt: dance
              model: grok-video-3
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                type: object
                properties:
                  task_id:
                    type: string
                required:
                  - task_id
                x-apifox-orders:
                  - task_id
              example:
                task_id: grok:fa59842d-0252-455d-93ee-8f4b72bec9b1
          headers: {}
          x-apifox-name: 成功
      security: []
      x-apifox-folder: 视频模型/统一格式接口/Grok 视频
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/3868318/apis/api-428187162-run
components:
  schemas: {}
  securitySchemes: {}
servers: []
security: []

```

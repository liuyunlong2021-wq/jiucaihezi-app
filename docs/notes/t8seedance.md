# 创建任务-官方格式

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /seedance/v3/contents/generations/tasks:
    post:
      summary: 创建任务-官方格式
      deprecated: false
      description: |-
        仅需将官方 API 地址，更换为我们的地址

        接口参数 详情请参考官方文档 https://www.volcengine.com/docs/82379/1520757
      tags:
        - 视频模型/Seedance(即梦视频
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
                content:
                  type: array
                  items:
                    type: object
                    properties:
                      type:
                        type: string
                      text:
                        type: string
                      image_url:
                        type: object
                        properties:
                          url:
                            type: string
                        required:
                          - url
                        x-apifox-orders:
                          - url
                    required:
                      - type
                    x-apifox-orders:
                      - type
                      - text
                      - image_url
              required:
                - model
                - content
              x-apifox-orders:
                - model
                - content
            example:
              model: doubao-seedance-1-0-pro-250528
              content:
                - type: text
                  text: >-
                    多个镜头。一名侦探进入一间光线昏暗的房间。他检查桌上的线索，手里拿起桌上的某个物品。镜头转向他正在思索。 --ratio
                    16:9
                - type: image_url
                  image_url:
                    url: >-
                      https://ark-project.tos-cn-beijing.volces.com/doc_image/seepro_i2v.png
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                type: object
                properties:
                  id:
                    type: string
                required:
                  - id
                x-apifox-orders:
                  - id
              example:
                id: cgt-20250629201507-n6k56
          headers: {}
          x-apifox-name: 成功
      security: []
      x-apifox-folder: 视频模型/Seedance(即梦视频
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/3868318/apis/api-343680647-run
components:
  schemas: {}
  securitySchemes: {}
servers: []
security: []

```



# Seedance文生视频

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
      summary: Seedance文生视频
      deprecated: false
      description: 统一接口格式
      tags:
        - 视频模型/统一格式接口/Seedance(即梦视频
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
                  description: >-
                    文本提示词（必填）：支持中英文。建议不超过500字。字数过多信息容易分散，模型可能因此忽略细节，只关注重点，造成视频缺失部分元素
                  x-apifox-mock: cat dance
                model:
                  type: string
                  description: |+
                    型号名称。示例：doubao-seedance-1-0-pro-250528

                  x-apifox-mock: doubao-seedance-1-0-pro-250528
                  enum:
                    - doubao-seedance-1-0-pro-250528
                    - doubao-seedance-1-0-lite-t2v-250428
                    - doubao-seedance-1-0-lite-i2v-250428
                  x-apifox-enum:
                    - value: doubao-seedance-1-0-pro-250528
                      name: 最新机型
                      description: 文生视频 图生视频-基于首帧
                    - value: doubao-seedance-1-0-lite-t2v-250428
                      name: ''
                      description: 文生视频
                    - value: doubao-seedance-1-0-lite-i2v-250428
                      name: ''
                      description: 图生视频-首帧 图生视频-首尾帧 图生视频-参考图
                duration:
                  type: integer
                  description: 生成视频的持续时间（以秒为单位）。该参数固定为 5，无法修改。模型始终生成一个 5 秒的视频。
                  x-apifox-mock: '5'
                  enum:
                    - 5
                    - 10
                  x-apifox-enum:
                    - value: 5
                      name: ''
                      description: ''
                    - value: 10
                      name: ''
                      description: ''
                  default: 5
                watermark:
                  type: boolean
                  description: |+
                    指定是否添加水印。水印位于视频的右下角，注明“由人工智能生成”。

                  default: false
                seed:
                  type: integer
                  description: |
                    一个随机数种子，用于控制模型生成的内容的随机性。该值必须在 [0， 2147483647] 的范围内。
                    如果不提供此参数，则算法会自动为种子生成一个随机数。如果希望生成的内容保持相对稳定，可以使用相同的种子值。
                resolution:
                  type: string
                  description: |
                    视频分辨率
                  enum:
                    - 480p
                    - 720p
                    - 1080p
                  x-apifox-enum:
                    - value: 480p
                      name: ''
                      description: ''
                    - value: 720p
                      name: ''
                      description: ''
                    - value: 1080p
                      name: ''
                      description: ''
                  default: 480p
                return_last_frame:
                  type: boolean
                  description: >-
                    true：返回生成视频的尾帧图像。尾帧图像的格式为
                    png，宽高像素值与生成的视频一致，无水印。您可通过查询视频生成任务接口获取视频的尾帧图像。

                    false：不返回生成视频的尾帧图像。
                  default: false
                ratio:
                  type: string
                  description: |-
                    生成视频的宽高比例
                    21:9
                    16:9 
                    4:3
                    1:1
                    3:4
                    9:16
                    9:21
                    keep_ratio：所生成视频的宽高比与所上传图片的宽高比保持一致。
                    adaptive：根据所上传图片的比例，自动选择最合适的宽高比。
                  default: '16:9'
                camerafixed:
                  type: boolean
                  description: |-
                    是否固定摄像头
                    true：固定摄像头。平台会在用户提示词中追加固定摄像头，实际效果不保证。
                    false：不固定摄像头。
                  default: false
                generate_audio:
                  type: boolean
              required:
                - prompt
                - model
              x-apifox-orders:
                - prompt
                - model
                - duration
                - resolution
                - ratio
                - watermark
                - seed
                - camerafixed
                - return_last_frame
                - generate_audio
            example:
              prompt: dance
              model: doubao-seedance-1-0-lite-t2v-250428
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
          headers: {}
          x-apifox-name: 成功
      security: []
      x-apifox-folder: 视频模型/统一格式接口/Seedance(即梦视频
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/3868318/apis/api-343444777-run
components:
  schemas: {}
  securitySchemes: {}
servers: []
security: []

```
# Seedance图生视频

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
      summary: Seedance图生视频
      deprecated: false
      description: 统一接口格式
      tags:
        - 视频模型/统一格式接口/Seedance(即梦视频
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
                  description: >-
                    The text prompt supports Chinese and English, with a maximum
                    length of 800 characters. Each Chinese character or letter
                    counts as one character. Content that exceeds this limit
                    will be truncated.

                    文本提示支持中英文，最大长度为800个字符。每个汉字或字母算作一个字符。超过此限制的内容将被截断。


                    Example: A kitten running in the moonlight.

                    示例：一只小猫在月光下奔跑。
                  x-apifox-mock: cat dance
                model:
                  type: string
                  description: |+
                    型号名称。示例：doubao-seedance-1-0-pro-250528

                  x-apifox-mock: doubao-seedance-1-0-pro-250528
                  enum:
                    - doubao-seedance-1-0-pro-250528
                    - doubao-seedance-1-0-lite-t2v-250428
                    - doubao-seedance-1-0-lite-i2v-250428
                  x-apifox-enum:
                    - value: doubao-seedance-1-0-pro-250528
                      name: 最新机型
                      description: 文生视频 图生视频-基于首帧
                    - value: doubao-seedance-1-0-lite-t2v-250428
                      name: ''
                      description: 文生视频
                    - value: doubao-seedance-1-0-lite-i2v-250428
                      name: ''
                      description: 图生视频-首帧 图生视频-首尾帧 图生视频-参考图
                duration:
                  type: integer
                  description: 生成视频的持续时间（以秒为单位）。该参数固定为 5，无法修改。模型始终生成一个 5 秒的视频。
                  x-apifox-mock: '5'
                  enum:
                    - 5
                    - 10
                  x-apifox-enum:
                    - value: 5
                      name: ''
                      description: ''
                    - value: 10
                      name: ''
                      description: ''
                watermark:
                  type: boolean
                  description: |+
                    指定是否添加水印。水印位于视频的右下角，注明“由人工智能生成”。

                seed:
                  type: integer
                  description: |
                    一个随机数种子，用于控制模型生成的内容的随机性。该值必须在 [0， 2147483647] 的范围内。
                    如果不提供此参数，则算法会自动为种子生成一个随机数。如果希望生成的内容保持相对稳定，可以使用相同的种子值。
                resolution:
                  type: string
                  description: |
                    视频分辨率
                  enum:
                    - 480p
                    - 720p
                    - 1080p
                  x-apifox-enum:
                    - value: 480p
                      name: ''
                      description: ''
                    - value: 720p
                      name: ''
                      description: ''
                    - value: 1080p
                      name: ''
                      description: ''
                return_last_frame:
                  type: boolean
                  description: >-
                    仅doubao-seedance-1-0-lite-i2v支持该参

                    true：返回生成视频的尾帧图像。尾帧图像的格式为
                    png，宽高像素值与生成的视频一致，无水印。您可通过查询视频生成任务接口获取视频的尾帧图像。

                    false：不返回生成视频的尾帧图像。
                ratio:
                  type: string
                  description: |-
                    生成视频的宽高比例
                    21:9
                    16:9 
                    4:3
                    1:1
                    3:4
                    9:16
                    9:21
                    keep_ratio：所生成视频的宽高比与所上传图片的宽高比保持一致。
                    adaptive：根据所上传图片的比例，自动选择最合适的宽高比。
                camerafixed:
                  type: boolean
                  description: |-
                    是否固定摄像头
                    true：固定摄像头。平台会在用户提示词中追加固定摄像头，实际效果不保证。
                    false：不固定摄像头。
                images:
                  type: array
                  items:
                    type: string
                  description: 参考图
                generate_audio:
                  type: boolean
              required:
                - prompt
                - model
                - images
              x-apifox-orders:
                - prompt
                - model
                - images
                - duration
                - resolution
                - ratio
                - watermark
                - seed
                - camerafixed
                - return_last_frame
                - generate_audio
            example:
              prompt: dance
              model: doubao-seedance-1-0-lite-t2v-250428
              images:
                - https://webstatic.aiproxy.vip/dist/demo.jpg
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
          headers: {}
          x-apifox-name: 成功
      security: []
      x-apifox-folder: 视频模型/统一格式接口/Seedance(即梦视频
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/3868318/apis/api-343464094-run
components:
  schemas: {}
  securitySchemes: {}
servers: []
security: []

```
# Seedance首尾帧图生视频

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
      summary: Seedance首尾帧图生视频
      deprecated: false
      description: 统一接口格式
      tags:
        - 视频模型/统一格式接口/Seedance(即梦视频
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
                  description: >-
                    The text prompt supports Chinese and English, with a maximum
                    length of 800 characters. Each Chinese character or letter
                    counts as one character. Content that exceeds this limit
                    will be truncated.

                    文本提示支持中英文，最大长度为800个字符。每个汉字或字母算作一个字符。超过此限制的内容将被截断。


                    Example: A kitten running in the moonlight.

                    示例：一只小猫在月光下奔跑。
                  x-apifox-mock: cat dance
                model:
                  type: string
                  description: |+
                    型号名称。示例：doubao-seedance-1-0-pro-250528

                  x-apifox-mock: doubao-seedance-1-0-lite-i2v-250428
                  enum:
                    - doubao-seedance-1-0-lite-i2v-250428
                  x-apifox-enum:
                    - value: doubao-seedance-1-0-lite-i2v-250428
                      name: ''
                      description: 图生视频-首帧 图生视频-首尾帧 图生视频-参考图
                duration:
                  type: integer
                  description: 生成视频的持续时间（以秒为单位）。该参数固定为 5，无法修改。模型始终生成一个 5 秒的视频。
                  x-apifox-mock: '5'
                  enum:
                    - 5
                    - 10
                  x-apifox-enum:
                    - value: 5
                      name: ''
                      description: ''
                    - value: 10
                      name: ''
                      description: ''
                watermark:
                  type: boolean
                  description: |+
                    指定是否添加水印。水印位于视频的右下角，注明“由人工智能生成”。

                seed:
                  type: integer
                  description: |
                    一个随机数种子，用于控制模型生成的内容的随机性。该值必须在 [0， 2147483647] 的范围内。
                    如果不提供此参数，则算法会自动为种子生成一个随机数。如果希望生成的内容保持相对稳定，可以使用相同的种子值。
                resolution:
                  type: string
                  description: |
                    视频分辨率
                  enum:
                    - 480p
                    - 720p
                    - 1080p
                  x-apifox-enum:
                    - value: 480p
                      name: ''
                      description: ''
                    - value: 720p
                      name: ''
                      description: ''
                    - value: 1080p
                      name: ''
                      description: ''
                return_last_frame:
                  type: boolean
                  description: >-
                    仅doubao-seedance-1-0-lite-i2v支持该参

                    true：返回生成视频的尾帧图像。尾帧图像的格式为
                    png，宽高像素值与生成的视频一致，无水印。您可通过查询视频生成任务接口获取视频的尾帧图像。

                    false：不返回生成视频的尾帧图像。
                ratio:
                  type: string
                  description: |-
                    生成视频的宽高比例
                    21:9
                    16:9 
                    4:3
                    1:1
                    3:4
                    9:16
                    9:21
                    keep_ratio：所生成视频的宽高比与所上传图片的宽高比保持一致。
                    adaptive：根据所上传图片的比例，自动选择最合适的宽高比。
                camerafixed:
                  type: boolean
                  description: |-
                    是否固定摄像头
                    true：固定摄像头。平台会在用户提示词中追加固定摄像头，实际效果不保证。
                    false：不固定摄像头。
                images:
                  type: array
                  items:
                    type: string
                  description: 参考图
                generate_audio:
                  type: boolean
              required:
                - prompt
                - model
                - images
              x-apifox-orders:
                - prompt
                - model
                - images
                - duration
                - resolution
                - ratio
                - watermark
                - seed
                - camerafixed
                - return_last_frame
                - generate_audio
            example:
              prompt: dance
              model: doubao-seedance-1-0-lite-i2v-250428
              images:
                - https://webstatic.aiproxy.vip/dist/demo.jpg
                - https://webstatic.aiproxy.vip/dist/demo.jpg
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
          headers: {}
          x-apifox-name: 成功
      security: []
      x-apifox-folder: 视频模型/统一格式接口/Seedance(即梦视频
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/3868318/apis/api-343464933-run
components:
  schemas: {}
  securitySchemes: {}
servers: []
security: []

```
# Seedance查询任务

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
      summary: Seedance查询任务
      deprecated: false
      description: |-
        统一接口格式
        status 枚举：
        NOT_START ： 未开始
        IN_PROGRESS ： 正在执行
        SUCCESS ： 执行完成
        FAILURE ： 失败
      tags:
        - 视频模型/统一格式接口/Seedance(即梦视频
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
              example:
                task_id: cgt-20250831141439-sqmgf
                platform: bytedance
                action: seedance-video
                status: SUCCESS
                fail_reason: ''
                submit_time: 1756620886
                start_time: 1756620932
                finish_time: 1756621169
                progress: 100%
                data:
                  output: >-
                    <volcengine_presigned_video_url_removed>
                  duration: '5'
                  framespersecond: '24'
                  last_frame_url: ''
                  ratio: '16:9'
                  resolution: 480p
                  seed: '55335'
                  usage:
                    completion_tokens: 49005
                    total_tokens: 49005
                search_item: ''
          headers: {}
          x-apifox-name: 成功
      security: []
      x-apifox-folder: 视频模型/统一格式接口/Seedance(即梦视频
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/3868318/apis/api-343444780-run
components:
  schemas: {}
  securitySchemes: {}
servers: []
security: []

```

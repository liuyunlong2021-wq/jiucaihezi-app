# gpt-image-2 Edits

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /v1/images/edits:
    post:
      summary: gpt-image-2 Edits
      deprecated: false
      description: "逆向分组仅支持 model、prompt、size、image 参数\n\n官转组 \n兼容edits 接口所有参数透传\nhttps://developers.openai.com/api/reference/resources/images/methods/edit\n\nsize 介绍：\nhttps://developers.openai.com/api/docs/guides/image-generation#calculating-costs\nSize and quality options  尺寸和质量选项\n\ngpt-image-2 accepts any resolution in the size parameter when it satisfies the constraints below. Square images are typically fastest to generate.\ngpt-image-2 接受任何分辨率作为 size 参数，只要满足以下约束条件即可。通常情况下，正方形图像的生成速度最快。\n\nPopular sizes  常用尺码\t\n1024x1024 (square)\n1024x1024 （正方形）\n\n1536x1024 (landscape)\n1536x1024 （横向）\n\n1024x1536 (portrait)\n1024x1536 （竖屏）\n\n2048x2048 (2K square)\n2048x2048 （2K 正方形）\n\n2048x1152 (2K landscape)\n2048x1152 （2K 横向）\n\n3840x2160 (4K landscape)\n3840x2160 （4K 横向）\n\n2160x3840 (4K portrait)\n2160x3840 （4K 竖屏）\n\nauto (default)\nauto （默认）\n\nSize constraints  尺寸限制\t\nMaximum edge length must be less than or equal to 3840px\n最大边长必须小于或等于 3840px\n\nBoth edges must be multiples of 16px\n两个边长都必须是 16px 的倍数。\n\nLong edge to short edge ratio must not exceed 3:1\n长边与短边之比不得超过 3:1\n\nTotal pixels must be at least 655,360 and no more than 8,294,400\n总像素数必须至少为 655,360 ，且不得超过 8,294,400\n\nQuality options  优质选项\t\nlow  低的\nmedium  中间\nhigh  高的\nauto (default)\nauto （默认）\n"
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
          multipart/form-data:
            schema:
              type: object
              properties:
                image:
                  description: 支持多图
                  example: E:\\Desktop\\gpt\\icon_samll2.png
                  type: string
                  format: binary
                prompt:
                  example: 带上眼镜
                  type: string
                model:
                  description: gpt-image-2
                  example: gpt-image-2
                  type: string
                size:
                  type: string
                  enum:
                    - 1024x1024
                    - 1536x1024
                    - 1024x1536
                  x-apifox-enum:
                    - value: 1024x1024
                      name: ''
                      description: ''
                    - value: 1536x1024
                      name: ''
                      description: ''
                    - value: 1024x1536
                      name: ''
                      description: ''
                  example: ''
                response_format:
                  description: '"url" or "b64_json". 默认 b64_json'
                  example: ''
                  type: string
              required:
                - image
                - prompt
                - model
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
              example:
                created: 1713833628
                data:
                  - b64_json: ...
                usage:
                  total_tokens: 100
                  input_tokens: 50
                  output_tokens: 50
                  input_tokens_details:
                    text_tokens: 10
                    image_tokens: 40
          headers: {}
          x-apifox-name: 成功
      security: []
      x-apifox-folder: 绘图模型/OpenAI Dall-e 格式
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/3868318/apis/api-447258891-run
components:
  schemas: {}
  securitySchemes: {}
servers: []
security: []

```

# gpt-image-2 Generations

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
      summary: gpt-image-2 Generations
      deprecated: false
      description: "逆向分组仅支持 model、prompt、size、image 参数\n\n官转组 \n兼容edits 接口所有参数透传\nhttps://developers.openai.com/api/reference/resources/images/methods/edit\n\nsize 介绍：\nhttps://developers.openai.com/api/docs/guides/image-generation#calculating-costs\nSize and quality options  尺寸和质量选项\n\ngpt-image-2 accepts any resolution in the size parameter when it satisfies the constraints below. Square images are typically fastest to generate.\ngpt-image-2 接受任何分辨率作为 size 参数，只要满足以下约束条件即可。通常情况下，正方形图像的生成速度最快。\n\nPopular sizes  常用尺码\t\n1024x1024 (square)\n1024x1024 （正方形）\n\n1536x1024 (landscape)\n1536x1024 （横向）\n\n1024x1536 (portrait)\n1024x1536 （竖屏）\n\n2048x2048 (2K square)\n2048x2048 （2K 正方形）\n\n2048x1152 (2K landscape)\n2048x1152 （2K 横向）\n\n3840x2160 (4K landscape)\n3840x2160 （4K 横向）\n\n2160x3840 (4K portrait)\n2160x3840 （4K 竖屏）\n\nauto (default)\nauto （默认）\n\nSize constraints  尺寸限制\t\nMaximum edge length must be less than or equal to 3840px\n最大边长必须小于或等于 3840px\n\nBoth edges must be multiples of 16px\n两个边长都必须是 16px 的倍数。\n\nLong edge to short edge ratio must not exceed 3:1\n长边与短边之比不得超过 3:1\n\nTotal pixels must be at least 655,360 and no more than 8,294,400\n总像素数必须至少为 655,360 ，且不得超过 8,294,400\n\nQuality options  优质选项\t\nlow  低的\nmedium  中间\nhigh  高的\nauto (default)\nauto （默认）\n"
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
                  x-apifox-mock: gpt-image-2
                prompt:
                  type: string
                size:
                  type: string
                  description: 建议使用 size，与官方一致
                image:
                  type: array
                  items:
                    type: string
                response_format:
                  type: string
                  description: '"url" or "b64_json". 默认 b64_json'
              required:
                - model
                - prompt
              x-apifox-orders:
                - model
                - prompt
                - size
                - response_format
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
      x-run-in-apifox: https://app.apifox.com/web/project/3868318/apis/api-447261009-run
components:
  schemas: {}
  securitySchemes: {}
servers: []
security: []

```

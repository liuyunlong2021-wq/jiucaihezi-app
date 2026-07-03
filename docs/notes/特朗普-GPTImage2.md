import { DocCodeBlock, DocsCallout } from "@/views/docs/DocsPrimitives";
import { buildDocsAbsoluteUrl } from "@/views/docs/DocsApiReferenceSnippets";

export const metadata = {
  title: "Async image tasks",
  description:
    "Create long-running image-generation jobs on WorldRouter, poll their status, and receive stored image URLs across gpt-image-2 and Gemini models.",
};

# Async image tasks

Use async image tasks when the client should create a job, poll status, and
receive stored image URLs after completion. This task surface works across all
async image models (`gpt-image-2` and Gemini) and bypasses the edge
timeouts that cap the synchronous endpoints for long-running generations.

## Create a task

<DocCodeBlock
  language="bash"
  label="Endpoint"
  code={`POST ${buildDocsAbsoluteUrl("/v1/images/generation_tasks")}`}
/>

## Request body

| Field             | Required | Description                                                                                                             |
| ----------------- | -------- | ----------------------------------------------------------------------------------------------------------------------- |
| `model`           | yes      | Image model ID. See [Supported async models](#supported-async-models).                                                  |
| `prompt`          | yes      | Natural-language description of the image.                                                                              |
| `n`               | no       | Number of images to generate. The server caps this value.                                                               |
| `size`            | no       | OpenAI-style size such as `1024x1024`. Used by `gpt-image-2`; Gemini ignores it.                                        |
| `quality`         | no       | Quality tier, such as `low`, `medium`, `high`, or provider-specific values.                                             |
| `output_format`   | no       | `png`, `jpeg`, `jpg`, or `webp`. Used by `gpt-image-2`; Gemini storage follows the returned image type when detectable. |
| `response_format` | no       | If provided, must be `url`. Async tasks always return stored URLs.                                                      |
| `user`            | no       | OpenAI end-user identifier, forwarded for abuse monitoring and end-user budgets.                                        |

## Parameter support by model

The request accepts one flat parameter set, but each model honors only a subset.
**Unsupported parameters are accepted and silently ignored — they never error.**

| Parameter                                                            | gpt-image-2 |      Gemini      |
| -------------------------------------------------------------------- | :---------: | :--------------: |
| `model`, `prompt`                                                    |  required   |     required     |
| `user`                                                               |      ✓      |        ✓         |
| `n`                                                                  |      ✓      |  model-decided   |
| `size`                                                               |      ✓      |        ✗         |
| `quality`, `style`, `background`, `moderation`, `output_compression` |      ✓      |        ✗         |
| `output_format`                                                      |      ✓      | storage fallback |

Legend: ✓ applied · ✗ accepted but ignored · `model-decided` the model controls the count · `storage fallback` is used only when the returned image type cannot be detected.

<DocsCallout variant="warning">
  Async Gemini tasks ignore `size` — the model decides the output. To control
  Gemini output resolution, use the sync `generateContent` route's
  `generationConfig.imageConfig` instead; that key does **not** apply to async
  tasks.
</DocsCallout>

## Supported async models

- `gpt-image-2`
- `gemini-2.5-flash-image`
- `gemini-3-pro-image-preview`
- `gemini-3.1-flash-image-preview`

Deployments may narrow or extend this list.

## Create example

<DocCodeBlock
  language="bash"
  label="curl"
  code={`curl -X POST "${buildDocsAbsoluteUrl("/v1/images/generation_tasks")}" \\
  -H "Authorization: Bearer your_api_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-image-2",
    "prompt": "A small clean five-point star icon, centered on a white background.",
    "n": 1,
    "size": "1024x1024",
    "quality": "low",
    "output_format": "png",
    "response_format": "url"
  }'`}
/>

## Create response

<DocCodeBlock
  language="json"
  label="200 OK"
  code={`{
  "id": "imgtask_...",
  "object": "image.generation_task",
  "created": 1780501937,
  "task_id": "imgtask_...",
  "status": "queued",
  "model": "gpt-image-2",
  "created_at": "2026-06-11T12:00:00+00:00"
}`}
/>

## Poll a task

Poll the created task with `GET /v1/images/generation_tasks/{task_id}`.

<DocCodeBlock
  language="bash"
  label="Endpoint"
  code={`GET ${buildDocsAbsoluteUrl("/v1/images/generation_tasks")}/{task_id}`}
/>

<DocCodeBlock
  language="bash"
  label="curl"
  code={`curl "${buildDocsAbsoluteUrl("/v1/images/generation_tasks/imgtask_...")}" \\
  -H "Authorization: Bearer your_api_key"`}
/>

`status` is one of `queued`, `in_progress`, `completed`, or `failed`. A
completed task returns OpenAI-style `data` items with stored image URLs:

<DocCodeBlock
  language="json"
  label="completed"
  code={`{
  "id": "imgtask_...",
  "object": "image.generation_task",
  "created": 1780501937,
  "task_id": "imgtask_...",
  "status": "completed",
  "model": "gpt-image-2",
  "created_at": "2026-06-11T12:00:00+00:00",
  "data": [
    {
      "url": "https://..."
    }
  ],
  "usage": {
    "input_tokens": 20,
    "output_tokens": 397,
    "total_tokens": 417
  }
}`}
/>

Failed tasks return an `error` object. Listing all image tasks is not supported.
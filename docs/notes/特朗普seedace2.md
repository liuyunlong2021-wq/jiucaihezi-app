import {
  DocCodeBlock,
  DocsCallout,
  StepList,
} from "@/views/docs/DocsPrimitives";
import {
  buildDocsAbsoluteUrl,
  DocsApiOrigin,
} from "@/views/docs/DocsApiReferenceSnippets";

export const metadata = {
  title: "Seedance video",
  description:
    "Create Seedance videos on WorldRouter through the native async task routes.",
};

# Seedance video

Seedance on WorldRouter does **not** use LiteLLM's `/v1/videos` surface. The public API is WorldRouter's native async task route:

- `POST /api/v3/contents/generations/tasks`
- `GET /api/v3/contents/generations/tasks/{task_id}`

Asset helpers are exposed separately:

- `POST /v1/asset-groups`
- `POST /v1/asset-groups/{asset_group_id}/assets`

<DocsCallout variant="tip">
  Start from [Quickstart](/docs/quickstart) if you still need an API key or the
  base URL. Use the same origin shown there: <DocsApiOrigin />. Seedance task
  routes append `/api/v3/...`; do not add them after the OpenAI-compatible `/v1`
  base URL.
</DocsCallout>

## Request models

These are the request model names you should send in the `model` field:

| Model               | Best for                         |
| ------------------- | -------------------------------- |
| `seedance-2.0`      | Standard text-to-video.          |
| `seedance-2.0-fast` | Faster text-to-video iterations. |

Important behavior:

- If your request includes only text, WorldRouter keeps the model as-is.
- If your request includes an existing `asset://...` image reference, WorldRouter automatically rewrites the upstream execution variant to the asset model.
- You usually still send `seedance-2.0` or `seedance-2.0-fast` in the public request, even when using uploaded assets.
- Direct public requests with `model: "seedance-2.0-asset"` are rejected.

## Core flow

The asset upload step depends on what kind of reference you pass:

- **Text-only or with a video reference**: skip the asset step. Send the request directly.
- **With an image reference (required)**: upload the image through the asset helpers first; public image URLs are rejected.

<StepList
  steps={[
    "If you need an image reference, create an asset group and upload the image through the asset helpers (required for image references; skip this for text-only and video-reference flows).",
    "Create a Seedance task with `POST /api/v3/contents/generations/tasks`.",
    "Poll `GET /api/v3/contents/generations/tasks/{task_id}` until the job reaches a terminal state.",
    "Read `content.video_url` from the task response and download the generated video from that URL.",
  ]}
/>

## Text-to-video

This is the same public route your test script uses:

<DocCodeBlock
  label="curl"
  language="bash"
  code={`curl -X POST "${buildDocsAbsoluteUrl("/api/v3/contents/generations/tasks")}" \\
  -H "Authorization: Bearer your_api_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "seedance-2.0",
    "content": [
      {
        "type": "text",
        "text": "A cinematic video of a city street at sunset."
      }
    ],
    "resolution": "720p",
    "duration": 5
  }'`}
/>

Typical create response:

<DocCodeBlock
  label="200 OK"
  language="json"
  code={`{
  "id": "task-123",
  "requestId": "req-123"
}`}
/>

The create response only returns the task `id` and `requestId`. Poll `GET /api/v3/contents/generations/tasks/{task_id}` to read `status` and the rest of the task metadata.

## Poll task status

Poll the task ID until the status becomes `succeeded`, `failed`, `cancelled`, or `expired`:

<DocCodeBlock
  label="curl"
  language="bash"
  code={`curl "${buildDocsAbsoluteUrl("/api/v3/contents/generations/tasks/task-123")}" \\
  -H "Authorization: Bearer your_api_key"`}
/>

Typical status response:

<DocCodeBlock
  label="200 OK"
  language="json"
  code={`{
  "id": "task-123",
  "model": "seedance-2.0",
  "status": "succeeded",
  "content": {
    "video_url": "https://media.example.com/seedance/output.mp4"
  },
  "resolution": "720p",
  "duration": 5,
  "usage": {
    "output_tokens": 7522
  }
}`}
/>

WorldRouter normalizes upstream task states into:

- `queued`
- `running`
- `succeeded`
- `failed`
- `cancelled`
- `expired`

## Video-to-video

Seedance also accepts a reference video directly on the same public route. Video references do **not** require the asset helper flow.

<DocCodeBlock
  label="JSON body"
  language="json"
  code={`{
  "model": "seedance-2.0",
  "content": [
    {
      "type": "text",
      "text": "Keep the motion rhythm of the input video and restyle it into a cinematic tea scene."
    },
    {
      "type": "video_url",
      "role": "reference_video",
      "video_url": {
        "url": "https://example.com/input.mp4"
      }
    }
  ],
  "resolution": "720p",
  "duration": 5
}`}
/>

## Asset flow for image references

Image references are stricter. Public image URLs are rejected for Seedance generation. If you want a reference image, first upload it through the asset helper routes and then use the returned `asset://...` URL in your generation payload.

### 1. Create an asset group

<DocCodeBlock
  label="curl"
  language="bash"
  code={`curl -X POST "${buildDocsAbsoluteUrl("/v1/asset-groups")}" \\
  -H "Authorization: Bearer your_api_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "seedance-demo-group",
    "description": "reference assets for a Seedance run"
  }'`}
/>

Response:

<DocCodeBlock
  label="200 OK"
  language="json"
  code={`{
  "id": "group-1",
  "name": "seedance-demo-group",
  "description": "reference assets for a Seedance run",
  "requestId": "req-456"
}`}
/>

### 2. Upload the reference image into that group

<DocCodeBlock
  label="curl"
  language="bash"
  code={`curl -X POST "${buildDocsAbsoluteUrl("/v1/asset-groups/group-1/assets")}" \\
  -H "Authorization: Bearer your_api_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "reference-image",
    "description": "main character reference",
    "type": "image",
    "url": "https://example.com/reference.png"
  }'`}
/>

Response:

<DocCodeBlock
  label="200 OK"
  language="json"
  code={`{
  "id": "asset-1",
  "asset_group_id": "group-1",
  "name": "reference-image",
  "description": "main character reference",
  "type": "image",
  "url": "asset://asset-1",
  "source_url": "https://example.com/reference.png",
  "requestId": "req-789"
}`}
/>

### 3. Use `asset://...` in the generation payload

Keep the public request model as `seedance-2.0` or `seedance-2.0-fast`:

<DocCodeBlock
  label="JSON body"
  language="json"
  code={`{
  "model": "seedance-2.0",
  "asset_group_id": "group-1",
  "content": [
    {
      "type": "text",
      "text": "The reference character walks down a sunlit city street with a cinematic look."
    },
    {
      "type": "image_url",
      "role": "reference_image",
      "image_url": {
        "url": "asset://asset-1"
      }
    }
  ],
  "resolution": "720p",
  "duration": 5
}`}
/>

<DocsCallout variant="warning">
  If you send a public image URL like `https://.../ref.png` directly inside the
  Seedance `content` array, WorldRouter returns `400 invalid_request` with the
  message telling you to upload assets first.
</DocsCallout>

## Notes and limits

- Seedance requires a team-scoped key with enough available credits. Low balance returns `402 seedance_balance_too_low`.
- Pending Seedance jobs per user are capped. Too many running tasks return `429 seedance_too_many_pending_tasks`.
- Task reads are owner-scoped. You can only poll tasks created by the same authorized owner context.
- Asset groups and uploaded assets are also owner-scoped.
- The public task status endpoint returns metadata and `content.video_url`; there is no separate public `/v1/videos/{id}/content` download route for Seedance.

## Troubleshooting

| Symptom                                          | Likely cause                                                     | What to do                                                                              |
| ------------------------------------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `400 unsupported_model`                          | You sent the wrong model or hit the wrong endpoint               | Use `seedance-2.0` or `seedance-2.0-fast` on `POST /api/v3/contents/generations/tasks`. |
| `400 invalid_request` with "upload assets first" | You passed a public image URL in `content`                       | Create an asset group, upload the image, then use the returned `asset://...` URL.       |
| `402 seedance_balance_too_low`                   | The scoped team does not have enough available credits           | Recharge on [Credits](/dashboard/credits) and retry.                                    |
| `403 media_resource_access_denied`               | The task, asset group, or asset belongs to another owner context | Reuse the same account/team/API key that created the resource.                          |
| `429 seedance_too_many_pending_tasks`            | Too many of your Seedance tasks are still running                | Wait for active tasks to finish before creating more.                                   |

## See also

- [Quickstart](/docs/quickstart): API key and base URL setup.
- [Models](/models): current model catalog and pricing.
- [API reference](/docs/api): chat-completions docs for text models.



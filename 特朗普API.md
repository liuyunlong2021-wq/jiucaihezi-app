import { DocCodeBlock, DocsCallout } from "@/views/docs/DocsPrimitives";
import {
  DocsApiReferenceSnippets,
  DocsChatEndpointBlock,
  DocsStreamingSnippets,
} from "@/views/docs/DocsApiReferenceSnippets";
import { DocsErrorCodesTable } from "@/views/docs/DocsErrorCodesTable";

export const metadata = {
  title: "API reference",
  description:
    "Call the WorldRouter OpenAI-compatible /chat/completions endpoint from any SDK or HTTP client.",
};

# API reference

WorldRouter exposes an OpenAI-compatible `/chat/completions` endpoint. Any SDK or HTTP client that accepts a custom base URL can call it with no code changes.

<DocsCallout variant="tip">
  New to WorldRouter? Run through the [Quickstart](/docs/quickstart) first for
  an API key, the base URL, and a connection test. This page assumes you already
  have both.
</DocsCallout>

## Endpoint

<DocsChatEndpointBlock />

## Authentication

Pass your API key as a Bearer token in the `Authorization` header:

<DocCodeBlock language="bash" code={`Authorization: Bearer your_api_key`} />

Keys are scoped to your account. Create and rotate them in the [API Keys dashboard](/dashboard/api-keys).

## Request body

| Field                   | Required | Description                                                                                                                                                                     |
| ----------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model`                 | yes      | Model ID to route to, e.g. `gpt-5.4`. See the [Models](/models) catalog.                                                                                                        |
| `messages`              | yes      | Array of chat messages. Must contain at least one entry.                                                                                                                        |
| `temperature`           | no       | Sampling temperature. Defaults depend on the model.                                                                                                                             |
| `max_tokens`            | no       | Upper bound on output tokens. On reasoning models the budget can be fully consumed by hidden reasoning tokens, which returns an empty `content` with `finish_reason: "length"`. |
| `stream`                | no       | When `true`, the response is a Server-Sent Events stream of deltas.                                                                                                             |
| `tools` / `tool_choice` | no       | Function calling, same schema as OpenAI.                                                                                                                                        |

Any other field in the OpenAI `/chat/completions` schema (`top_p`, `stop`, `seed`, `response_format`, …) is accepted unchanged.

## Response

A non-streaming response matches the OpenAI shape:

<DocCodeBlock
  language="json"
  code={`{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "created": 1738960610,
  "model": "gpt-5.4",
  "choices": [
    {
      "index": 0,
      "message": { "role": "assistant", "content": "Hello! How can I help you today?" },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 13,
    "completion_tokens": 9,
    "total_tokens": 22
  }
}`}
/>

## Examples

<DocsApiReferenceSnippets />

## Streaming

Set `stream: true` in the request body. The response becomes a Server-Sent Events stream. Each chunk follows the OpenAI `chat.completion.chunk` shape, and the stream terminates with a `data: [DONE]` line:

<DocsStreamingSnippets />

## Error codes

<DocsErrorCodesTable />

## See also

- [OpenAI Chat Completions reference](https://platform.openai.com/docs/api-reference/chat/create): WorldRouter mirrors this schema.
- [Seedance video guide](/docs/seedance): async video generation with `/api/v3/contents/generations/tasks`.
- [Models](/models): full catalog with live pricing.
- [Quickstart](/docs/quickstart): API key, base URL, and first call.
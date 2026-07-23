import {
  buildChatCompletionExtras,
  buildHeaders,
  ChatHttpError,
  readChatErrorResponse,
  resolveApiConfig,
} from '@/utils/api'
import { safeFetch } from '@/utils/httpClient'
import { sendNewApiRequest } from '@/runtime/direct/newApiAttachments'
import {
  runSingleTurnWorkbench,
  type SingleTurnWorkbenchRequest,
} from '@/runtime/workbench/singleTurnWorkbench'

export async function sendSingleTurnWorkbench(
  request: SingleTurnWorkbenchRequest,
  modelProviderId: string | undefined,
  onText: (text: string) => void,
  signal?: AbortSignal,
) {
  const config = await resolveApiConfig({ modelId: request.modelId, modelProviderId })
  return await runSingleTurnWorkbench(
    request,
    async payload => {
      const response = await sendNewApiRequest(
        {
          model: config.model,
          messages: payload.messages,
          stream: true,
          temperature: 0.3,
          ...buildChatCompletionExtras(config),
        },
        body => safeFetch(`${config.apiBase}/v1/chat/completions`, {
          method: 'POST',
          headers: buildHeaders(config),
          signal,
          body,
        }),
      )
      if (!response.ok) {
        throw new ChatHttpError(await readChatErrorResponse(response, '工作台请求失败', config.apiKey))
      }
      return response
    },
    onText,
    signal,
  )
}

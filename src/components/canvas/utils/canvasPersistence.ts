import { getItem, setItem } from '@/utils/idb'
import { CANVAS_DOCUMENT_KEY, type CanvasDocumentV1 } from '@/types/canvas'
import { parseCanvasDocument, serializeCanvasDocument } from './canvasSerialization'

export async function loadCanvasDocument(): Promise<CanvasDocumentV1> {
  const raw = await getItem(CANVAS_DOCUMENT_KEY)
  return parseCanvasDocument(raw)
}

export async function saveCanvasDocument(doc: CanvasDocumentV1): Promise<void> {
  await setItem(CANVAS_DOCUMENT_KEY, serializeCanvasDocument(doc))
}

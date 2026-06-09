import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildBrowserInvokePayload,
  executeBrowserToolCall,
  getBrowserToolDefinitions,
  isBrowserToolName,
  normalizeBrowserToolName,
} from '../browserTools'

test('exposes only safe browser tools unless approval tools are requested', () => {
  assert.deepEqual(
    getBrowserToolDefinitions().map(tool => tool.function.name),
    [
      'browser_launch',
      'browser_search',
      'browser_open',
      'browser_read',
      'browser_state',
      'browser_screenshot',
      'browser_close',
    ],
  )

  assert.deepEqual(
    getBrowserToolDefinitions({ includeApproval: true }).map(tool => tool.function.name),
    [
      'browser_launch',
      'browser_search',
      'browser_open',
      'browser_read',
      'browser_state',
      'browser_screenshot',
      'browser_close',
      'browser_click',
      'browser_type',
    ],
  )
})

test('normalizes browser tool aliases', () => {
  assert.equal(normalizeBrowserToolName('browser'), 'browser_open')
  assert.equal(normalizeBrowserToolName('web-open'), 'browser_open')
  assert.equal(normalizeBrowserToolName('web_search'), 'browser_search')
  assert.equal(normalizeBrowserToolName('search'), 'browser_search')
  assert.equal(normalizeBrowserToolName('browser_capture'), 'browser_screenshot')
  assert.equal(isBrowserToolName('browser_read'), true)
  assert.equal(isBrowserToolName('unknown_tool'), false)
})

test('builds tauri invoke payloads with camelCase input fields', () => {
  assert.deepEqual(
    buildBrowserInvokePayload('browser_open', { url: 'https://example.com' }),
    { command: 'browser_open', payload: { input: { url: 'https://example.com', query: undefined, maxResults: undefined, maxChars: undefined, maxElements: undefined, fullPage: undefined, selector: undefined, text: undefined } } },
  )

  assert.deepEqual(
    buildBrowserInvokePayload('web_search', { query: '韭菜盒子', max_results: 3 }),
    { command: 'browser_search', payload: { input: { url: undefined, query: '韭菜盒子', maxResults: 3, maxChars: undefined, maxElements: undefined, fullPage: undefined, selector: undefined, text: undefined } } },
  )

  assert.deepEqual(
    buildBrowserInvokePayload('search', { q: '浏览器控制' }),
    { command: 'browser_search', payload: { input: { url: undefined, query: '浏览器控制', maxResults: undefined, maxChars: undefined, maxElements: undefined, fullPage: undefined, selector: undefined, text: undefined } } },
  )

  assert.deepEqual(
    buildBrowserInvokePayload('browser', { action: 'click', selector: '#submit' }),
    { command: 'browser_click', payload: { input: { url: undefined, query: undefined, maxResults: undefined, maxChars: undefined, maxElements: undefined, fullPage: undefined, selector: '#submit', text: undefined } } },
  )

  assert.deepEqual(
    buildBrowserInvokePayload('browser_screenshot', { full_page: true }),
    { command: 'browser_screenshot', payload: { input: { url: undefined, query: undefined, maxResults: undefined, maxChars: undefined, maxElements: undefined, fullPage: true, selector: undefined, text: undefined } } },
  )

  assert.deepEqual(
    buildBrowserInvokePayload('browser_close', {}),
    { command: 'browser_close', payload: {} },
  )
})

test('browser tools require tauri runtime', async () => {
  const result = await executeBrowserToolCall({
    id: 'call-browser',
    type: 'function',
    function: {
      name: 'browser_open',
      arguments: JSON.stringify({ url: 'https://example.com' }),
    },
  } as any)
  const parsed = JSON.parse(result)

  assert.equal(parsed.status, 'error')
  assert.equal(parsed.error, 'TAURI_REQUIRED')
})

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function normalizeFenceLang(value: string): string {
  const lang = value.trim().replace(/^\{|\}$/g, '')
  return /^[A-Za-z0-9_-]{1,40}$/.test(lang) ? lang : 'code'
}

export function renderStreamingText(content: string): string {
  if (!content) return ''

  const output: string[] = []
  const lines = content.split('\n')
  let inFence = false

  for (const line of lines) {
    const fence = line.match(/^\s*```\s*([A-Za-z0-9_-]+)?\s*$/)
    if (fence) {
      if (inFence) {
        output.push('</code></pre></div>')
        inFence = false
      } else {
        const lang = normalizeFenceLang(fence[1] || 'code')
        output.push(`<div class="md-code md-code-streaming"><div class="md-code-head"><span class="md-code-lang">${escapeHtml(lang)}</span></div><pre><code>`)
        inFence = true
      }
      continue
    }

    if (inFence) {
      output.push(`${escapeHtml(line)}\n`)
    } else {
      output.push(`${escapeHtml(line)}<br>`)
    }
  }

  if (inFence) output.push('</code></pre></div>')

  return output.join('').replace(/<br>$/, '')
}

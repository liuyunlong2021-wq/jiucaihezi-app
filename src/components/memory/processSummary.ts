type ProcessSummaryRow = { kind?: 'tool' | 'narration' | 'retry'; state?: string }

export function summarizeProcessSteps(rows: ProcessSummaryRow[]) {
  return rows.reduce((summary, row) => {
    if (row.kind === 'narration') summary.narration += 1
    else if (row.kind === 'retry') summary.retries += 1
    else summary.tools += 1
    if (row.state === 'failed') summary.failed += 1
    return summary
  }, { tools: 0, retries: 0, narration: 0, failed: 0 })
}

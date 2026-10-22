import { expect, it } from 'vitest'
import { startHistoryApi } from './fixtures/history-api.mjs'
import { historyMetrics } from './check-history-cost.mjs'
it('serves 1000 synthetic rows through exclusive forty-message pages', async () => {
  const api = await startHistoryApi({ messageCount: 1000 })
  try {
    const ids = []
    let before
    while (ids.length < 1000) {
      const r = await fetch(
        api.origin + '/api/v1/rooms/7/messages?limit=40' + (before ? '&before=' + before : ''),
      )
      const page = (await r.json()).messages
      expect(page).toHaveLength(40)
      if (before) expect(page.every((m) => m.id < before)).toBe(true)
      ids.push(...page.map((m) => m.id))
      before = page.at(-1).id
    }
    expect(ids.slice(0, 2)).toEqual([1000, 999])
    expect(ids.at(-1)).toBe(1)
    expect(new Set(ids).size).toBe(1000)
  } finally {
    await api.close()
  }
})
it('reports unavailable heap explicitly and omits IDs, content, tokens and URLs', () => {
  const result = historyMetrics({
    messageCount: 40,
    renderedIds: Array.from({ length: 40 }, (_, i) => i + 1),
    loadMs: 150,
    heapSample: null,
    requestCounts: { 'GET /api/v1/rooms/:id/messages': 2 },
    content: 'private',
    token: 'secret',
    url: 'wss://host?token=secret',
  })
  expect(result.renderedRows).toBe(40)
  expect(result.heapBytes).toBeNull()
  expect(result.heapUnavailableReason).toBeTruthy()
  expect(JSON.stringify(result)).not.toMatch(/secret|private|renderedIds|wss:/)
})
it('rejects missing or duplicate rendered history instead of reporting success', () => {
  expect(() => historyMetrics({ messageCount: 40, renderedIds: [1, 1], loadMs: 100 })).toThrow(
    /rows/,
  )
})
it('rejects a missing canonical identity even when the rendered row count is correct', () => {
  expect(() =>
    historyMetrics({
      messageCount: 40,
      renderedIds: Array.from({ length: 40 }, (_, i) => i),
      loadMs: 10,
    }),
  ).toThrow(/rows/)
})

it('explains unavailable later heap samples even when the first sample succeeds', () => {
  const report = historyMetrics({
    messageCount: 2,
    renderedIds: [1, 2],
    loadMs: 10,
    heapSample: { usedSize: 1000 },
    heapAfterIdle: null,
    heapAfterSwitch: { usedSize: NaN },
  })
  expect(report.heapBytes).toBe(1000)
  expect(report.heapUnavailableReason).toBeNull()
  expect(report.heapAfterIdleBytes).toBeNull()
  expect(report.heapAfterIdleUnavailableReason).toBeTruthy()
  expect(report.heapAfterSwitchBytes).toBeNull()
  expect(report.heapAfterSwitchUnavailableReason).toBeTruthy()
})

it.each([
  [1, 1],
  [1, 3],
])('rejects changed post-switch identities %j with an unchanged row count', (...ids) => {
  expect(() =>
    historyMetrics({
      messageCount: 2,
      renderedIds: [1, 2],
      postSwitchRenderedIds: ids,
      postSwitchRenderedRows: 2,
      loadMs: 10,
    }),
  ).toThrow(/rows/)
})

it('accepts the same post-switch identities in another order without publishing them', () => {
  const report = historyMetrics({
    messageCount: 2,
    renderedIds: [1, 2],
    postSwitchRenderedIds: [2, 1],
    loadMs: 10,
  })
  expect(report.postSwitchRenderedRows).toBe(2)
  expect(JSON.stringify(report)).not.toMatch(/renderedIds|postSwitchRenderedIds/)
})

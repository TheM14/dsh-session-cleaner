/**
 * Smoke tests for the pure logic of dsh-session-cleaner (no host required).
 * Run after a build: `node --test test/smoke.test.mjs`
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { Readable } from 'node:stream'
import { workspaceJsonAfter, projcacheJsonAfter, filterWorkspaceState } from '../lib/types/registry-edit.js'
import { groupArchived } from '../lib/types/group.js'
import { planSweep } from '../lib/types/cleanup-plan.js'
import { apply } from '../lib/index.js'

const ID = 'session-99a42cb7-0405-46ab-ab93-c64d5722595d'
const OTHER = 'session-8922169d-e7f2-4df8-aa1f-814b5e5dc4f4'

function createHost(options = {}) {
  let workspaceGlobal = {
    initialized: true,
    workspaceIds: ['ws-1'],
    archivedSessionIds: options.durableArchivedIds ?? [ID],
  }
  const workspaceRecords = new Map([['ws-1', { id: 'ws-1', path: 'C:\\x', title: 'x', sessionIds: [ID] }]])
  const projcacheRecords = new Map([[ID, { rows: { title: { val: 'test' } } }]])
  const calls = {
    workspaceSet: 0,
    workspaceUpdate: 0,
    workspaceAttach: 0,
    projcacheDelete: 0,
    projcachePut: 0,
    agentCreate: 0,
    presetMount: 0,
    sessionGet: 0,
  }
  let createdAgentOptions

  const workspaceDomain = {
    global: {
      get: () => structuredClone(workspaceGlobal),
      set: async (value) => {
        calls.workspaceSet += 1
        if (options.failWorkspaceSet) throw new Error('workspace set failed')
        workspaceGlobal = structuredClone(value)
      },
    },
    table: () => ({
      entries: () => workspaceRecords.entries(),
      update: async (key, mutate) => {
        calls.workspaceUpdate += 1
        if (options.failWorkspaceUpdate) throw new Error('workspace update failed')
        workspaceRecords.set(key, structuredClone(mutate(structuredClone(workspaceRecords.get(key)))))
      },
    }),
  }
  const projcacheDomain = {
    global: { get: () => null, set: async () => {} },
    table: () => ({
      get: (key) => structuredClone(projcacheRecords.get(key)),
      entries: () => projcacheRecords.entries(),
      delete: async (key) => {
        calls.projcacheDelete += 1
        if (options.failProjcacheDelete) throw new Error('projcache delete failed')
        return projcacheRecords.delete(key)
      },
      put: async (key, value) => {
        calls.projcachePut += 1
        projcacheRecords.set(key, structuredClone(value))
      },
    }),
  }

  let handler
  const ctx = {
    workspaceRegistry: {
      archivedSessionIds: options.memoryArchivedIds ?? [ID],
      list: () =>
        [...workspaceRecords.values()].map((record) => ({
          ...structuredClone(record),
          attachSession: async (sessionId) => {
            calls.workspaceAttach += 1
            workspaceRecords.set('ws-1', { ...record, sessionIds: [sessionId, ...record.sessionIds] })
          },
        })),
    },
    sessionPersistence: {
      list: async () => [],
      locate: () => undefined,
      inspect: async () => {
        if (options.failInspect) throw new Error('inspect failed')
        return {
          meta: { version: 0, id: ID, createdAt: 1, cwd: 'C:\\x', agentPreset: 'old-preset' },
          events: [{ type: 'turn/start', seq: 0, time: 1, data: { turn: 0 } }],
        }
      },
    },
    sessions: {
      list: () => [],
      get: () => {
        calls.sessionGet += 1
        return options.live || options.liveOnCheck === calls.sessionGet ? { id: ID } : undefined
      },
    },
    storageDomain: {
      get: (name) => {
        if (options.failWorkspaceRead && name === 'workspace') throw new Error('workspace read failed')
        if (name === 'workspace') return workspaceDomain
        if (name === 'session_projcache') return projcacheDomain
        return undefined
      },
    },
    agentPresets: {
      list: async () =>
        options.presets ?? [{ id: 'new-preset', name: 'New preset', trust: 'system' }],
      mount: async () => {
        calls.presetMount += 1
      },
    },
    agents: {
      create: async (agentOptions) => {
        calls.agentCreate += 1
        createdAgentOptions = agentOptions
        await agentOptions.setup?.({})
        return { agent: { id: agentOptions.sessionId }, dispose: async () => {} }
      },
    },
    webServer: {
      register: (route) => {
        handler = route.handler
        return () => {}
      },
    },
    effect: (register) => register(),
  }
  apply(ctx)

  async function requestRaw(method, path, rawBody, headers = {}) {
    const payload = rawBody === undefined ? [] : [Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody)]
    const req = Readable.from(payload)
    req.method = method
    req.url = `/api/dsh-session-cleaner${path}`
    req.headers = { host: '127.0.0.1:3080', ...headers }
    return new Promise((resolve, reject) => {
      const response = {
        status: 0,
        headers: {},
        writeHead(status, nextHeaders) {
          this.status = status
          this.headers = nextHeaders
        },
        end(text) {
          resolve({ status: this.status, headers: this.headers, body: JSON.parse(text) })
        },
      }
      Promise.resolve(handler(req, response)).catch(reject)
    })
  }

  async function request(method, path, body, headers = {}) {
    return requestRaw(method, path, body === undefined ? undefined : JSON.stringify(body), headers)
  }

  return {
    calls,
    request,
    requestRaw,
    workspaceGlobal: () => structuredClone(workspaceGlobal),
    workspaceRecord: () => structuredClone(workspaceRecords.get('ws-1')),
    projcacheHas: (id) => projcacheRecords.has(id),
    createdAgentOptions: () => createdAgentOptions,
  }
}

const WORKSPACE_JSON = JSON.stringify({
  unit: { name: 'workspace', version: 2 },
  global: { initialized: true, workspaceIds: ['ws-1'], archivedSessionIds: [ID, OTHER] },
  tables: {
    workspaces: {
      'ws-1': { path: 'C:\\x', title: 'x', sessionIds: [OTHER, ID] },
    },
  },
})

const PROJCACHE_JSON = JSON.stringify({
  unit: { name: 'session_projcache', version: 3 },
  global: null,
  tables: { sessions: { [ID]: { rows: { title: { val: '测试插件对话' } } }, [OTHER]: { rows: { title: { val: '另一条' } } } } },
})

test('workspaceJsonAfter(delete) removes the id from the archive set and every account', () => {
  const next = workspaceJsonAfter(WORKSPACE_JSON, ID, 'delete')
  assert.notEqual(next, null)
  const doc = JSON.parse(next)
  assert.deepEqual(doc.global.archivedSessionIds, [OTHER])
  assert.deepEqual(doc.tables.workspaces['ws-1'].sessionIds, [OTHER])
})

test('workspaceJsonAfter(restore) keeps the workspace slot and only clears the archive set', () => {
  const next = workspaceJsonAfter(WORKSPACE_JSON, ID, 'restore')
  assert.notEqual(next, null)
  const doc = JSON.parse(next)
  assert.deepEqual(doc.global.archivedSessionIds, [OTHER])
  assert.deepEqual(doc.tables.workspaces['ws-1'].sessionIds, [OTHER, ID])
})

test('workspaceJsonAfter returns null on invalid input', () => {
  assert.equal(workspaceJsonAfter('{not json', ID, 'delete'), null)
})

test('projcacheJsonAfter drops only the named row', () => {
  const next = projcacheJsonAfter(PROJCACHE_JSON, ID)
  assert.notEqual(next, null)
  const doc = JSON.parse(next)
  assert.equal(doc.tables.sessions[ID], undefined)
  assert.ok(doc.tables.sessions[OTHER])
})

test('projcacheJsonAfter returns null on invalid input', () => {
  assert.equal(projcacheJsonAfter('nope', ID), null)
})

test('filterWorkspaceState(delete) removes archive + accounts and never mutates the input', () => {
  const state = JSON.parse(WORKSPACE_JSON)
  const next = filterWorkspaceState(state, ID, 'delete')
  assert.notEqual(next, null)
  assert.deepEqual(next.global.archivedSessionIds, [OTHER])
  assert.deepEqual(next.tables.workspaces['ws-1'].sessionIds, [OTHER])
  // Input must be untouched (storage domains forbid in-place mutation).
  assert.deepEqual(state.global.archivedSessionIds, [ID, OTHER])
  assert.deepEqual(state.tables.workspaces['ws-1'].sessionIds, [OTHER, ID])
})

test('filterWorkspaceState(restore) keeps the workspace slot and clears only the archive set', () => {
  const next = filterWorkspaceState(JSON.parse(WORKSPACE_JSON), ID, 'restore')
  assert.notEqual(next, null)
  assert.deepEqual(next.global.archivedSessionIds, [OTHER])
  assert.deepEqual(next.tables.workspaces['ws-1'].sessionIds, [OTHER, ID])
})

test('filterWorkspaceState rejects non-object input', () => {
  assert.equal(filterWorkspaceState(null, ID, 'delete'), null)
  assert.equal(filterWorkspaceState('text', ID, 'delete'), null)
})

test('groupArchived groups by workspace order and appends an ungrouped bucket', () => {
  const headerById = new Map([
    [ID, { id: ID, version: 0, createdAt: 1, cwd: 'C:\\x' }],
    [OTHER, { id: OTHER, version: 0, createdAt: 2, cwd: 'C:\\x' }],
    ['session-00000000-aaaa-bbbb-cccc-000000000000', { id: 'session-00000000-aaaa-bbbb-cccc-000000000000', version: 0, createdAt: 3, cwd: 'C:\\y' }],
  ])
  const workspaces = [
    { id: 'ws-1', path: 'C:\\x', title: 'x', sessionIds: [ID, OTHER] },
  ]
  const groups = groupArchived(
    [OTHER, ID, 'session-00000000-aaaa-bbbb-cccc-000000000000'],
    headerById,
    new Map([[ID, '测试插件对话']]),
    workspaces,
    new Set([OTHER]),
  )
  assert.equal(groups.length, 2)
  assert.equal(groups[0].workspace.title, 'x')
  assert.deepEqual(groups[0].sessions.map((row) => row.sessionId), [ID, OTHER])
  assert.equal(groups[0].sessions[0].title, '测试插件对话')
  assert.equal(groups[0].sessions[1].live, true)
  assert.equal(groups[1].workspace, null)
  assert.equal(groups[1].sessions[0].sessionId, 'session-00000000-aaaa-bbbb-cccc-000000000000')
})

// --- P0-5 regressions: non-array fields are preserved, no-change returns null ---

test('filterWorkspaceState(delete) preserves a non-array archivedSessionIds field verbatim', () => {
  const state = JSON.parse(WORKSPACE_JSON)
  state.global.archivedSessionIds = { corrupt: true }
  const next = filterWorkspaceState(state, ID, 'delete')
  assert.notEqual(next, null) // workspace slots still had the id removed
  assert.deepEqual(next.global.archivedSessionIds, { corrupt: true }) // preserved, not collapsed to []
  assert.deepEqual(next.tables.workspaces['ws-1'].sessionIds, [OTHER])
})

test('filterWorkspaceState returns null when the id is absent (no pointless write)', () => {
  const state = JSON.parse(WORKSPACE_JSON)
  const absent = 'session-ffffffff-ffff-ffff-ffff-ffffffffffff'
  assert.equal(filterWorkspaceState(state, absent, 'delete'), null)
  assert.equal(filterWorkspaceState(state, absent, 'restore'), null)
})

test('workspaceJsonAfter(delete) preserves a non-array archivedSessionIds field', () => {
  const doc = JSON.parse(WORKSPACE_JSON)
  doc.global.archivedSessionIds = 42
  const next = JSON.parse(workspaceJsonAfter(JSON.stringify(doc), ID, 'delete'))
  assert.equal(next.global.archivedSessionIds, 42)
  assert.deepEqual(next.tables.workspaces['ws-1'].sessionIds, [OTHER])
})

test('groupArchived ignores malformed workspace sessionIds and uses set membership', () => {
  const groups = groupArchived(
    [ID],
    new Map([[ID, { id: ID, version: 0, createdAt: 1, cwd: 'C:\\x' }]]),
    new Map(),
    [{ id: 'bad', path: 'C:\\bad', title: 'bad', sessionIds: { corrupt: true } }],
    new Set(),
  )
  assert.equal(groups.length, 1)
  assert.equal(groups[0].workspace, null)
  assert.equal(groups[0].sessions[0].sessionId, ID)
})

test('planSweep derives ghost archives, orphan slots, and orphan cache rows without mutation', () => {
  const GHOST = 'session-11111111-1111-1111-1111-111111111111'
  const ORPHAN = 'session-22222222-2222-2222-2222-222222222222'
  const KEPT = 'session-33333333-3333-3333-3333-333333333333'
  const workspaceSessionIds = new Map([['ws-1', [GHOST, ORPHAN, KEPT]]])
  const result = planSweep({
    archivedIds: [GHOST],
    headerIds: new Set([KEPT]),
    liveIds: new Set(),
    workspaceSessionIds,
    projcacheIds: [GHOST, ORPHAN, KEPT],
  })
  assert.deepEqual(result.archivedGhosts, [GHOST])
  assert.deepEqual(result.orphanSlotsByWorkspace.get('ws-1'), [GHOST, ORPHAN])
  assert.deepEqual(result.orphanProjcacheIds, [GHOST, ORPHAN])
  assert.deepEqual(workspaceSessionIds.get('ws-1'), [GHOST, ORPHAN, KEPT])
})

test('mutation routes reject a POST without the sentinel header', async () => {
  const host = createHost()
  const result = await host.request('POST', '/delete', { sessionId: ID })
  assert.equal(result.status, 403)
  assert.equal(result.body.reason, 'forbidden')
  assert.equal(host.calls.workspaceSet, 0)
  assert.equal(host.calls.projcacheDelete, 0)
})

test('mutation routes return 400 for malformed JSON without mutating storage', async () => {
  const host = createHost()
  const result = await host.requestRaw('POST', '/delete', '{broken', { 'x-dsh-session-cleaner': '1' })
  assert.equal(result.status, 400)
  assert.equal(result.body.reason, 'bad-request')
  assert.equal(host.calls.workspaceSet, 0)
  assert.equal(host.calls.projcacheDelete, 0)
})

test('mutation routes reject request bodies larger than 64KB', async () => {
  const host = createHost()
  const result = await host.requestRaw('POST', '/delete', Buffer.alloc(65537, 0x20), {
    'x-dsh-session-cleaner': '1',
  })
  assert.equal(result.status, 413)
  assert.equal(result.body.reason, 'bad-request')
  assert.equal(host.calls.workspaceSet, 0)
  assert.equal(host.calls.projcacheDelete, 0)
})

test('routes reject a cross-origin browser request and vary on Origin', async () => {
  const host = createHost()
  const result = await host.request(
    'POST',
    '/delete',
    { sessionId: ID },
    { origin: 'http://attacker.invalid', 'x-dsh-session-cleaner': '1' },
  )
  assert.equal(result.status, 403)
  assert.equal(result.body.reason, 'forbidden')
  assert.equal(result.headers.vary, 'Origin')
  assert.equal(host.calls.workspaceSet, 0)
})

test('mutation routes reject Sec-Fetch-Site cross-site even with the sentinel', async () => {
  const host = createHost()
  const result = await host.request(
    'POST',
    '/delete',
    { sessionId: ID },
    { 'x-dsh-session-cleaner': '1', 'sec-fetch-site': 'cross-site' },
  )
  assert.equal(result.status, 403)
  assert.equal(result.body.reason, 'forbidden')
  assert.equal(result.headers.vary, 'Origin')
  assert.equal(host.calls.workspaceSet, 0)
})

test('delete stops before projcache when the workspace registry write fails', async () => {
  const host = createHost({ failWorkspaceSet: true })
  const result = await host.request(
    'POST',
    '/delete',
    { sessionId: ID },
    { 'x-dsh-session-cleaner': '1', 'sec-fetch-site': 'same-origin' },
  )
  assert.equal(result.status, 500)
  assert.equal(result.body.reason, 'partial')
  assert.equal(host.calls.projcacheDelete, 0)
  assert.equal(host.projcacheHas(ID), true)
})

test('delete compensates workspace state when projcache deletion fails', async () => {
  const host = createHost({ failProjcacheDelete: true })
  const result = await host.request(
    'POST',
    '/delete',
    { sessionId: ID },
    { 'x-dsh-session-cleaner': '1', 'sec-fetch-site': 'same-origin' },
  )
  assert.equal(result.status, 500)
  assert.equal(result.body.reason, 'partial')
  assert.deepEqual(host.workspaceGlobal().archivedSessionIds, [ID])
  assert.deepEqual(host.workspaceRecord().sessionIds, [ID])
  assert.equal(host.projcacheHas(ID), true)
  assert.equal(host.calls.projcachePut, 1)
})

test('durable archive membership wins over stale in-memory membership', async () => {
  const host = createHost({ memoryArchivedIds: [ID], durableArchivedIds: [] })
  const stale = await host.request(
    'POST',
    '/delete',
    { sessionId: ID },
    { 'x-dsh-session-cleaner': '1' },
  )
  assert.equal(stale.status, 409)
  assert.equal(stale.body.reason, 'stale-registry')
  assert.equal(host.calls.projcacheDelete, 0)
})

test('delete aborts when the session becomes live at the final pre-commit check', async () => {
  const host = createHost({ liveOnCheck: 2 })
  const result = await host.request(
    'POST',
    '/delete',
    { sessionId: ID },
    { 'x-dsh-session-cleaner': '1', 'sec-fetch-site': 'same-origin' },
  )
  assert.equal(result.status, 409)
  assert.equal(result.body.reason, 'live')
  assert.equal(host.calls.sessionGet, 2)
  assert.equal(host.calls.workspaceSet, 0)
  assert.equal(host.calls.projcacheDelete, 0)
})

test('sweep fails closed when the workspace registry cannot be read', async () => {
  const host = createHost({ failWorkspaceRead: true })
  const result = await host.request('POST', '/sweep', {}, { 'x-dsh-session-cleaner': '1' })
  assert.equal(result.status, 500)
  assert.equal(result.body.reason, 'registry-unavailable')
  assert.equal(host.calls.workspaceUpdate, 0)
  assert.equal(host.calls.projcacheDelete, 0)
})

test('sweep stops before workspace slots and projcache when archive write-back fails', async () => {
  const host = createHost({ failWorkspaceSet: true })
  const result = await host.request('POST', '/sweep', {}, { 'x-dsh-session-cleaner': '1' })
  assert.equal(result.status, 500)
  assert.equal(result.body.reason, 'partial')
  assert.deepEqual(result.body.failedSteps, ['registry'])
  assert.equal(host.calls.workspaceUpdate, 0)
  assert.equal(host.calls.projcacheDelete, 0)
})

test('continue creates a lineage child under the selected preset without mutating the source', async () => {
  const host = createHost()
  const result = await host.request(
    'POST',
    '/continue',
    { sessionId: ID, presetId: 'new-preset' },
    { 'x-dsh-session-cleaner': '1', 'sec-fetch-site': 'same-origin' },
  )
  assert.equal(result.status, 200)
  assert.equal(result.body.action, 'continue')
  assert.equal(result.body.sourceSessionId, ID)
  assert.equal(result.body.presetId, 'new-preset')
  assert.equal(result.body.workspaceAttached, true)
  assert.equal(host.calls.agentCreate, 1)
  assert.equal(host.calls.presetMount, 1)
  assert.equal(host.calls.workspaceAttach, 1)
  assert.deepEqual(host.workspaceGlobal().archivedSessionIds, [ID])
  assert.equal(host.projcacheHas(ID), true)

  const created = host.createdAgentOptions()
  assert.equal(created.meta.parentSession, ID)
  assert.equal(created.meta.agentPreset, 'new-preset')
  assert.equal(created.meta.seedLength, 1)
  assert.equal(created.seed.length, 2)
  assert.equal(created.seed[1].type, 'agent-preset/selected')
  assert.equal(created.seed[1].data.agentPreset, 'new-preset')
})

test('continue refuses unknown and broken presets before creating a child', async () => {
  const unknownHost = createHost()
  const unknown = await unknownHost.request(
    'POST',
    '/continue',
    { sessionId: ID, presetId: 'missing-preset' },
    { 'x-dsh-session-cleaner': '1' },
  )
  assert.equal(unknown.status, 400)
  assert.equal(unknown.body.reason, 'unknown-preset')
  assert.equal(unknownHost.calls.agentCreate, 0)

  const brokenHost = createHost({ presets: [{ id: 'broken-preset', trust: 'user', broken: 'bad yaml' }] })
  const broken = await brokenHost.request(
    'POST',
    '/continue',
    { sessionId: ID, presetId: 'broken-preset' },
    { 'x-dsh-session-cleaner': '1' },
  )
  assert.equal(broken.status, 409)
  assert.equal(broken.body.reason, 'broken-preset')
  assert.equal(brokenHost.calls.agentCreate, 0)
})

test('build output contains the client loader and no stale ArchivedPanel declarations', () => {
  const clientBundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.match(clientBundle, /^window\.__ModuleLoader__\.load\(/)
  assert.equal(existsSync(new URL('../lib/types/client/ArchivedPanel.d.ts', import.meta.url)), false)
})

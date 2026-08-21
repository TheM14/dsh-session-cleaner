/**
 * dsh-session-cleaner Host half.
 *
 * Mounts a tiny JSON API under `/api/dsh-session-cleaner`:
 *   GET  /list     -> archived sessions grouped by workspace
 *   GET  /presets  -> mountable agent preset roster
 *   POST /delete   -> { sessionId } thorough deletion of an ARCHIVED session
 *   POST /restore  -> { sessionId } unarchive (keeps the workspace slot)
 *   POST /continue -> create a lineage child with a selected preset
 *   POST /sweep    -> remove registry, cache, slot, and quarantine leftovers
 *
 * Official seams only: `ctx.webServer` for the route, `ctx.workspaceRegistry`
 * (live archive set), `ctx.sessionPersistence` (headers + artifact location),
 * `ctx.sessions` (live guard), and `ctx.storageDomain` — the durable registry
 * documents are updated THROUGH the host's own storage domains (`workspace`,
 * `session_projcache`) so running-host write-backs cannot resurrect deleted
 * entries; a raw disk edit is only the fallback when a domain is not open.
 * Successful domain writes are broadcast to the official client immediately.
 * A restart is only required to release a live session or reconcile a stale
 * in-memory/durable archive split (documented in plugin-design.md).
 * @module dsh-session-cleaner
 */
import { basename, dirname, join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { planSweep } from './cleanup-plan.ts'
import { groupArchived } from './group.ts'
import { filterWorkspaceState, projcacheJsonAfter } from './registry-edit.ts'
import {
  SESSION_ID_PATTERN,
  type CleanerListResult,
  type CleanerPreset,
  type CleanerResponse,
  type CleanerSweepResult,
  type DeleteStep,
} from './types.ts'

export const name = 'dsh-session-cleaner'

/** Services this entry requires before activation. */
export const inject = [
  'webServer',
  'sessionPersistence',
  'workspaceRegistry',
  'sessions',
  'storageDomain',
  'agents',
  'agentPresets',
]

const API_PREFIX = '/api/dsh-session-cleaner'
const MAX_BODY_BYTES = 65536
const MUTATION_HEADER = 'x-dsh-session-cleaner'

type Tombstone = 'deleted' | 'restored'

/** Loose structural view of the storage-domain runtime (official `get` handle). */
interface LooseTable {
  get(key: string): unknown
  put(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<boolean>
  update(key: string, fn: (current: unknown) => unknown): Promise<unknown>
  entries(): IterableIterator<[string, unknown]>
}
interface LooseDomain {
  readonly global: { get(): unknown; set(value: unknown): Promise<void> }
  table(name: string): LooseTable
}

interface WorkspaceRecordShape {
  sessionIds?: unknown
}
interface WorkspaceStateShape {
  global?: { initialized?: unknown; workspaceIds?: unknown; archivedSessionIds?: unknown }
  tables?: { workspaces?: Record<string, WorkspaceRecordShape> }
}

/** Where a workspace state was read from; writes must go back to the same place. */
type WorkspaceSource = 'domain' | 'disk'

interface WorkspaceRead {
  readonly source: WorkspaceSource
  readonly state: WorkspaceStateShape
}

interface ProjcacheSnapshot {
  readonly source: WorkspaceSource
  readonly present: boolean
  readonly value?: unknown
}

interface QuarantinedLog {
  readonly originalPath: string
  readonly quarantinePath: string
  readonly moved: boolean
}

class RequestBodyError extends Error {
  constructor(
    readonly status: 400 | 413,
    message: string,
  ) {
    super(message)
  }
}

/** Everything one apply() instance owns; HMR disposal releases the route. */
interface CleanerRuntime {
  tombstones: Map<string, Tombstone>
  route(req: IncomingMessage, res: ServerResponse): Promise<void>
}

export function apply(ctx: Context): void {
  const tombstones = new Map<string, Tombstone>()
  const continuedHandles = new Map<string, { dispose(): Promise<void> }>()
  const continueInflight = new Map<string, Promise<CleanerResponse>>()

  const markTombstone = (sessionId: string, value: Tombstone): void => {
    tombstones.delete(sessionId)
    tombstones.set(sessionId, value)
    while (tombstones.size > 256) {
      const oldest = tombstones.keys().next().value as string | undefined
      if (oldest === undefined) break
      tombstones.delete(oldest)
    }
  }

  const archivedIds = (): readonly string[] => ctx.workspaceRegistry.archivedSessionIds as readonly string[]

  /** The already-open host domain, when present in this composition. */
  const domainOf = (name: string): LooseDomain | undefined => {
    try {
      return ctx.storageDomain.get(name) as unknown as LooseDomain | undefined
    } catch (error) {
      console.error(`[dsh-session-cleaner] storage domain lookup failed (${name}): ${String(error)}`)
      throw error
    }
  }

  function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
  }

  /**
   * Normalized workspace state, tagged with the source it was read from so
   * writes never mix sources (P0-6). When the host's own domain is open it is
   * the only authoritative source: a domain read failure aborts the mutation
   * instead of silently falling back to a possibly-stale disk snapshot.
   */
  function readWorkspaceState(): WorkspaceRead | null {
    let domain: LooseDomain | undefined
    try {
      domain = domainOf('workspace')
    } catch {
      return null
    }
    if (domain !== undefined) {
      try {
        // The domain's global handle returns the GLOBAL object directly, and
        // the workspaces table enumerates the records — normalize both into
        // the same whole-document shape the disk file uses.
        return {
          source: 'domain',
          state: {
            global: cloneJson(domain.global.get()) as WorkspaceStateShape['global'],
            tables: {
              workspaces: Object.fromEntries(domain.table('workspaces').entries()) as Record<
                string,
                WorkspaceRecordShape
              >,
            },
          },
        }
      } catch (error) {
        console.error(`[dsh-session-cleaner] workspace domain read failed: ${String(error)}`)
        return null
      }
    }
    try {
      return {
        source: 'disk',
        state: JSON.parse(readFileSync(dshHomePath('storages', 'workspace.json'), 'utf8')) as WorkspaceStateShape,
      }
    } catch {
      return null
    }
  }

  /** Disk-only whole-document rewrite for the workspace registry (same source). */
  function rewriteWorkspaceDoc(mutate: (doc: { unit?: unknown; global?: unknown; tables?: unknown }) => void): boolean {
    const target = dshHomePath('storages', 'workspace.json')
    try {
      const doc = JSON.parse(readFileSync(target, 'utf8')) as { unit?: unknown; global?: unknown; tables?: unknown }
      mutate(doc)
      writeAtomicSync(target, `${JSON.stringify(doc, null, 2)}\n`)
      return true
    } catch {
      return false
    }
  }

  /** Replace the workspace global singleton in the SAME source it was read from. */
  async function setWorkspaceGlobal(source: WorkspaceSource, global: unknown): Promise<boolean> {
    if (source === 'domain') {
      try {
        const domain = domainOf('workspace')
        if (domain === undefined) return false
        await domain.global.set(global)
        return true
      } catch (error) {
        console.error(`[dsh-session-cleaner] workspace domain global write failed: ${String(error)}`)
        return false
      }
    }
    return rewriteWorkspaceDoc((doc) => {
      doc.global = global
    })
  }

  /**
   * Remove one or more session ids from a single workspace record in one atomic
   * write. On the domain this is a per-record read-modify-write
   * (`table.update`); on disk it rewrites the whole document (the only option
   * for a JSON file).
   */
  async function removeSessionsFromWorkspaceRecord(
    source: WorkspaceSource,
    workspaceId: string,
    sessionIds: readonly string[],
  ): Promise<boolean> {
    const ids = new Set(sessionIds)
    if (source === 'domain') {
      try {
        const domain = domainOf('workspace')
        if (domain === undefined) return false
        await domain.table('workspaces').update(workspaceId, (current) => {
          const record = cloneJson(current as WorkspaceRecordShape)
          if (record && Array.isArray(record.sessionIds)) {
            record.sessionIds = record.sessionIds.filter((id) => !ids.has(id))
          }
          return record
        })
        return true
      } catch (error) {
        console.error(`[dsh-session-cleaner] workspace record update failed (${workspaceId}): ${String(error)}`)
        return false
      }
    }
    return rewriteWorkspaceDoc((doc) => {
      const tables = (doc.tables ?? {}) as { workspaces?: Record<string, WorkspaceRecordShape> }
      const record = tables.workspaces?.[workspaceId]
      if (record && Array.isArray(record.sessionIds)) {
        record.sessionIds = record.sessionIds.filter((id) => !ids.has(id))
      }
    })
  }

  function jsonEqual(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right)
  }

  async function setWorkspaceRecordSessionIds(
    domain: LooseDomain,
    workspaceId: string,
    sessionIds: unknown,
  ): Promise<void> {
    await domain.table('workspaces').update(workspaceId, (current) => {
      const record = current && typeof current === 'object' ? cloneJson(current as WorkspaceRecordShape) : {}
      record.sessionIds = Array.isArray(sessionIds) ? cloneJson(sessionIds) : sessionIds
      return record
    })
  }

  interface WorkspaceCommit {
    readonly ok: boolean
    readonly rollbackOk: boolean
    rollback(): Promise<boolean>
  }

  /** Apply one pure workspace transform and retain a compensating rollback. */
  async function applyWorkspaceMutation(
    read: WorkspaceRead,
    sessionId: string,
    mode: 'delete' | 'restore',
  ): Promise<WorkspaceCommit> {
    const next = filterWorkspaceState(read.state, sessionId, mode) as WorkspaceStateShape | null
    if (next === null) {
      return { ok: false, rollbackOk: true, rollback: async () => true }
    }

    if (read.source === 'disk') {
      const target = dshHomePath('storages', 'workspace.json')
      try {
        writeAtomicSync(target, `${JSON.stringify(next, null, 2)}\n`)
      } catch (error) {
        console.error(`[dsh-session-cleaner] workspace disk write failed: ${String(error)}`)
        return { ok: false, rollbackOk: true, rollback: async () => true }
      }
      return {
        ok: true,
        rollbackOk: true,
        rollback: async () => {
          try {
            writeAtomicSync(target, `${JSON.stringify(read.state, null, 2)}\n`)
            return true
          } catch (error) {
            console.error(`[dsh-session-cleaner] workspace disk rollback failed: ${String(error)}`)
            return false
          }
        },
      }
    }

    let domain: LooseDomain | undefined
    try {
      domain = domainOf('workspace')
    } catch {
      return { ok: false, rollbackOk: true, rollback: async () => true }
    }
    if (domain === undefined) return { ok: false, rollbackOk: true, rollback: async () => true }

    const globalChanged = !jsonEqual(read.state.global, next.global)
    const originalWorkspaces = read.state.tables?.workspaces ?? {}
    const nextWorkspaces = next.tables?.workspaces ?? {}
    const changedWorkspaceIds = Object.keys(originalWorkspaces).filter(
      (workspaceId) => !jsonEqual(originalWorkspaces[workspaceId]?.sessionIds, nextWorkspaces[workspaceId]?.sessionIds),
    )
    let globalWritten = false
    const writtenWorkspaceIds: string[] = []

    const rollback = async (): Promise<boolean> => {
      let ok = true
      for (const workspaceId of [...writtenWorkspaceIds].reverse()) {
        try {
          await setWorkspaceRecordSessionIds(domain, workspaceId, originalWorkspaces[workspaceId]?.sessionIds)
        } catch (error) {
          console.error(`[dsh-session-cleaner] workspace record rollback failed (${workspaceId}): ${String(error)}`)
          ok = false
        }
      }
      if (globalWritten) {
        try {
          await domain.global.set(cloneJson(read.state.global))
        } catch (error) {
          console.error(`[dsh-session-cleaner] workspace global rollback failed: ${String(error)}`)
          ok = false
        }
      }
      return ok
    }

    try {
      if (globalChanged) {
        globalWritten = true
        await domain.global.set(cloneJson(next.global))
      }
      for (const workspaceId of changedWorkspaceIds) {
        writtenWorkspaceIds.push(workspaceId)
        await setWorkspaceRecordSessionIds(domain, workspaceId, nextWorkspaces[workspaceId]?.sessionIds)
      }
      return { ok: true, rollbackOk: true, rollback }
    } catch (error) {
      console.error(`[dsh-session-cleaner] workspace mutation failed: ${String(error)}`)
      const rollbackOk = await rollback()
      return { ok: false, rollbackOk, rollback: async () => rollbackOk }
    }
  }

  function readProjcacheSnapshot(sessionId: string): ProjcacheSnapshot | null {
    let domain: LooseDomain | undefined
    try {
      domain = domainOf('session_projcache')
    } catch {
      return null
    }
    if (domain !== undefined) {
      try {
        const value = domain.table('sessions').get(sessionId)
        return { source: 'domain', present: value !== undefined, value: value === undefined ? undefined : cloneJson(value) }
      } catch (error) {
        console.error(`[dsh-session-cleaner] projcache domain read failed: ${String(error)}`)
        return null
      }
    }
    const target = dshHomePath('storages', 'session_projcache.json')
    if (!existsSync(target)) return { source: 'disk', present: false }
    try {
      const doc = JSON.parse(readFileSync(target, 'utf8')) as { tables?: { sessions?: Record<string, unknown> } }
      const value = doc.tables?.sessions?.[sessionId]
      return { source: 'disk', present: value !== undefined, value: value === undefined ? undefined : cloneJson(value) }
    } catch (error) {
      console.error(`[dsh-session-cleaner] projcache disk read failed: ${String(error)}`)
      return null
    }
  }

  /** Remove the projection-cache row in the SAME source (domain or disk only). */
  async function removeProjcacheRow(sessionId: string, source?: WorkspaceSource): Promise<boolean> {
    let domain: LooseDomain | undefined
    try {
      domain = domainOf('session_projcache')
    } catch {
      return false
    }
    if (source !== 'disk' && domain !== undefined) {
      try {
        await domain.table('sessions').delete(sessionId)
        return true
      } catch (error) {
        console.error(`[dsh-session-cleaner] projcache domain delete failed: ${String(error)}`)
        return false
      }
    }
    if (source === 'domain') return false
    const target = dshHomePath('storages', 'session_projcache.json')
    if (!existsSync(target)) return true
    return rewriteStorage('session_projcache.json', (text) => projcacheJsonAfter(text, sessionId))
  }

  async function restoreProjcacheRow(sessionId: string, snapshot: ProjcacheSnapshot): Promise<boolean> {
    if (!snapshot.present) return true
    if (snapshot.source === 'domain') {
      let domain: LooseDomain | undefined
      try {
        domain = domainOf('session_projcache')
        if (domain === undefined) return false
        await domain.table('sessions').put(sessionId, cloneJson(snapshot.value as unknown))
        return true
      } catch (error) {
        console.error(`[dsh-session-cleaner] projcache rollback failed: ${String(error)}`)
        return false
      }
    }
    const target = dshHomePath('storages', 'session_projcache.json')
    try {
      const doc = existsSync(target)
        ? (JSON.parse(readFileSync(target, 'utf8')) as { tables?: { sessions?: Record<string, unknown> } })
        : { tables: { sessions: {} as Record<string, unknown> } }
      doc.tables ??= {}
      doc.tables.sessions ??= {}
      doc.tables.sessions[sessionId] = cloneJson(snapshot.value as unknown)
      writeAtomicSync(target, `${JSON.stringify(doc, null, 2)}\n`)
      return true
    } catch (error) {
      console.error(`[dsh-session-cleaner] projcache disk rollback failed: ${String(error)}`)
      return false
    }
  }

  function readProjcacheKeys(): string[] | null {
    let domain: LooseDomain | undefined
    try {
      domain = domainOf('session_projcache')
    } catch {
      return null
    }
    if (domain !== undefined) {
      try {
        return [...domain.table('sessions').entries()].map(([key]) => key)
      } catch (error) {
        console.error(`[dsh-session-cleaner] projcache domain read failed: ${String(error)}`)
        return null
      }
    }
    const target = dshHomePath('storages', 'session_projcache.json')
    if (!existsSync(target)) return []
    try {
      const doc = JSON.parse(readFileSync(target, 'utf8')) as { tables?: { sessions?: Record<string, unknown> } }
      return Object.keys(doc?.tables?.sessions ?? {})
    } catch (error) {
      console.error(`[dsh-session-cleaner] projcache disk read failed: ${String(error)}`)
      return null
    }
  }

  const quarantineRoot = (): string =>
    join(dirname(dshHomePath('storages', 'workspace.json')), '.dsh-session-cleaner-trash')

  function quarantineLog(originalPath: string, sessionId: string): QuarantinedLog | null {
    if (!existsSync(originalPath)) return { originalPath, quarantinePath: '', moved: false }
    const sessionDir = join(quarantineRoot(), sessionId)
    const quarantinePath = join(sessionDir, basename(originalPath))
    try {
      mkdirSync(sessionDir, { recursive: true })
      if (existsSync(quarantinePath)) return null
      renameSync(originalPath, quarantinePath)
      return { originalPath, quarantinePath, moved: true }
    } catch (error) {
      console.error(`[dsh-session-cleaner] log quarantine failed (${sessionId}): ${String(error)}`)
      return null
    }
  }

  function restoreQuarantinedLog(log: QuarantinedLog): boolean {
    if (!log.moved) return true
    try {
      mkdirSync(dirname(log.originalPath), { recursive: true })
      renameSync(log.quarantinePath, log.originalPath)
      try {
        rmdirSync(dirname(log.quarantinePath))
      } catch {
        // Keep a non-empty quarantine directory for sweep.
      }
      return true
    } catch (error) {
      console.error(`[dsh-session-cleaner] log quarantine rollback failed: ${String(error)}`)
      return false
    }
  }

  function purgeQuarantinedLog(log: QuarantinedLog): { ok: boolean; error?: string } {
    if (!log.moved) return { ok: true }
    try {
      rmSync(log.quarantinePath)
      try {
        rmdirSync(dirname(log.quarantinePath))
      } catch {
        // Another pending item may share the directory.
      }
      try {
        rmdirSync(dirname(log.originalPath))
      } catch {
        // The session directory can legitimately contain other files.
      }
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[dsh-session-cleaner] quarantined log purge failed: ${message}`)
      return { ok: false, error: message }
    }
  }

  function readQuarantineFiles(): string[] | null {
    const root = quarantineRoot()
    if (!existsSync(root)) return []
    try {
      const files: string[] = []
      for (const sessionEntry of readdirSync(root, { withFileTypes: true })) {
        if (!sessionEntry.isDirectory() || !SESSION_ID_PATTERN.test(sessionEntry.name)) continue
        const sessionDir = join(root, sessionEntry.name)
        for (const fileEntry of readdirSync(sessionDir, { withFileTypes: true })) {
          if (fileEntry.isFile()) files.push(join(sessionDir, fileEntry.name))
        }
      }
      return files
    } catch (error) {
      console.error(`[dsh-session-cleaner] quarantine read failed: ${String(error)}`)
      return null
    }
  }

  function purgeQuarantineFile(filePath: string): boolean {
    try {
      rmSync(filePath)
      try {
        rmdirSync(dirname(filePath))
      } catch {
        // Directory remains when it still contains another file.
      }
      return true
    } catch (error) {
      console.error(`[dsh-session-cleaner] quarantine sweep failed (${filePath}): ${String(error)}`)
      return false
    }
  }

  // ---- Mutation serialization (P0-1) ----
  // Every delete/restore/sweep runs through this chain so two mutations never
  // both read a stale snapshot and write it back over each other. The official
  // DomainGlobal has no compare-and-swap, so plugin-vs-official-UI archiving in
  // the same instant remains a narrow upstream race we cannot close here.
  let mutationTail: Promise<unknown> = Promise.resolve()

  function enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const run = mutationTail.then(operation, operation)
    mutationTail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  /**
   * The archive set `/list` reports. The durable `archivedSessionIds` is the
   * authority (delete/restore write it directly), tombstone-filtered so an
   * in-flight mutation can never leak a row back into a response.
   */
  function readEffectiveArchivedIds(): string[] {
    const read = readWorkspaceState()
    const raw: unknown = Array.isArray(read?.state?.global?.archivedSessionIds)
      ? read.state.global.archivedSessionIds
      : archivedIds()
    return (Array.isArray(raw) ? raw : []).filter(
      (id): id is string => typeof id === 'string' && !tombstones.has(id),
    )
  }

  async function readPresetStates(
    sessionIds: readonly string[],
    headerById: ReadonlyMap<string, SessionHeader>,
  ): Promise<
    Map<string, { readonly id: string | null; readonly available: boolean | null; readonly broken: boolean }>
  > {
    let roster: Map<string, CleanerPreset> | null = null
    try {
      const presets = await ctx.agentPresets.list()
      roster = new Map(
        presets.map((preset) => [
          preset.id,
          {
            id: preset.id,
            name: preset.name,
            description: preset.description,
            trust: preset.trust,
            broken: preset.broken,
          },
        ]),
      )
    } catch (error) {
      console.error(`[dsh-session-cleaner] preset roster read failed: ${String(error)}`)
    }

    const entries = await Promise.all(
      sessionIds.map(async (sessionId) => {
        const header = headerById.get(sessionId)
        let presetId = header?.agentPreset ?? null
        if (header !== undefined) {
          try {
            const inspection = await ctx.sessionPersistence.inspect(sessionId as SessionId)
            presetId = resolveSessionPreset({ header: inspection.meta, events: inspection.events }) ?? null
          } catch (error) {
            console.error(`[dsh-session-cleaner] preset inspection failed (${sessionId}): ${String(error)}`)
          }
        }
        const preset = presetId === null ? undefined : roster?.get(presetId)
        return [
          sessionId,
          {
            id: presetId,
            available: roster === null || presetId === null ? null : preset !== undefined,
            broken: preset?.broken !== undefined,
          },
        ] as const
      }),
    )
    return new Map(entries)
  }

  async function handleList(): Promise<CleanerListResult> {
    // P0-7: list first, THEN snapshot the archive set, so a delete/restore that
    // commits during this await is reflected in `effective`.
    const headers = await ctx.sessionPersistence.list()
    const effective = readEffectiveArchivedIds()
    const headerById = new Map(headers.map((header) => [String(header.id), header]))
    const liveIds = new Set(ctx.sessions.list().map((session) => String(session.id)))
    const presetStates = await readPresetStates(effective, headerById)
    const groups = groupArchived(
      effective,
      headerById,
      readTitles(),
      ctx.workspaceRegistry.list(),
      liveIds,
      presetStates,
    )
    const total = groups.reduce((sum, group) => sum + group.sessions.length, 0)
    return { ok: true, groups, total }
  }

  async function handleDelete(rawBody: unknown): Promise<CleanerResponse> {
    const sessionId = bodySessionId(rawBody)
    if (sessionId === null) return { ok: false, reason: 'bad-id', message: '会话 id 格式无效' }
    if (tombstones.has(sessionId)) return { ok: false, reason: 'not-archived', message: '该对话已处理，请勿重复操作。' }

    return enqueueMutation(async () => {
      if (tombstones.has(sessionId)) {
        return { ok: false, reason: 'not-archived', message: '该对话已处理，请勿重复操作。' }
      }

      const read = readWorkspaceState()
      if (read === null) {
        return {
          ok: false,
          reason: 'write-failed',
          message: '无法读取工作区注册表（存储域与磁盘均不可用），已取消删除，请重试。',
        }
      }

      const durableArchived = read.state.global?.archivedSessionIds
      if (!Array.isArray(durableArchived)) {
        return { ok: false, reason: 'registry-unavailable', message: '工作区归档集合不可读，删除已取消。' }
      }
      if (!durableArchived.includes(sessionId)) {
        return archivedIds().includes(sessionId)
          ? { ok: false, reason: 'stale-registry', message: '内存态与持久态归档集合不一致，请重启 dsh 后重试。' }
          : { ok: false, reason: 'not-archived', message: '只能删除已归档的对话。' }
      }
      if (ctx.sessions.get(sessionId as SessionId)) {
        return {
          ok: false,
          reason: 'live',
          message: '该对话正在运行。请重启 dsh，且不要再次打开该对话，然后重试删除。',
        }
      }

      const headers = await ctx.sessionPersistence.list()
      const header = headers.find((candidate) => String(candidate.id) === sessionId)
      const location = header ? ctx.sessionPersistence.locate(header) : undefined
      if (header !== undefined && location?.path === undefined) {
        return {
          ok: false,
          reason: 'unsupported-backend',
          message: '当前会话存储后端不提供单文件日志，插件无法安全删除。',
        }
      }
      const projcacheSnapshot = readProjcacheSnapshot(sessionId)
      if (projcacheSnapshot === null) {
        return { ok: false, reason: 'write-failed', message: '无法读取投影缓存，删除已取消且未改动数据。' }
      }

      let quarantined: QuarantinedLog = { originalPath: '', quarantinePath: '', moved: false }
      if (location?.path) {
        const result = quarantineLog(location.path, sessionId)
        if (result === null) {
          return { ok: false, reason: 'write-failed', message: '无法隔离日志文件，删除已取消且未改动数据。' }
        }
        quarantined = result
      }

      // Quarantine is reversible. Recheck liveness immediately before the
      // durable commit to minimize the host's unavoidable no-session-lock race.
      if (ctx.sessions.get(sessionId as SessionId)) {
        const rollbackOk = restoreQuarantinedLog(quarantined)
        return rollbackOk
          ? { ok: false, reason: 'live', message: '该对话在排队期间变为运行中，删除已取消。' }
          : {
              ok: false,
              reason: 'partial',
              failedSteps: ['rollback'],
              message: '会话在排队期间变为运行中，且日志隔离回滚失败；请勿继续操作并检查隔离目录。',
            }
      }

      const workspaceCommit = await applyWorkspaceMutation(read, sessionId, 'delete')
      if (!workspaceCommit.ok) {
        const logRollbackOk = restoreQuarantinedLog(quarantined)
        const failedSteps: DeleteStep[] = ['registry']
        if (!workspaceCommit.rollbackOk || !logRollbackOk) failedSteps.push('rollback')
        console.info(`[dsh-session-cleaner] delete ${sessionId}: registry failed, rollback=${workspaceCommit.rollbackOk && logRollbackOk}`)
        return {
          ok: false,
          reason: 'partial',
          failedSteps,
          message:
            workspaceCommit.rollbackOk && logRollbackOk
              ? '工作区注册表更新失败；所有可见改动已回滚，可以重试。'
              : '工作区注册表更新失败，且回滚未完全成功；请先运行清理残留。',
        }
      }

      const projcacheUpdated = await removeProjcacheRow(sessionId, projcacheSnapshot.source)
      if (!projcacheUpdated) {
        const [registryRollbackOk, projcacheRollbackOk] = await Promise.all([
          workspaceCommit.rollback(),
          restoreProjcacheRow(sessionId, projcacheSnapshot),
        ])
        const logRollbackOk = restoreQuarantinedLog(quarantined)
        const failedSteps: DeleteStep[] = ['projcache']
        if (!registryRollbackOk || !projcacheRollbackOk || !logRollbackOk) failedSteps.push('rollback')
        console.info(
          `[dsh-session-cleaner] delete ${sessionId}: projcache failed, rollback=${registryRollbackOk && projcacheRollbackOk && logRollbackOk}`,
        )
        return {
          ok: false,
          reason: 'partial',
          failedSteps,
          message:
            registryRollbackOk && projcacheRollbackOk && logRollbackOk
              ? '投影缓存更新失败；所有可见改动已回滚，可以重试。'
              : '投影缓存更新失败，且回滚未完全成功；请先运行清理残留。',
        }
      }

      const purge = purgeQuarantinedLog(quarantined)
      markTombstone(sessionId, 'deleted')
      if (!purge.ok) {
        console.info(`[dsh-session-cleaner] delete ${sessionId}: committed, quarantine cleanup pending`)
        return {
          ok: false,
          reason: 'partial',
          failedSteps: ['log'],
          logError: purge.error,
          committed: true,
          message: '删除已经提交，但隔离日志尚未最终清理；请运行“清理残留”。',
        }
      }

      console.info(`[dsh-session-cleaner] delete ${sessionId}: committed`)
      return {
        ok: true,
        sessionId,
        action: 'delete',
        logRemoved: quarantined.moved,
        registryUpdated: true,
        projcacheUpdated: true,
        needsRestart: false,
        message: '已彻底删除日志文件、工作区席位与注册表条目。',
      }
    })
  }

  async function handleRestore(rawBody: unknown): Promise<CleanerResponse> {
    const sessionId = bodySessionId(rawBody)
    if (sessionId === null) return { ok: false, reason: 'bad-id', message: '会话 id 格式无效' }
    if (tombstones.has(sessionId)) return { ok: false, reason: 'not-archived', message: '该对话已处理，请勿重复操作。' }

    return enqueueMutation(async () => {
      if (tombstones.has(sessionId)) {
        return { ok: false, reason: 'not-archived', message: '该对话已处理，请勿重复操作。' }
      }
      const read = readWorkspaceState()
      if (read === null) {
        return {
          ok: false,
          reason: 'write-failed',
          message: '无法读取工作区注册表（存储域与磁盘均不可用），已取消恢复，请重试。',
        }
      }
      const durableArchived = read.state.global?.archivedSessionIds
      if (!Array.isArray(durableArchived)) {
        return { ok: false, reason: 'registry-unavailable', message: '工作区归档集合不可读，恢复已取消。' }
      }
      if (!durableArchived.includes(sessionId)) {
        return archivedIds().includes(sessionId)
          ? { ok: false, reason: 'stale-registry', message: '内存态与持久态归档集合不一致，请重启 dsh 后重试。' }
          : { ok: false, reason: 'not-archived', message: '该对话不在归档列表中。' }
      }
      const commit = await applyWorkspaceMutation(read, sessionId, 'restore')
      if (!commit.ok) {
        return commit.rollbackOk
          ? { ok: false, reason: 'write-failed', message: '恢复失败，注册表改动已回滚，可以重试。' }
          : {
              ok: false,
              reason: 'partial',
              failedSteps: ['registry', 'rollback'],
              message: '恢复失败，且注册表回滚未完全成功；请重启 dsh 后检查状态。',
            }
      }
      markTombstone(sessionId, 'restored')
      console.info(`[dsh-session-cleaner] restore ${sessionId}: committed`)
      return {
        ok: true,
        sessionId,
        action: 'restore',
        logRemoved: false,
        registryUpdated: true,
        projcacheUpdated: false,
        needsRestart: false,
        message: '已恢复（取消归档），该对话已回到原工作区。',
      }
    })
  }

  async function handlePresets(): Promise<CleanerResponse> {
    const presets: CleanerPreset[] = (await ctx.agentPresets.list()).map((preset) => ({
      id: preset.id,
      name: preset.name,
      description: preset.description,
      trust: preset.trust,
      broken: preset.broken,
    }))
    return { ok: true, presets }
  }

  async function handleContinue(rawBody: unknown): Promise<CleanerResponse> {
    const body = bodyContinue(rawBody)
    if (body === null) return { ok: false, reason: 'bad-request', message: 'sessionId 或 presetId 无效。' }
    const inflightKey = `${body.sessionId}\u0000${body.presetId}`
    const existing = continueInflight.get(inflightKey)
    if (existing !== undefined) return existing

    const operation = enqueueMutation(async (): Promise<CleanerResponse> => {
      const read = readWorkspaceState()
      if (read === null) {
        return { ok: false, reason: 'registry-unavailable', message: '无法读取工作区注册表，续接已取消。' }
      }
      const durableArchived = read.state.global?.archivedSessionIds
      if (!Array.isArray(durableArchived)) {
        return { ok: false, reason: 'registry-unavailable', message: '工作区归档集合不可读，续接已取消。' }
      }
      if (!durableArchived.includes(body.sessionId)) {
        return archivedIds().includes(body.sessionId)
          ? { ok: false, reason: 'stale-registry', message: '内存态与持久态归档集合不一致，请重启 dsh 后重试。' }
          : { ok: false, reason: 'not-archived', message: '只能从已归档对话创建续接会话。' }
      }
      if (ctx.sessions.get(body.sessionId as SessionId)) {
        return { ok: false, reason: 'live', message: '源对话正在运行，请重启 dsh 后再创建续接会话。' }
      }

      const roster = await ctx.agentPresets.list()
      const preset = roster.find((candidate) => candidate.id === body.presetId)
      if (preset === undefined) {
        return { ok: false, reason: 'unknown-preset', message: '目标预设不存在，请刷新预设列表后重试。' }
      }
      if (preset.broken !== undefined) {
        return { ok: false, reason: 'broken-preset', message: `目标预设不可用：${preset.broken}` }
      }

      let source: Awaited<ReturnType<typeof ctx.sessionPersistence.inspect>>
      try {
        source = await ctx.sessionPersistence.inspect(body.sessionId as SessionId)
      } catch (error) {
        console.error(`[dsh-session-cleaner] source inspection failed (${body.sessionId}): ${String(error)}`)
        return { ok: false, reason: 'source-unreadable', message: '无法读取源对话的完整、已闭合历史。' }
      }
      if (source.events.length === 0) {
        return { ok: false, reason: 'source-unreadable', message: '源对话没有可续接的持久历史。' }
      }

      const childSessionId = `session-${randomUUID()}` as SessionId
      const presetBoundary: SessionEvent<'agent-preset/selected'> = {
        type: 'agent-preset/selected',
        seq: source.events.length,
        time: Date.now(),
        data: { agentPreset: preset.id },
      }
      try {
        const handle = await ctx.agents.create({
          sessionId: childSessionId,
          seed: [...source.events, presetBoundary],
          meta: {
            cwd: source.meta.cwd,
            parentSession: body.sessionId as SessionId,
            seedLength: source.events.length,
            agentPreset: preset.id,
          },
          setup: async (agentCtx) => {
            await ctx.agentPresets.mount(agentCtx, preset.id)
          },
        })
        continuedHandles.set(childSessionId, handle)
      } catch (error) {
        console.error(`[dsh-session-cleaner] continuation create failed (${body.sessionId}): ${String(error)}`)
        return {
          ok: false,
          reason: 'create-failed',
          message: error instanceof Error ? error.message : String(error),
        }
      }

      let workspaceAttached = false
      const sourceWorkspace = ctx.workspaceRegistry
        .list()
        .find((workspace) => Array.isArray(workspace.sessionIds) && workspace.sessionIds.includes(body.sessionId as SessionId))
      if (sourceWorkspace !== undefined) {
        try {
          await sourceWorkspace.attachSession(childSessionId)
          workspaceAttached = true
        } catch (error) {
          console.error(`[dsh-session-cleaner] continuation workspace attach failed (${childSessionId}): ${String(error)}`)
        }
      }

      console.info(
        `[dsh-session-cleaner] continue ${body.sessionId} -> ${childSessionId}, preset=${preset.id}, attached=${workspaceAttached}`,
      )
      return {
        ok: true,
        action: 'continue',
        childSessionId,
        sourceSessionId: body.sessionId,
        presetId: preset.id,
        workspaceAttached,
        message: workspaceAttached
          ? '已用目标预设创建续接会话，原归档对话保持不变。'
          : '已用目标预设创建续接会话；工作区挂载失败，新会话将显示在未分组列表。',
      }
    })
    continueInflight.set(inflightKey, operation)
    void operation.then(
      () => continueInflight.delete(inflightKey),
      () => continueInflight.delete(inflightKey),
    )
    return operation
  }

  async function handleSweep(): Promise<CleanerResponse> {
    return enqueueMutation(async () => {
      const headers = await ctx.sessionPersistence.list()
      const headerIds = new Set(headers.map((header) => String(header.id)))
      const liveIds = new Set(ctx.sessions.list().map((session) => String(session.id)))
      const read = readWorkspaceState()
      if (read === null) {
        return { ok: false, reason: 'registry-unavailable', message: '无法读取工作区注册表，未执行任何清理。' }
      }
      const rawArchived = read.state.global?.archivedSessionIds
      if (!Array.isArray(rawArchived)) {
        return { ok: false, reason: 'registry-unavailable', message: '工作区归档集合不可读，未执行任何清理。' }
      }
      const archived = rawArchived.filter((id): id is string => typeof id === 'string')
      const workspaceIds = new Map<string, string[]>()
      for (const [workspaceId, record] of Object.entries(read.state.tables?.workspaces ?? {})) {
        if (record && Array.isArray(record.sessionIds)) {
          workspaceIds.set(workspaceId, record.sessionIds.filter((id): id is string => typeof id === 'string'))
        }
      }
      const projcacheIds = readProjcacheKeys()
      if (projcacheIds === null) {
        return { ok: false, reason: 'write-failed', message: '无法读取投影缓存，未执行任何清理。' }
      }
      const quarantineFiles = readQuarantineFiles()
      if (quarantineFiles === null) {
        return { ok: false, reason: 'write-failed', message: '无法读取隔离目录，未执行任何清理。' }
      }
      const plan = planSweep({ archivedIds: archived, headerIds, liveIds, workspaceSessionIds: workspaceIds, projcacheIds })
      const removedArchivedIds: string[] = []
      if (plan.archivedGhosts.length > 0) {
        const updated = await setWorkspaceGlobal(read.source, {
          ...read.state.global,
          archivedSessionIds: archived.filter((id) => !plan.archivedGhosts.includes(id)),
        })
        if (!updated) {
          return {
            ok: false,
            reason: 'partial',
            failedSteps: ['registry'],
            removedArchivedIds,
            removedProjcacheRows: [],
            removedWorkspaceSlots: 0,
            removedQuarantineFiles: 0,
            message: '归档幽灵写回失败，后续清理已停止。',
          }
        }
        removedArchivedIds.push(...plan.archivedGhosts)
        for (const id of plan.archivedGhosts) markTombstone(id, 'deleted')
      }

      let removedWorkspaceSlots = 0
      for (const [workspaceId, orphan] of plan.orphanSlotsByWorkspace) {
        if (!(await removeSessionsFromWorkspaceRecord(read.source, workspaceId, orphan))) {
          return {
            ok: false,
            reason: 'partial',
            failedSteps: ['workspace-slots'],
            removedArchivedIds,
            removedProjcacheRows: [],
            removedWorkspaceSlots,
            removedQuarantineFiles: 0,
            message: `工作区 ${workspaceId} 的孤儿席位清理失败，后续清理已停止。`,
          }
        }
        removedWorkspaceSlots += orphan.length
      }
      const removedProjcacheRows: string[] = []
      for (const id of plan.orphanProjcacheIds) {
        if (!(await removeProjcacheRow(id))) {
          return {
            ok: false,
            reason: 'partial',
            failedSteps: ['projcache'],
            removedArchivedIds,
            removedProjcacheRows,
            removedWorkspaceSlots,
            removedQuarantineFiles: 0,
            message: `投影缓存 ${id} 清理失败，后续清理已停止。`,
          }
        }
        removedProjcacheRows.push(id)
      }
      let removedQuarantineFiles = 0
      for (const filePath of quarantineFiles) {
        if (!purgeQuarantineFile(filePath)) {
          return {
            ok: false,
            reason: 'partial',
            failedSteps: ['quarantine'],
            removedArchivedIds,
            removedProjcacheRows,
            removedWorkspaceSlots,
            removedQuarantineFiles,
            message: '隔离日志清理失败，其余未处理隔离项已保留。',
          }
        }
        removedQuarantineFiles += 1
      }
      const total = removedArchivedIds.length + removedProjcacheRows.length + removedWorkspaceSlots + removedQuarantineFiles
      console.info(
        `[dsh-session-cleaner] sweep: archived=${removedArchivedIds.length}, slots=${removedWorkspaceSlots}, projcache=${removedProjcacheRows.length}, quarantine=${removedQuarantineFiles}`,
      )
      return {
        ok: true,
        removedArchivedIds,
        removedProjcacheRows,
        removedWorkspaceSlots,
        removedQuarantineFiles,
        message:
          total === 0
            ? '没有发现残留。'
            : `已清理 ${removedArchivedIds.length} 条归档幽灵、${removedProjcacheRows.length} 条孤儿缓存、${removedWorkspaceSlots} 个孤儿席位与 ${removedQuarantineFiles} 个隔离日志。`,
      }
    })
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    if (!pathname.startsWith(API_PREFIX)) {
      send(res, 404, { ok: false, reason: 'not-found', message: '未知端点' })
      return
    }
    if (!originAllowed(req)) {
      send(res, 403, { ok: false, reason: 'forbidden', message: '拒绝跨站请求' }, { vary: 'Origin' })
      return
    }
    const sub = pathname.slice(API_PREFIX.length)
    try {
      if (req.method === 'GET' && (sub === '' || sub === '/' || sub === '/list')) {
        send(res, 200, await handleList())
        return
      }
      if (req.method === 'GET' && sub === '/presets') {
        send(res, 200, await handlePresets())
        return
      }
      if (req.method === 'POST' && !mutationRequestAllowed(req)) {
        send(res, 403, { ok: false, reason: 'forbidden', message: '请求缺少同源操作凭据' }, { vary: 'Origin' })
        return
      }
      if (req.method === 'POST' && sub === '/delete') {
        const result = await handleDelete(await readJsonBody(req))
        send(res, statusFor(result), result)
        return
      }
      if (req.method === 'POST' && sub === '/restore') {
        const result = await handleRestore(await readJsonBody(req))
        send(res, statusFor(result), result)
        return
      }
      if (req.method === 'POST' && sub === '/continue') {
        const result = await handleContinue(await readJsonBody(req))
        send(res, statusFor(result), result)
        return
      }
      if (req.method === 'POST' && sub === '/sweep') {
        await readJsonBody(req)
        const result = await handleSweep()
        send(res, statusFor(result), result)
        return
      }
      send(res, 404, { ok: false, reason: 'not-found', message: '未知端点' })
    } catch (error) {
      if (error instanceof RequestBodyError) {
        send(res, error.status, { ok: false, reason: 'bad-request', message: error.message })
        return
      }
      send(res, 500, { ok: false, reason: 'internal', message: error instanceof Error ? error.message : String(error) })
    }
  }

  const runtime: CleanerRuntime = { tombstones, route }
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: API_PREFIX,
        handler: (req, res) => runtime.route(req, res),
      }),
    'dsh-session-cleaner: routes',
  )
  ctx.effect(
    () => async () => {
      const handles = [...continuedHandles.values()]
      continuedHandles.clear()
      await Promise.allSettled(handles.map((handle) => handle.dispose()))
    },
    'dsh-session-cleaner: continuation cleanup',
  )

  /** Titles from the projection cache, domain memory first; fail-soft. */
  function readTitles(): Map<string, string | null> {
    const result = new Map<string, string | null>()
    const collect = (sessions: Record<string, unknown> | undefined): void => {
      for (const [id, record] of Object.entries(sessions ?? {})) {
        const value = (record as { rows?: { title?: { val?: unknown } } } | undefined)?.rows?.title?.val
        result.set(id, typeof value === 'string' && value.length > 0 ? value : null)
      }
    }
    let domain: LooseDomain | undefined
    try {
      domain = domainOf('session_projcache')
    } catch {
      domain = undefined
    }
    if (domain !== undefined) {
      try {
        const sessions: Record<string, unknown> = {}
        for (const [key, value] of domain.table('sessions').entries()) sessions[key] = value
        collect(sessions)
        return result
      } catch {
        // fall through to the disk document
      }
    }
    try {
      const doc = JSON.parse(readFileSync(dshHomePath('storages', 'session_projcache.json'), 'utf8')) as {
        tables?: { sessions?: Record<string, unknown> }
      }
      collect(doc?.tables?.sessions)
    } catch {
      // Missing or unparseable cache: rows fall back to null titles.
    }
    return result
  }
}

function send(
  res: ServerResponse,
  status: number,
  value: unknown,
  extraHeaders: Readonly<Record<string, string>> = {},
): void {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...extraHeaders,
  })
  res.end(body)
}

function statusFor(result: CleanerResponse): number {
  if (result.ok) return 200
  switch (result.reason) {
    case 'bad-id':
    case 'bad-request':
    case 'unknown-preset':
      return 400
    case 'forbidden':
      return 403
    case 'not-found':
      return 404
    case 'not-archived':
    case 'live':
    case 'stale-registry':
    case 'broken-preset':
    case 'unsupported-backend':
      return 409
    default:
      return 500
  }
}

/** Same-origin browser guard: an Origin header must match the request Host. */
function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

function mutationRequestAllowed(req: IncomingMessage): boolean {
  if (req.headers[MUTATION_HEADER] !== '1') return false
  const site = req.headers['sec-fetch-site']
  return site === undefined || site === 'same-origin'
}

function bodySessionId(rawBody: unknown): string | null {
  if (typeof rawBody !== 'object' || rawBody === null) return null
  const sessionId = (rawBody as { sessionId?: unknown }).sessionId
  if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) return null
  return sessionId
}

function bodyContinue(rawBody: unknown): { sessionId: string; presetId: string } | null {
  if (typeof rawBody !== 'object' || rawBody === null) return null
  const body = rawBody as { sessionId?: unknown; presetId?: unknown }
  if (typeof body.sessionId !== 'string' || !SESSION_ID_PATTERN.test(body.sessionId)) return null
  if (typeof body.presetId !== 'string' || body.presetId.length < 1 || body.presetId.length > 128) return null
  return { sessionId: body.sessionId, presetId: body.presetId }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8')
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new RequestBodyError(413, '请求体超过 64KB 限制')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text === '') return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new RequestBodyError(400, '请求体不是有效的 JSON')
  }
}

/** Disk fallback: read a storage document, transform it, write it back atomically. */
function rewriteStorage(fileName: string, transform: (text: string) => string | null): boolean {
  const target = dshHomePath('storages', fileName)
  try {
    const next = transform(readFileSync(target, 'utf8'))
    if (next === null) return false
    writeAtomicSync(target, next)
    return true
  } catch {
    return false
  }
}

function writeAtomicSync(target: string, text: string): void {
  const tmp = `${target}.dsh-session-cleaner.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(tmp, text, 'utf8')
    renameSync(tmp, target)
  } finally {
    if (existsSync(tmp)) {
      try {
        rmSync(tmp)
      } catch {
        // The original write error is more useful than temp cleanup noise.
      }
    }
  }
}

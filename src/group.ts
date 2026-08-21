/**
 * Pure grouping logic for the archived-session panel: workspaces keep their
 * registry order, sessions keep their workspace-account order, and archived
 * ids no workspace accounts land in one trailing ungrouped bucket.
 * @module dsh-session-cleaner/src/group
 */
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import type { ArchivedGroup, ArchivedRow } from './types.ts'

function rowFor(
  sessionId: string,
  headerById: ReadonlyMap<string, SessionHeader>,
  titleById: ReadonlyMap<string, string | null>,
  liveIds: ReadonlySet<string>,
  presetById: ReadonlyMap<
    string,
    { readonly id: string | null; readonly available: boolean | null; readonly broken: boolean }
  >,
): ArchivedRow {
  const header = headerById.get(sessionId)
  const preset = presetById.get(sessionId)
  return {
    sessionId,
    title: titleById.get(sessionId) ?? null,
    createdAt: header?.createdAt ?? null,
    cwd: header?.cwd ?? null,
    live: liveIds.has(sessionId),
    logPresent: header !== undefined,
    agentPreset: preset?.id ?? null,
    presetAvailable: preset?.available ?? null,
    presetBroken: preset?.broken ?? false,
  }
}

/**
 * @param archivedIds - effective archive set (already tombstone-filtered).
 * @param headerById - persisted session headers keyed by id.
 * @param titleById - projection-cache titles keyed by id.
 * @param workspaces - registry workspaces in display order.
 * @param liveIds - ids currently owned by a live Session.
 */
export function groupArchived(
  archivedIds: readonly string[],
  headerById: ReadonlyMap<string, SessionHeader>,
  titleById: ReadonlyMap<string, string | null>,
  workspaces: readonly Workspace[],
  liveIds: ReadonlySet<string>,
  presetById: ReadonlyMap<
    string,
    { readonly id: string | null; readonly available: boolean | null; readonly broken: boolean }
  > = new Map(),
): ArchivedGroup[] {
  const groups: ArchivedGroup[] = []
  const accounted = new Set<string>()
  const archivedSet = new Set(archivedIds)
  for (const workspace of workspaces) {
    const rows: ArchivedRow[] = []
    const sessionIds: readonly unknown[] = Array.isArray(workspace.sessionIds) ? workspace.sessionIds : []
    for (const rawId of sessionIds) {
      if (typeof rawId !== 'string') continue
      const id = rawId
      if (!archivedSet.has(id)) continue
      accounted.add(id)
      rows.push(rowFor(id, headerById, titleById, liveIds, presetById))
    }
    if (rows.length > 0) {
      groups.push({
        workspace: { id: String(workspace.id), path: workspace.path, title: workspace.title },
        sessions: rows,
      })
    }
  }
  const ungrouped = archivedIds
    .filter((id) => !accounted.has(id))
    .map((id) => rowFor(id, headerById, titleById, liveIds, presetById))
  if (ungrouped.length > 0) groups.push({ workspace: null, sessions: ungrouped })
  return groups
}

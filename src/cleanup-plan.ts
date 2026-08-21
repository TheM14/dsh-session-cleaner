/** Pure sweep planning. No storage is touched here. */

export interface SweepPlanInput {
  readonly archivedIds: readonly string[]
  readonly headerIds: ReadonlySet<string>
  readonly liveIds: ReadonlySet<string>
  readonly workspaceSessionIds: ReadonlyMap<string, readonly string[]>
  readonly projcacheIds: readonly string[]
}

export interface SweepPlan {
  readonly archivedGhosts: readonly string[]
  readonly orphanSlotsByWorkspace: ReadonlyMap<string, readonly string[]>
  readonly orphanProjcacheIds: readonly string[]
}

export function planSweep(input: SweepPlanInput): SweepPlan {
  const archivedGhosts = input.archivedIds.filter(
    (id) => !input.headerIds.has(id) && !input.liveIds.has(id),
  )
  const effectiveArchived = new Set(input.archivedIds.filter((id) => !archivedGhosts.includes(id)))
  const orphanSlotsByWorkspace = new Map<string, string[]>()
  const remainingAccounted = new Set<string>()

  for (const [workspaceId, ids] of input.workspaceSessionIds) {
    const orphan: string[] = []
    for (const id of ids) {
      if (!input.headerIds.has(id) && !input.liveIds.has(id) && !effectiveArchived.has(id)) {
        orphan.push(id)
      } else {
        remainingAccounted.add(id)
      }
    }
    if (orphan.length > 0) orphanSlotsByWorkspace.set(workspaceId, orphan)
  }

  const orphanProjcacheIds = input.projcacheIds.filter(
    (id) => !input.headerIds.has(id) && !input.liveIds.has(id) && !remainingAccounted.has(id),
  )

  return { archivedGhosts, orphanSlotsByWorkspace, orphanProjcacheIds }
}

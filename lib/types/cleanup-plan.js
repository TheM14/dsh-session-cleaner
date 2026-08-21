/** Pure sweep planning. No storage is touched here. */
export function planSweep(input) {
    const archivedGhosts = input.archivedIds.filter((id) => !input.headerIds.has(id) && !input.liveIds.has(id));
    const effectiveArchived = new Set(input.archivedIds.filter((id) => !archivedGhosts.includes(id)));
    const orphanSlotsByWorkspace = new Map();
    const remainingAccounted = new Set();
    for (const [workspaceId, ids] of input.workspaceSessionIds) {
        const orphan = [];
        for (const id of ids) {
            if (!input.headerIds.has(id) && !input.liveIds.has(id) && !effectiveArchived.has(id)) {
                orphan.push(id);
            }
            else {
                remainingAccounted.add(id);
            }
        }
        if (orphan.length > 0)
            orphanSlotsByWorkspace.set(workspaceId, orphan);
    }
    const orphanProjcacheIds = input.projcacheIds.filter((id) => !input.headerIds.has(id) && !input.liveIds.has(id) && !remainingAccounted.has(id));
    return { archivedGhosts, orphanSlotsByWorkspace, orphanProjcacheIds };
}

function rowFor(sessionId, headerById, titleById, liveIds, presetById) {
    const header = headerById.get(sessionId);
    const preset = presetById.get(sessionId);
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
    };
}
/**
 * @param archivedIds - effective archive set (already tombstone-filtered).
 * @param headerById - persisted session headers keyed by id.
 * @param titleById - projection-cache titles keyed by id.
 * @param workspaces - registry workspaces in display order.
 * @param liveIds - ids currently owned by a live Session.
 */
export function groupArchived(archivedIds, headerById, titleById, workspaces, liveIds, presetById = new Map()) {
    const groups = [];
    const accounted = new Set();
    const archivedSet = new Set(archivedIds);
    for (const workspace of workspaces) {
        const rows = [];
        const sessionIds = Array.isArray(workspace.sessionIds) ? workspace.sessionIds : [];
        for (const rawId of sessionIds) {
            if (typeof rawId !== 'string')
                continue;
            const id = rawId;
            if (!archivedSet.has(id))
                continue;
            accounted.add(id);
            rows.push(rowFor(id, headerById, titleById, liveIds, presetById));
        }
        if (rows.length > 0) {
            groups.push({
                workspace: { id: String(workspace.id), path: workspace.path, title: workspace.title },
                sessions: rows,
            });
        }
    }
    const ungrouped = archivedIds
        .filter((id) => !accounted.has(id))
        .map((id) => rowFor(id, headerById, titleById, liveIds, presetById));
    if (ungrouped.length > 0)
        groups.push({ workspace: null, sessions: ungrouped });
    return groups;
}

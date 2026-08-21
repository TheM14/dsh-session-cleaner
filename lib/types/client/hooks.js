/**
 * Client-side data hook for the archived-session panel: a plain fetch-based
 * controller over the host's `/api/dsh-session-cleaner` routes, exposed as a
 * React hook so the footer slot keeps its face stable and testable.
 * @module dsh-session-cleaner/src/client/hooks
 */
import { useCallback, useEffect, useRef, useState } from 'react';
const INITIAL = {
    loading: true,
    error: null,
    groups: [],
    total: 0,
    notice: null,
    restored: [],
    presets: [],
    presetsLoading: true,
    presetsError: null,
};
export async function cleanerFetch(path, body) {
    try {
        const init = body === undefined
            ? { cache: 'no-store' }
            : {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-dsh-session-cleaner': '1' },
                body: JSON.stringify(body),
            };
        const response = await fetch(`/api/dsh-session-cleaner${path}`, init);
        if (!response.ok) {
            const failure = (await response.json().catch(() => null));
            return failure ?? { ok: false, reason: 'internal', message: `HTTP ${response.status}` };
        }
        return (await response.json());
    }
    catch (error) {
        return { ok: false, reason: 'internal', message: error instanceof Error ? error.message : String(error) };
    }
}
/** Remove one session from the groups and hand the removed row back. */
function takeSession(groups, sessionId) {
    let row = null;
    const next = [];
    for (const group of groups) {
        const found = group.sessions.find((candidate) => candidate.sessionId === sessionId);
        if (found !== undefined) {
            row = found;
            const sessions = group.sessions.filter((candidate) => candidate.sessionId !== sessionId);
            if (sessions.length > 0)
                next.push({ ...group, sessions });
        }
        else {
            next.push(group);
        }
    }
    return { groups: next, row };
}
export function useArchived() {
    const [state, setState] = useState(INITIAL);
    // Monotonic request sequence: a refresh only applies when it is still the
    // newest request; every mutation bumps it so a stale `/list` issued before
    // the mutation can never resurrect a just-deleted/restored row (P0-7).
    const requestSeq = useRef(0);
    // Pending mutations (M-2): the ref is the synchronous double-click guard; the
    // state mirrors it so the panel can disable buttons.
    const pendingRef = useRef(new Set());
    const [pendingIds, setPendingIds] = useState(() => new Set());
    const sweepingRef = useRef(false);
    const [sweeping, setSweeping] = useState(false);
    const refresh = useCallback(async () => {
        const seq = ++requestSeq.current;
        setState((current) => ({ ...current, loading: true, error: null }));
        const result = await cleanerFetch('/list');
        if (seq !== requestSeq.current)
            return; // superseded by a newer refresh or mutation
        if (!result.ok) {
            setState((current) => ({ ...current, loading: false, error: result.message ?? '加载失败' }));
            return;
        }
        const total = result.groups.reduce((sum, group) => sum + group.sessions.length, 0);
        setState((current) => ({ ...current, loading: false, error: null, groups: result.groups, total }));
    }, []);
    const refreshPresets = useCallback(async () => {
        setState((current) => ({ ...current, presetsLoading: true, presetsError: null }));
        const result = await cleanerFetch('/presets');
        if (!result.ok) {
            setState((current) => ({
                ...current,
                presetsLoading: false,
                presetsError: result.message ?? '预设加载失败',
            }));
            return;
        }
        setState((current) => ({ ...current, presetsLoading: false, presetsError: null, presets: result.presets }));
    }, []);
    useEffect(() => {
        void refresh();
        void refreshPresets();
    }, [refresh, refreshPresets]);
    const act = useCallback(async (path, sessionId) => {
        if (pendingRef.current.has(sessionId))
            return false; // double-click guard
        pendingRef.current.add(sessionId);
        setPendingIds(new Set(pendingRef.current));
        requestSeq.current += 1; // invalidate in-flight refreshes before we mutate
        setState((current) => ({ ...current, notice: null }));
        try {
            const result = await cleanerFetch(path, { sessionId });
            if (!result.ok) {
                requestSeq.current += 1; // let a later refresh reconcile
                setState((current) => {
                    const taken = result.committed ? takeSession(current.groups, sessionId) : null;
                    const groups = taken?.groups ?? current.groups;
                    return {
                        ...current,
                        groups,
                        total: groups.reduce((sum, group) => sum + group.sessions.length, 0),
                        notice: {
                            kind: 'error',
                            reason: result.reason,
                            failedSteps: result.failedSteps,
                            logError: result.logError,
                            committed: result.committed,
                            text: result.message,
                        },
                    };
                });
                return result.committed === true;
            }
            requestSeq.current += 1; // invalidate refreshes started while this mutation was in flight
            setState((current) => {
                const { groups, row } = takeSession(current.groups, sessionId);
                const total = groups.reduce((sum, group) => sum + group.sessions.length, 0);
                return {
                    ...current,
                    groups,
                    total,
                    notice: { kind: 'success', action: result.action, text: result.message },
                    // The official sidebar updates immediately; retain a short local
                    // action history so the completed operation remains easy to verify.
                    restored: path === '/restore' && row !== null ? [row, ...current.restored].slice(0, 20) : current.restored,
                };
            });
            return true;
        }
        finally {
            pendingRef.current.delete(sessionId);
            setPendingIds(new Set(pendingRef.current));
        }
    }, []);
    const remove = useCallback((sessionId) => act('/delete', sessionId), [act]);
    const restore = useCallback((sessionId) => act('/restore', sessionId), [act]);
    const continueWithPreset = useCallback(async (sessionId, presetId) => {
        if (pendingRef.current.has(sessionId))
            return false;
        pendingRef.current.add(sessionId);
        setPendingIds(new Set(pendingRef.current));
        setState((current) => ({ ...current, notice: null }));
        try {
            const result = await cleanerFetch('/continue', { sessionId, presetId });
            if (!result.ok) {
                setState((current) => ({
                    ...current,
                    notice: { kind: 'error', reason: result.reason, text: result.message },
                }));
                return false;
            }
            setState((current) => ({
                ...current,
                notice: {
                    kind: 'success',
                    action: 'continue',
                    childSessionId: result.childSessionId,
                    presetId: result.presetId,
                    workspaceAttached: result.workspaceAttached,
                    text: result.message,
                },
            }));
            return true;
        }
        finally {
            pendingRef.current.delete(sessionId);
            setPendingIds(new Set(pendingRef.current));
        }
    }, []);
    const sweep = useCallback(async () => {
        if (sweepingRef.current)
            return false;
        sweepingRef.current = true;
        setSweeping(true);
        requestSeq.current += 1; // invalidate in-flight refreshes before sweeping
        setState((current) => ({ ...current, notice: null }));
        try {
            const result = await cleanerFetch('/sweep', {});
            if (!result.ok) {
                setState((current) => ({
                    ...current,
                    notice: {
                        kind: 'error',
                        reason: result.reason,
                        failedSteps: result.failedSteps,
                        archived: result.removedArchivedIds?.length,
                        projcache: result.removedProjcacheRows?.length,
                        slots: result.removedWorkspaceSlots,
                        quarantine: result.removedQuarantineFiles,
                        text: result.message,
                    },
                }));
                return false;
            }
            setState((current) => ({
                ...current,
                notice: {
                    kind: 'success',
                    action: 'sweep',
                    archived: result.removedArchivedIds.length,
                    projcache: result.removedProjcacheRows.length,
                    slots: result.removedWorkspaceSlots,
                    quarantine: result.removedQuarantineFiles,
                    text: result.message,
                },
            }));
            await refresh();
            return true;
        }
        finally {
            sweepingRef.current = false;
            setSweeping(false);
        }
    }, [refresh]);
    const dismissNotice = useCallback(() => setState((current) => ({ ...current, notice: null })), []);
    return {
        state,
        pendingIds,
        sweeping,
        refresh,
        refreshPresets,
        remove,
        restore,
        continueWithPreset,
        sweep,
        dismissNotice,
    };
}

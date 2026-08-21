/**
 * Pure, testable text transforms for the two durable registry documents.
 * Every transform is text-in → text-out (or null when the input is not a
 * parseable JSON document) so the logic can be unit-tested without a host.
 * @module dsh-session-cleaner/src/registry-edit
 */
/**
 * Remove `sessionId` from an id list. Non-array values are preserved verbatim
 * (never collapsed to `[]`), and an array that does not contain the id is
 * returned as-is so callers can detect "no change" by reference identity.
 */
function filterId(list, sessionId) {
    if (!Array.isArray(list))
        return list;
    if (!list.includes(sessionId))
        return list;
    return list.filter((item) => item !== sessionId);
}
/** Deep-clone a parsed storage document so domain values are never mutated in place. */
function clone(value) {
    return JSON.parse(JSON.stringify(value));
}
/**
 * Pure object-level transform for the workspace domain's global state.
 * `delete` removes the id from the archive set AND every workspace account;
 * `restore` removes it from the archive set only, keeping the workspace slot.
 * The input is deep-cloned first (the storage domain forbids in-place
 * mutation of stored values).
 *
 * @returns a NEW state object, or null when the input is not a usable shape.
 */
export function filterWorkspaceState(state, sessionId, mode) {
    if (typeof state !== 'object' || state === null)
        return null;
    const next = clone(state);
    let changed = false;
    const global = next.global;
    if (global && 'archivedSessionIds' in global) {
        const before = global.archivedSessionIds;
        const after = filterId(before, sessionId);
        if (after !== before) {
            global.archivedSessionIds = after;
            changed = true;
        }
    }
    if (mode === 'delete') {
        const workspaces = next.tables?.workspaces;
        if (workspaces) {
            for (const record of Object.values(workspaces)) {
                if (record && 'sessionIds' in record) {
                    const before = record.sessionIds;
                    const after = filterId(before, sessionId);
                    if (after !== before) {
                        record.sessionIds = after;
                        changed = true;
                    }
                }
            }
        }
    }
    // Nothing actually changed (id absent, or fields were non-array): signal
    // "no-op" so callers skip a pointless whole-state write.
    return changed ? next : null;
}
/**
 * Rewrite the workspace registry document (`storages/workspace.json`).
 *
 * @param text - current document text.
 * @param sessionId - session to remove.
 * @param mode - `delete` removes the id from the global archive set AND from
 *   every workspace's sessionIds account; `restore` removes it from the
 *   archive set only, keeping its workspace slot so an unarchive restores the
 *   original position.
 * @returns the rewritten document text, or null when the input is invalid.
 */
export function workspaceJsonAfter(text, sessionId, mode) {
    let doc;
    try {
        doc = JSON.parse(text);
    }
    catch {
        return null;
    }
    const global = doc?.global;
    if (global && 'archivedSessionIds' in global) {
        global.archivedSessionIds = filterId(global.archivedSessionIds, sessionId);
    }
    if (mode === 'delete') {
        const workspaces = doc?.tables?.workspaces;
        if (workspaces) {
            for (const record of Object.values(workspaces)) {
                if (record && 'sessionIds' in record)
                    record.sessionIds = filterId(record.sessionIds, sessionId);
            }
        }
    }
    return `${JSON.stringify(doc, null, 2)}\n`;
}
/**
 * Rewrite the projection-cache document (`storages/session_projcache.json`)
 * by dropping the session's row (title, stats, token usage…).
 *
 * @returns the rewritten document text, or null when the input is invalid.
 */
export function projcacheJsonAfter(text, sessionId) {
    let doc;
    try {
        doc = JSON.parse(text);
    }
    catch {
        return null;
    }
    const sessions = doc?.tables?.sessions;
    if (sessions && typeof sessions === 'object')
        delete sessions[sessionId];
    return `${JSON.stringify(doc, null, 2)}\n`;
}

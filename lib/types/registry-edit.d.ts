/**
 * Pure, testable text transforms for the two durable registry documents.
 * Every transform is text-in → text-out (or null when the input is not a
 * parseable JSON document) so the logic can be unit-tested without a host.
 * @module dsh-session-cleaner/src/registry-edit
 */
interface WorkspaceStateShape {
    global?: {
        archivedSessionIds?: unknown;
    };
    tables?: {
        workspaces?: Record<string, {
            sessionIds?: unknown;
        }>;
    };
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
export declare function filterWorkspaceState(state: unknown, sessionId: string, mode: 'delete' | 'restore'): WorkspaceStateShape | null;
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
export declare function workspaceJsonAfter(text: string, sessionId: string, mode: 'delete' | 'restore'): string | null;
/**
 * Rewrite the projection-cache document (`storages/session_projcache.json`)
 * by dropping the session's row (title, stats, token usage…).
 *
 * @returns the rewritten document text, or null when the input is invalid.
 */
export declare function projcacheJsonAfter(text: string, sessionId: string): string | null;
export {};

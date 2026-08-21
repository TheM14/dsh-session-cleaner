/**
 * Pure grouping logic for the archived-session panel: workspaces keep their
 * registry order, sessions keep their workspace-account order, and archived
 * ids no workspace accounts land in one trailing ungrouped bucket.
 * @module dsh-session-cleaner/src/group
 */
import type { SessionHeader } from '@deepseek-ai/dsh-session';
import type { Workspace } from '@deepseek-ai/dsh-workspace';
import type { ArchivedGroup } from './types.ts';
/**
 * @param archivedIds - effective archive set (already tombstone-filtered).
 * @param headerById - persisted session headers keyed by id.
 * @param titleById - projection-cache titles keyed by id.
 * @param workspaces - registry workspaces in display order.
 * @param liveIds - ids currently owned by a live Session.
 */
export declare function groupArchived(archivedIds: readonly string[], headerById: ReadonlyMap<string, SessionHeader>, titleById: ReadonlyMap<string, string | null>, workspaces: readonly Workspace[], liveIds: ReadonlySet<string>, presetById?: ReadonlyMap<string, {
    readonly id: string | null;
    readonly available: boolean | null;
    readonly broken: boolean;
}>): ArchivedGroup[];

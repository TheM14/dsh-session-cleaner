import type { ArchivedGroup, ArchivedRow, CleanerFailure, CleanerFailureReason, CleanerPreset, DeleteStep } from '../types.ts';
/**
 * Structured outcome of an operation; the panel localizes it through `t()`
 * (the host's own `message` is only a fallback for unrecognized cases).
 */
export interface Notice {
    readonly kind: 'success' | 'error';
    /** Failure reason (errors); localized by the panel. */
    readonly reason?: CleanerFailureReason;
    /** Delete steps that failed (partial deletes). */
    readonly failedSteps?: readonly DeleteStep[];
    /** Raw error text for the log-removal step (partial deletes). */
    readonly logError?: string;
    /** The logical delete committed even though final cleanup reported an error. */
    readonly committed?: boolean;
    /** Action that produced a success notice. */
    readonly action?: 'delete' | 'restore' | 'sweep' | 'continue';
    /** Sweep success counts. */
    readonly archived?: number;
    readonly projcache?: number;
    readonly slots?: number;
    readonly quarantine?: number;
    readonly childSessionId?: string;
    readonly presetId?: string;
    readonly workspaceAttached?: boolean;
    /** Untranslated fallback text (host message or network error). */
    readonly text?: string;
}
export interface ArchivedState {
    readonly loading: boolean;
    readonly error: string | null;
    readonly groups: readonly ArchivedGroup[];
    readonly total: number;
    readonly notice: Notice | null;
    /** Rows restored in this panel session; retained briefly as an action history. */
    readonly restored: readonly ArchivedRow[];
    readonly presets: readonly CleanerPreset[];
    readonly presetsLoading: boolean;
    readonly presetsError: string | null;
}
export declare function cleanerFetch<T>(path: string, body?: unknown): Promise<T | CleanerFailure>;
export interface UseArchivedResult {
    readonly state: ArchivedState;
    /** Session ids with an in-flight delete/restore; the panel disables their buttons. */
    readonly pendingIds: ReadonlySet<string>;
    /** Whether a sweep is in flight. */
    readonly sweeping: boolean;
    readonly refresh: () => Promise<void>;
    readonly refreshPresets: () => Promise<void>;
    readonly remove: (sessionId: string) => Promise<boolean>;
    readonly restore: (sessionId: string) => Promise<boolean>;
    readonly continueWithPreset: (sessionId: string, presetId: string) => Promise<boolean>;
    readonly sweep: () => Promise<boolean>;
    readonly dismissNotice: () => void;
}
export declare function useArchived(): UseArchivedResult;

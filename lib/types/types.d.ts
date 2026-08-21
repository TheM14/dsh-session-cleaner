/**
 * Shared wire vocabulary for the dsh-session-cleaner HTTP API.
 * Host produces these shapes; the Web panel consumes them.
 * @module dsh-session-cleaner/src/types
 */
/** One archived conversation row shown in the panel. */
export interface ArchivedRow {
    /** Session id, e.g. `session-<uuid>`. */
    readonly sessionId: string;
    /** Human title from the projection cache, or null when absent. */
    readonly title: string | null;
    /** Created-at epoch milliseconds, or null when the log is already gone. */
    readonly createdAt: number | null;
    /** Working directory the session was created in, or null. */
    readonly cwd: string | null;
    /** Whether a live Session owns this id right now (another tab is open). */
    readonly live: boolean;
    /** Whether the durable session log still exists. */
    readonly logPresent: boolean;
    /** Effective preset after folding any logged blank-session selection. */
    readonly agentPreset: string | null;
    /** Null when the roster could not be read. */
    readonly presetAvailable: boolean | null;
    /** Whether the roster entry exists but cannot be mounted. */
    readonly presetBroken: boolean;
}
/** A workspace bucket; `workspace: null` is the ungrouped bucket. */
export interface ArchivedGroup {
    readonly workspace: {
        readonly id: string;
        readonly path: string;
        readonly title: string;
    } | null;
    readonly sessions: readonly ArchivedRow[];
}
/** GET /list response body. */
export interface CleanerListResult {
    readonly ok: true;
    readonly groups: readonly ArchivedGroup[];
    readonly total: number;
}
/** POST /delete or /restore response body (success). */
export interface CleanerActionResult {
    readonly ok: true;
    readonly sessionId: string;
    /** 'delete' or 'restore' */
    readonly action: 'delete' | 'restore';
    /** True when the durable log file was removed (delete only). */
    readonly logRemoved: boolean;
    /** True when the workspace registry state was updated (domain or disk). */
    readonly registryUpdated: boolean;
    /** True when the session's projection-cache row was removed (domain or disk). */
    readonly projcacheUpdated: boolean;
    /** Whether the caller must restart dsh before the result becomes effective. */
    readonly needsRestart: boolean;
    /** True when deletion committed but quarantined log cleanup is deferred to sweep. */
    readonly cleanupPending?: boolean;
    /** Human-facing outcome text. */
    readonly message: string;
}
/** POST /sweep response body: leftover cleanup of ghost entries and orphan rows. */
export interface CleanerSweepResult {
    readonly ok: true;
    /** Ghost archive-set ids removed (no durable log behind them). */
    readonly removedArchivedIds: readonly string[];
    /** Orphan projection-cache rows removed. */
    readonly removedProjcacheRows: readonly string[];
    /** Orphan workspace-slot ids removed (no log, no live owner, not archived). */
    readonly removedWorkspaceSlots: number;
    /** Quarantined log files permanently removed. */
    readonly removedQuarantineFiles: number;
    /** Untranslated fallback text; the Web panel localizes from the structured fields. */
    readonly message: string;
}
export interface CleanerPreset {
    readonly id: string;
    readonly name?: string;
    readonly description?: string;
    readonly trust: 'system' | 'user';
    readonly broken?: string;
}
export interface PresetListResult {
    readonly ok: true;
    readonly presets: readonly CleanerPreset[];
}
export interface CleanerContinueResult {
    readonly ok: true;
    readonly action: 'continue';
    readonly childSessionId: string;
    readonly sourceSessionId: string;
    readonly presetId: string;
    readonly workspaceAttached: boolean;
    readonly message: string;
}
/** Machine-readable failure reasons; the Web panel localizes them by key. */
export type CleanerFailureReason = 'bad-id' | 'not-archived' | 'live' | 'forbidden' | 'not-found' | 'internal' | 'partial' | 'write-failed' | 'bad-request' | 'stale-registry' | 'registry-unavailable' | 'unknown-preset' | 'broken-preset' | 'source-unreadable' | 'create-failed' | 'unsupported-backend';
/** A mutation step that can fail independently. */
export type CleanerStep = 'registry' | 'workspace-slots' | 'projcache' | 'log' | 'rollback' | 'quarantine';
/** Backwards-compatible name used by the client notice model. */
export type DeleteStep = CleanerStep;
/** Shared failure shape. */
export interface CleanerFailure {
    readonly ok: false;
    readonly reason: CleanerFailureReason;
    /** Untranslated fallback text; the Web panel localizes from `reason`. */
    readonly message?: string;
    /** Which mutation steps failed (only when `reason` is `partial`). */
    readonly failedSteps?: readonly CleanerStep[];
    /** Raw error text for the log-removal step (only when `reason` is `partial`). */
    readonly logError?: string;
    /** The logical delete committed; only quarantined-file cleanup remains. */
    readonly committed?: boolean;
    /** Partial sweep progress, when available. */
    readonly removedArchivedIds?: readonly string[];
    readonly removedProjcacheRows?: readonly string[];
    readonly removedWorkspaceSlots?: number;
    readonly removedQuarantineFiles?: number;
}
export type CleanerResponse = CleanerListResult | CleanerActionResult | CleanerSweepResult | PresetListResult | CleanerContinueResult | CleanerFailure;
/** Session-id shape guard: session-<8-4-4-4-12 lowercase hex>. */
export declare const SESSION_ID_PATTERN: RegExp;

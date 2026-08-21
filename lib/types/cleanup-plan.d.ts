/** Pure sweep planning. No storage is touched here. */
export interface SweepPlanInput {
    readonly archivedIds: readonly string[];
    readonly headerIds: ReadonlySet<string>;
    readonly liveIds: ReadonlySet<string>;
    readonly workspaceSessionIds: ReadonlyMap<string, readonly string[]>;
    readonly projcacheIds: readonly string[];
}
export interface SweepPlan {
    readonly archivedGhosts: readonly string[];
    readonly orphanSlotsByWorkspace: ReadonlyMap<string, readonly string[]>;
    readonly orphanProjcacheIds: readonly string[];
}
export declare function planSweep(input: SweepPlanInput): SweepPlan;

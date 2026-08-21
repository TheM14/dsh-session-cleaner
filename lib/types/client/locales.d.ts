/**
 * Locale dictionaries for the dsh-session-cleaner panel.
 * @module dsh-session-cleaner/src/client/locales
 */
export declare const NS = "dsh-session-cleaner";
export declare const zh: {
    'footer.label': string;
    'panel.title': string;
    'panel.loading': string;
    'panel.error': string;
    'panel.empty': string;
    'panel.retry': string;
    'group.ungrouped': string;
    'row.noTitle': string;
    'row.live': string;
    'row.liveHint': string;
    'row.noLog': string;
    'row.preset': string;
    'row.noPreset': string;
    'row.presetMissing': string;
    'row.presetBroken': string;
    'menu.delete': string;
    'menu.restore': string;
    'continue.select': string;
    'continue.button': string;
    'continue.confirm.title': string;
    'continue.confirm.body': string;
    'continue.confirm.confirm': string;
    'preset.system': string;
    'preset.user': string;
    'preset.loading': string;
    'preset.loadFailed': string;
    'confirm.title': string;
    'confirm.body': string;
    'confirm.cancel': string;
    'confirm.confirm': string;
    'restored.section': string;
    'restored.hint': string;
    'sweep.button': string;
    'sweep.running': string;
    'panel.hint': string;
    'notice.deleted': string;
    'notice.restored': string;
    'notice.continued': string;
    'notice.continuedUngrouped': string;
    'notice.sweep.none': string;
    'notice.sweep.done': string;
    'banner.close': string;
    'error.badId': string;
    'error.notArchived': string;
    'error.live': string;
    'error.forbidden': string;
    'error.notFound': string;
    'error.internal': string;
    'error.unsupportedBackend': string;
    'error.writeFailed': string;
    'error.badRequest': string;
    'error.staleRegistry': string;
    'error.registryUnavailable': string;
    'error.unknownPreset': string;
    'error.brokenPreset': string;
    'error.sourceUnreadable': string;
    'error.createFailed': string;
    'error.partial': string;
    'error.partialCommitted': string;
    'error.partialSteps.registry': string;
    'error.partialSteps.workspaceSlots': string;
    'error.partialSteps.projcache': string;
    'error.partialSteps.log': string;
    'error.partialSteps.rollback': string;
    'error.partialSteps.quarantine': string;
};
/** Translation keys owned by the dsh-session-cleaner namespace. */
export type SessionCleanerKey = keyof typeof zh;
export declare const en: Record<SessionCleanerKey, string>;
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        'dsh-session-cleaner': SessionCleanerKey;
    }
}

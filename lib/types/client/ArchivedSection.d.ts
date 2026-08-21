import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { UseArchivedResult } from './hooks.ts';
export interface ArchivedSectionFace {
    useArchived: () => UseArchivedResult;
    /** Refresh the official sidebar session list so deleted rows drop immediately. */
    refreshSessionList: () => void;
    /** Active dsh locale id, for date formatting. */
    localeId: () => string;
}
/** Composed props of the `settings.section` slot + locale + inject face. */
export type ArchivedSectionProps = PropsRuntime<'settings.section'> & InjectFace<ArchivedSectionFace> & PropsLocale<'dsh-session-cleaner'>;
export declare function ArchivedSettingsSection({ useArchived, refreshSessionList, localeId, t }: ArchivedSectionProps): import("react").JSX.Element;

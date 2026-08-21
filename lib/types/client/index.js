import { ArchivedSettingsSection } from "./ArchivedSection.js";
import { useArchived } from "./hooks.js";
import { en, NS, zh } from "./locales.js";
/** Client-side services this entry waits for. */
export const inject = ['slots', 'locale', 'sessions'];
export function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-session-cleaner: locale');
    const t = ctx.locale.bind(NS);
    // Track the one-shot retry timers so they can be cleared on dispose/HMR
    // instead of firing into a torn-down composition.
    const pendingTimeouts = new Set();
    ctx.effect(() => () => {
        for (const id of pendingTimeouts)
            window.clearTimeout(id);
        pendingTimeouts.clear();
    }, 'dsh-session-cleaner: timeout cleanup');
    // After a deletion the host broadcasts archive/workspace frames, but the
    // official session-list row only drops on a list refresh. The client
    // runtime exposes `refresh()` on `ctx.sessions` (delegating to the session
    // manager's refreshList); probe both spellings so a version skew never
    // silently no-ops again.
    const refreshSessionList = () => {
        const sessions = ctx.sessions;
        const candidate = sessions?.refresh ?? sessions?.refreshList;
        if (typeof candidate !== 'function')
            return;
        const fn = candidate;
        const run = () => {
            void fn.call(sessions).catch(() => { });
        };
        run();
        // One delayed retry as insurance against transient transport hiccups.
        const id = window.setTimeout(() => {
            pendingTimeouts.delete(id);
            run();
        }, 1000);
        pendingTimeouts.add(id);
    };
    const localeId = () => String(ctx.locale.getLocale().active);
    ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'dsh-session-cleaner',
        order: 50,
        label: () => t('panel.title'),
        locale: NS,
        inject: () => ({ useArchived, refreshSessionList, localeId }),
    }, ArchivedSettingsSection));
}

/**
 * dsh-session-cleaner Web client half: one additive Settings section
 * (`settings.section`, the same seat every official settings page uses) that
 * lists archived conversations grouped by workspace, with inline restore /
 * delete actions, a sweep button for leftovers, and theme-token-only styling.
 * @module dsh-session-cleaner/client
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { ArchivedSettingsSection } from './ArchivedSection.tsx'
import { useArchived } from './hooks.ts'
import { en, NS, zh } from './locales.ts'

/** Client-side services this entry waits for. */
export const inject = ['slots', 'locale', 'sessions']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-session-cleaner: locale')
  const t = ctx.locale.bind(NS)

  // Track the one-shot retry timers so they can be cleared on dispose/HMR
  // instead of firing into a torn-down composition.
  const pendingTimeouts = new Set<number>()
  ctx.effect(
    () => () => {
      for (const id of pendingTimeouts) window.clearTimeout(id)
      pendingTimeouts.clear()
    },
    'dsh-session-cleaner: timeout cleanup',
  )

  // After a deletion the host broadcasts archive/workspace frames, but the
  // official session-list row only drops on a list refresh. The client
  // runtime exposes `refresh()` on `ctx.sessions` (delegating to the session
  // manager's refreshList); probe both spellings so a version skew never
  // silently no-ops again.
  const refreshSessionList = (): void => {
    const sessions = ctx.sessions as unknown as
      | { refresh?: unknown; refreshList?: unknown }
      | undefined
    const candidate = sessions?.refresh ?? sessions?.refreshList
    if (typeof candidate !== 'function') return
    const fn = candidate as () => Promise<unknown>
    const run = (): void => {
      void fn.call(sessions).catch(() => {})
    }
    run()
    // One delayed retry as insurance against transient transport hiccups.
    const id = window.setTimeout(() => {
      pendingTimeouts.delete(id)
      run()
    }, 1000)
    pendingTimeouts.add(id)
  }

  const localeId = (): string => String(ctx.locale.getLocale().active)

  ctx.slots.inject(
    'settings.section',
    () =>
      ctx.slots.register(
        {
          name: 'settings.section',
          id: 'dsh-session-cleaner',
          order: 50,
          label: () => t('panel.title'),
          locale: NS,
          inject: () => ({ useArchived, refreshSessionList, localeId }),
        },
        ArchivedSettingsSection,
      ),
  )
}

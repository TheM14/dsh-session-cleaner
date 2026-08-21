/**
 * dsh-session-cleaner Web client half: one additive Settings section
 * (`settings.section`, the same seat every official settings page uses) that
 * lists archived conversations grouped by workspace, with inline restore /
 * delete actions, a sweep button for leftovers, and theme-token-only styling.
 * @module dsh-session-cleaner/client
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
/** Client-side services this entry waits for. */
export declare const inject: string[];
export declare function apply(ctx: ClientContext): void;

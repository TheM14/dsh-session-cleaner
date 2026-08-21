/**
 * Shared wire vocabulary for the dsh-session-cleaner HTTP API.
 * Host produces these shapes; the Web panel consumes them.
 * @module dsh-session-cleaner/src/types
 */
/** Session-id shape guard: session-<8-4-4-4-12 lowercase hex>. */
export const SESSION_ID_PATTERN = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

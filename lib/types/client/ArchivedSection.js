import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * The archived-session Settings section: grouped list with inline restore /
 * delete actions, a deletion confirm, result banners, and the sweep button.
 * Styling sticks to the `--dsw-alias-*` semantic tokens only — no custom
 * backgrounds — so the official settings chrome (and any registered theme)
 * owns readability.
 * @module dsh-session-cleaner/src/client/ArchivedSection
 */
import { Fragment, useEffect, useRef, useState } from 'react';
/** Failure reason → locale key. */
const ERROR_KEY = {
    'bad-id': 'error.badId',
    'not-archived': 'error.notArchived',
    live: 'error.live',
    forbidden: 'error.forbidden',
    'not-found': 'error.notFound',
    internal: 'error.internal',
    partial: 'error.partial',
    'write-failed': 'error.writeFailed',
    'bad-request': 'error.badRequest',
    'stale-registry': 'error.staleRegistry',
    'registry-unavailable': 'error.registryUnavailable',
    'unknown-preset': 'error.unknownPreset',
    'broken-preset': 'error.brokenPreset',
    'source-unreadable': 'error.sourceUnreadable',
    'create-failed': 'error.createFailed',
    'unsupported-backend': 'error.unsupportedBackend',
};
/** Partial-delete step → locale key. */
const STEP_KEY = {
    registry: 'error.partialSteps.registry',
    'workspace-slots': 'error.partialSteps.workspaceSlots',
    projcache: 'error.partialSteps.projcache',
    log: 'error.partialSteps.log',
    rollback: 'error.partialSteps.rollback',
    quarantine: 'error.partialSteps.quarantine',
};
/** Localize a structured operation notice; host `message` is only a fallback. */
function noticeText(notice, t) {
    if (notice.kind === 'error') {
        if (notice.reason === 'partial') {
            const steps = (notice.failedSteps ?? []).map((step) => t(STEP_KEY[step]));
            let text = t(notice.committed ? 'error.partialCommitted' : 'error.partial', { steps: steps.join(', ') });
            if (notice.logError)
                text += ` (${notice.logError})`;
            return text;
        }
        if (notice.reason !== undefined)
            return t(ERROR_KEY[notice.reason]);
        return notice.text ?? t('error.internal');
    }
    if (notice.action === 'delete')
        return t('notice.deleted');
    if (notice.action === 'restore')
        return t('notice.restored');
    if (notice.action === 'continue') {
        return t(notice.workspaceAttached ? 'notice.continued' : 'notice.continuedUngrouped', {
            id: notice.childSessionId ?? '',
            preset: notice.presetId ?? '',
        });
    }
    if (notice.action === 'sweep') {
        const total = (notice.archived ?? 0) + (notice.projcache ?? 0) + (notice.slots ?? 0) + (notice.quarantine ?? 0);
        if (total === 0)
            return t('notice.sweep.none');
        return t('notice.sweep.done', {
            archived: notice.archived ?? 0,
            projcache: notice.projcache ?? 0,
            slots: notice.slots ?? 0,
            quarantine: notice.quarantine ?? 0,
        });
    }
    return notice.text ?? '';
}
function formatTime(epochMs, localeId) {
    try {
        return new Date(epochMs).toLocaleString(localeId);
    }
    catch {
        return String(epochMs);
    }
}
const CSS = `
.dsc-sec { display:flex; flex-direction:column; gap:14px; padding:4px 0 14px; }
.dsc-group { display:flex; flex-direction:column; gap:6px; }
.dsc-group-head { display:flex; align-items:baseline; gap:8px; padding:2px 2px 6px; }
.dsc-group-title { font-size:13px; font-weight:600; color:var(--dsw-alias-label-primary, #f8fafc); }
.dsc-group-path { font-size:11px; color:var(--dsw-alias-label-tertiary, #64748b); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsc-row { display:flex; align-items:flex-start; gap:10px; padding:8px 10px; border:1px solid var(--dsw-alias-border-l1, rgba(148,163,184,.12)); border-radius:8px; }
.dsc-row-main { flex:1; min-width:0; display:flex; flex-direction:column; gap:3px; }
.dsc-row-title { font-size:13px; color:var(--dsw-alias-label-primary, #f8fafc); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsc-row-meta { display:flex; align-items:center; gap:8px; font-size:11px; color:var(--dsw-alias-label-tertiary, #94a3b8); }
.dsc-row-meta em { font-style:normal; padding:0 6px; border-radius:6px; background:var(--dsw-alias-state-business-tertiary, #164e63); color:var(--dsw-alias-state-business-primary, #67e8f9); }
.dsc-preset { display:flex; align-items:center; flex-wrap:wrap; gap:6px; min-width:0; font-size:11px; color:var(--dsw-alias-label-secondary, #cbd5e1); }
.dsc-preset-bad { color:var(--dsw-alias-state-danger, #f87171); }
.dsc-continue { display:flex; align-items:center; gap:6px; margin-top:4px; min-width:0; }
.dsc-select { min-width:0; max-width:240px; height:28px; border:1px solid var(--dsw-alias-border-l2, rgba(148,163,184,.2)); border-radius:6px; background:var(--dsw-alias-bg-layer-2, #0f172a); color:var(--dsw-alias-label-primary, #f8fafc); font-size:12px; padding:0 6px; }
.dsc-select:focus-visible { outline:2px solid var(--dsw-alias-state-business-primary, #67e8f9); outline-offset:2px; }
.dsc-row-dim { opacity:.62; }
.dsc-row-actions { display:flex; gap:6px; flex-shrink:0; }
.dsc-btn { border:1px solid var(--dsw-alias-border-l2, rgba(148,163,184,.2)); background:transparent; color:var(--dsw-alias-label-primary, #f8fafc); font-size:12px; padding:5px 10px; border-radius:8px; cursor:pointer; }
.dsc-btn:hover { background:var(--dsw-alias-interactive-bg-hover, rgba(148,163,184,.12)); }
.dsc-btn:focus-visible { outline:2px solid var(--dsw-alias-state-business-primary, #67e8f9); outline-offset:2px; }
.dsc-btn:disabled { opacity:.5; cursor:not-allowed; }
.dsc-btn:disabled:hover { background:transparent; }
.dsc-btn.danger { border-color:color-mix(in srgb, var(--dsw-alias-state-danger, #f87171) 40%, transparent); color:var(--dsw-alias-state-danger, #f87171); }
.dsc-btn.danger:hover { background:color-mix(in srgb, var(--dsw-alias-state-danger, #f87171) 12%, transparent); }
.dsc-btn.danger:disabled:hover { background:transparent; }
.dsc-banner { display:flex; align-items:flex-start; gap:8px; padding:10px 12px; border-radius:8px; font-size:13px; line-height:1.5; }
.dsc-banner span { flex:1; }
.dsc-banner-success { border:1px solid color-mix(in srgb, var(--dsw-alias-state-success, #4ade80) 35%, transparent); background:color-mix(in srgb, var(--dsw-alias-state-success, #4ade80) 12%, transparent); color:var(--dsw-alias-state-success, #4ade80); }
.dsc-banner-error { border:1px solid color-mix(in srgb, var(--dsw-alias-state-danger, #f87171) 35%, transparent); background:color-mix(in srgb, var(--dsw-alias-state-danger, #f87171) 12%, transparent); color:var(--dsw-alias-state-danger, #f87171); }
.dsc-close { border:0; background:transparent; color:inherit; cursor:pointer; font-size:16px; line-height:1; padding:0 2px; }
.dsc-close:focus-visible { outline:2px solid var(--dsw-alias-state-business-primary, #67e8f9); outline-offset:2px; }
.dsc-state { padding:14px 4px; font-size:13px; color:var(--dsw-alias-label-tertiary, #94a3b8); text-align:center; }
.dsc-error { color:var(--dsw-alias-state-danger, #f87171); }
.dsc-foot { display:flex; align-items:center; justify-content:space-between; gap:10px; border-top:1px solid var(--dsw-alias-border-l1, rgba(148,163,184,.12)); padding-top:12px; font-size:11px; color:var(--dsw-alias-label-tertiary, #94a3b8); }
.dsc-confirm { position:fixed; inset:0; z-index:1600; display:flex; align-items:center; justify-content:center; background:color-mix(in srgb, var(--dsw-alias-bg-base, #020617) 55%, transparent); }
.dsc-confirm-box { width:min(360px, calc(100vw - 40px)); padding:16px; border:1px solid var(--dsw-alias-border-l2, rgba(148,163,184,.2)); border-radius:8px; background:var(--dsw-alias-bg-layer-2, #0f172a); box-shadow:0 24px 80px rgba(0,0,0,.5); }
.dsc-confirm-title { font-size:14px; font-weight:600; color:var(--dsw-alias-label-primary, #f8fafc); margin-bottom:8px; }
.dsc-confirm-body { font-size:13px; color:var(--dsw-alias-label-secondary, #cbd5e1); margin-bottom:14px; word-break:break-all; }
.dsc-confirm-actions { display:flex; justify-content:flex-end; gap:8px; }
@media (max-width: 640px) { .dsc-row { flex-direction:column; } .dsc-row-actions { width:100%; justify-content:flex-end; } .dsc-continue { align-items:stretch; flex-direction:column; } .dsc-select { max-width:none; width:100%; } }
`;
export function ArchivedSettingsSection({ useArchived, refreshSessionList, localeId, t }) {
    const archived = useArchived();
    const [confirming, setConfirming] = useState(null);
    const [selectedPresets, setSelectedPresets] = useState({});
    const { state } = archived;
    const cancelRef = useRef(null);
    const confirmRef = useRef(null);
    // Keep the liveness badges fresh while the section is mounted; skip while
    // the page is hidden, and refresh immediately when it becomes visible again.
    useEffect(() => {
        const timer = window.setInterval(() => {
            if (document.visibilityState === 'hidden')
                return;
            void archived.refresh();
        }, 10000);
        const onVisible = () => {
            if (document.visibilityState === 'visible')
                void archived.refresh();
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            window.clearInterval(timer);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [archived.refresh]);
    // Confirm dialog keyboard handling: Escape closes, Tab is trapped inside,
    // and focus is restored to the previously focused element on close.
    useEffect(() => {
        if (confirming === null)
            return;
        const lastFocused = document.activeElement;
        cancelRef.current?.focus();
        const onKey = (event) => {
            if (event.key === 'Escape') {
                setConfirming(null);
                return;
            }
            if (event.key !== 'Tab')
                return;
            const buttons = [cancelRef.current, confirmRef.current].filter(Boolean);
            if (buttons.length === 0)
                return;
            const first = buttons[0];
            const last = buttons[buttons.length - 1];
            const active = document.activeElement;
            if (event.shiftKey) {
                if (active === first || !buttons.includes(active)) {
                    event.preventDefault();
                    last.focus();
                }
            }
            else if (active === last || !buttons.includes(active)) {
                event.preventDefault();
                first.focus();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('keydown', onKey);
            lastFocused?.focus();
        };
    }, [confirming]);
    return (_jsxs(Fragment, { children: [_jsx("style", { children: CSS }), _jsxs("div", { className: "dsc-sec", children: [state.notice !== null ? (_jsxs("div", { className: state.notice.kind === 'success' ? 'dsc-banner dsc-banner-success' : 'dsc-banner dsc-banner-error', role: state.notice.kind === 'success' ? 'status' : 'alert', "aria-live": state.notice.kind === 'success' ? 'polite' : 'assertive', children: [_jsx("span", { children: noticeText(state.notice, t) }), _jsx("button", { type: "button", className: "dsc-close", "aria-label": t('banner.close'), onClick: () => archived.dismissNotice(), children: "\u00D7" })] })) : null, state.restored.length > 0 ? (_jsxs("div", { className: "dsc-group", children: [_jsx("div", { className: "dsc-group-head", children: _jsx("span", { className: "dsc-group-title", children: t('restored.section') }) }), state.restored.map((row) => (_jsx("div", { className: "dsc-row dsc-row-dim", children: _jsxs("div", { className: "dsc-row-main", children: [_jsx("span", { className: "dsc-row-title", title: row.title ?? row.sessionId, children: row.title ?? t('row.noTitle') }), _jsx("span", { className: "dsc-row-meta", children: t('restored.hint') })] }) }, row.sessionId)))] })) : null, state.error !== null ? (_jsxs("div", { className: "dsc-state dsc-error", children: [t('panel.error'), "\uFF1A", state.error, _jsx("div", { style: { marginTop: 8 }, children: _jsx("button", { type: "button", className: "dsc-btn", onClick: () => void archived.refresh(), children: t('panel.retry') }) })] })) : state.loading && state.total === 0 ? (_jsx("div", { className: "dsc-state", children: t('panel.loading') })) : state.total === 0 ? (_jsx("div", { className: "dsc-state", children: t('panel.empty') })) : (state.groups.map((group) => (_jsxs("div", { className: "dsc-group", children: [_jsxs("div", { className: "dsc-group-head", children: [_jsx("span", { className: "dsc-group-title", children: group.workspace === null ? t('group.ungrouped') : group.workspace.title }), group.workspace !== null ? _jsx("span", { className: "dsc-group-path", title: group.workspace.path, children: group.workspace.path }) : null] }), group.sessions.map((row) => {
                                const pending = archived.pendingIds.has(row.sessionId);
                                const busy = archived.sweeping || pending;
                                const mountablePresets = state.presets.filter((preset) => preset.broken === undefined);
                                const selectedId = selectedPresets[row.sessionId] ??
                                    mountablePresets.find((preset) => preset.id === row.agentPreset)?.id ??
                                    mountablePresets[0]?.id ??
                                    '';
                                const selectedPreset = mountablePresets.find((preset) => preset.id === selectedId);
                                const systemPresets = state.presets.filter((preset) => preset.trust === 'system');
                                const userPresets = state.presets.filter((preset) => preset.trust === 'user');
                                return (_jsxs("div", { className: "dsc-row", children: [_jsxs("div", { className: "dsc-row-main", children: [_jsx("span", { className: "dsc-row-title", title: row.title ?? row.sessionId, children: row.title ?? t('row.noTitle') }), _jsxs("span", { className: "dsc-row-meta", children: [row.live ? _jsx("em", { children: t('row.live') }) : null, !row.logPresent ? _jsx("em", { children: t('row.noLog') }) : null, row.createdAt !== null ? _jsx("span", { children: formatTime(row.createdAt, localeId()) }) : null] }), _jsxs("span", { className: "dsc-preset", children: [row.agentPreset === null ? t('row.noPreset') : t('row.preset', { preset: row.agentPreset }), row.presetAvailable === false ? _jsx("strong", { className: "dsc-preset-bad", children: t('row.presetMissing') }) : null, row.presetBroken ? _jsx("strong", { className: "dsc-preset-bad", children: t('row.presetBroken') }) : null] }), _jsxs("div", { className: "dsc-continue", children: [_jsxs("select", { className: "dsc-select", "aria-label": t('continue.select'), value: selectedId, disabled: busy || state.presetsLoading || state.presets.length === 0, onChange: (event) => setSelectedPresets((current) => ({ ...current, [row.sessionId]: event.target.value })), children: [state.presetsLoading ? _jsx("option", { value: "", children: t('preset.loading') }) : null, state.presetsError !== null ? _jsx("option", { value: "", children: t('preset.loadFailed') }) : null, systemPresets.length > 0 ? (_jsx("optgroup", { label: t('preset.system'), children: systemPresets.map((preset) => (_jsxs("option", { value: preset.id, disabled: preset.broken !== undefined, children: [preset.name ?? preset.id, preset.broken !== undefined ? ` (${t('row.presetBroken')})` : ''] }, preset.id))) })) : null, userPresets.length > 0 ? (_jsx("optgroup", { label: t('preset.user'), children: userPresets.map((preset) => (_jsxs("option", { value: preset.id, disabled: preset.broken !== undefined, children: [preset.name ?? preset.id, preset.broken !== undefined ? ` (${t('row.presetBroken')})` : ''] }, preset.id))) })) : null] }), _jsx("button", { type: "button", className: "dsc-btn", disabled: busy || row.live || selectedPreset === undefined, title: row.live ? t('row.liveHint') : undefined, onClick: () => {
                                                                if (selectedPreset !== undefined)
                                                                    setConfirming({ kind: 'continue', row, preset: selectedPreset });
                                                            }, children: t('continue.button') })] })] }), _jsxs("div", { className: "dsc-row-actions", children: [_jsx("button", { type: "button", className: "dsc-btn", disabled: busy, onClick: () => void archived.restore(row.sessionId), children: t('menu.restore') }), _jsx("button", { type: "button", className: "dsc-btn danger", disabled: busy || row.live, title: row.live ? t('row.liveHint') : undefined, onClick: () => setConfirming({ kind: 'delete', row }), children: t('menu.delete') })] })] }, row.sessionId));
                            })] }, group.workspace?.id ?? 'ungrouped')))), _jsxs("div", { className: "dsc-foot", children: [_jsx("span", { children: t('panel.hint') }), _jsx("button", { type: "button", className: "dsc-btn", disabled: archived.sweeping, onClick: () => {
                                    void archived.sweep().then((ok) => {
                                        if (ok)
                                            refreshSessionList();
                                    });
                                }, children: archived.sweeping ? t('sweep.running') : t('sweep.button') })] })] }), confirming !== null ? (_jsx("div", { className: "dsc-confirm", role: "dialog", "aria-modal": "true", "aria-labelledby": "dsc-confirm-title", onMouseDown: () => setConfirming(null), children: _jsxs("div", { className: "dsc-confirm-box", onMouseDown: (event) => event.stopPropagation(), children: [_jsx("div", { className: "dsc-confirm-title", id: "dsc-confirm-title", children: confirming.kind === 'delete' ? t('confirm.title') : t('continue.confirm.title') }), _jsx("div", { className: "dsc-confirm-body", children: confirming.kind === 'delete'
                                ? t('confirm.body', { title: confirming.row.title ?? confirming.row.sessionId })
                                : t('continue.confirm.body', {
                                    title: confirming.row.title ?? confirming.row.sessionId,
                                    preset: confirming.preset.name ?? confirming.preset.id,
                                }) }), _jsxs("div", { className: "dsc-confirm-actions", children: [_jsx("button", { type: "button", className: "dsc-btn", ref: cancelRef, onClick: () => setConfirming(null), children: t('confirm.cancel') }), _jsx("button", { type: "button", className: "dsc-btn danger", ref: confirmRef, onClick: () => {
                                        const action = confirming;
                                        setConfirming(null);
                                        if (action.kind === 'delete') {
                                            void archived.remove(action.row.sessionId).then((ok) => {
                                                if (ok)
                                                    refreshSessionList();
                                            });
                                        }
                                        else {
                                            void archived.continueWithPreset(action.row.sessionId, action.preset.id).then((ok) => {
                                                if (ok)
                                                    refreshSessionList();
                                            });
                                        }
                                    }, children: confirming.kind === 'delete' ? t('confirm.confirm') : t('continue.confirm.confirm') })] })] }) })) : null] }));
}

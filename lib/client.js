window.__ModuleLoader__.load({ id: "dsh-session-cleaner", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
//#region rolldown:runtime
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));

//#endregion
let react_jsx_runtime = require("react/jsx-runtime");
react_jsx_runtime = __toESM(react_jsx_runtime);
let react = require("react");
react = __toESM(react);

//#region lib/types/client/ArchivedSection.js
/** Failure reason → locale key. */
const ERROR_KEY = {
	"bad-id": "error.badId",
	"not-archived": "error.notArchived",
	live: "error.live",
	forbidden: "error.forbidden",
	"not-found": "error.notFound",
	internal: "error.internal",
	partial: "error.partial",
	"write-failed": "error.writeFailed",
	"bad-request": "error.badRequest",
	"stale-registry": "error.staleRegistry",
	"registry-unavailable": "error.registryUnavailable",
	"unknown-preset": "error.unknownPreset",
	"broken-preset": "error.brokenPreset",
	"source-unreadable": "error.sourceUnreadable",
	"create-failed": "error.createFailed",
	"unsupported-backend": "error.unsupportedBackend"
};
/** Partial-delete step → locale key. */
const STEP_KEY = {
	registry: "error.partialSteps.registry",
	"workspace-slots": "error.partialSteps.workspaceSlots",
	projcache: "error.partialSteps.projcache",
	log: "error.partialSteps.log",
	rollback: "error.partialSteps.rollback",
	quarantine: "error.partialSteps.quarantine"
};
/** Localize a structured operation notice; host `message` is only a fallback. */
function noticeText(notice, t) {
	if (notice.kind === "error") {
		if (notice.reason === "partial") {
			const steps = (notice.failedSteps ?? []).map((step) => t(STEP_KEY[step]));
			let text = t(notice.committed ? "error.partialCommitted" : "error.partial", { steps: steps.join(", ") });
			if (notice.logError) text += ` (${notice.logError})`;
			return text;
		}
		if (notice.reason !== void 0) return t(ERROR_KEY[notice.reason]);
		return notice.text ?? t("error.internal");
	}
	if (notice.action === "delete") return t("notice.deleted");
	if (notice.action === "restore") return t("notice.restored");
	if (notice.action === "continue") return t(notice.workspaceAttached ? "notice.continued" : "notice.continuedUngrouped", {
		id: notice.childSessionId ?? "",
		preset: notice.presetId ?? ""
	});
	if (notice.action === "sweep") {
		if ((notice.archived ?? 0) + (notice.projcache ?? 0) + (notice.slots ?? 0) + (notice.quarantine ?? 0) === 0) return t("notice.sweep.none");
		return t("notice.sweep.done", {
			archived: notice.archived ?? 0,
			projcache: notice.projcache ?? 0,
			slots: notice.slots ?? 0,
			quarantine: notice.quarantine ?? 0
		});
	}
	return notice.text ?? "";
}
function formatTime(epochMs, localeId) {
	try {
		return new Date(epochMs).toLocaleString(localeId);
	} catch {
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
function ArchivedSettingsSection({ useArchived: useArchived$1, refreshSessionList, localeId, t }) {
	const archived = useArchived$1();
	const [confirming, setConfirming] = (0, react.useState)(null);
	const [selectedPresets, setSelectedPresets] = (0, react.useState)({});
	const { state } = archived;
	const cancelRef = (0, react.useRef)(null);
	const confirmRef = (0, react.useRef)(null);
	(0, react.useEffect)(() => {
		const timer = window.setInterval(() => {
			if (document.visibilityState === "hidden") return;
			archived.refresh();
		}, 1e4);
		const onVisible = () => {
			if (document.visibilityState === "visible") archived.refresh();
		};
		document.addEventListener("visibilitychange", onVisible);
		return () => {
			window.clearInterval(timer);
			document.removeEventListener("visibilitychange", onVisible);
		};
	}, [archived.refresh]);
	(0, react.useEffect)(() => {
		if (confirming === null) return;
		const lastFocused = document.activeElement;
		cancelRef.current?.focus();
		const onKey = (event) => {
			if (event.key === "Escape") {
				setConfirming(null);
				return;
			}
			if (event.key !== "Tab") return;
			const buttons = [cancelRef.current, confirmRef.current].filter(Boolean);
			if (buttons.length === 0) return;
			const first = buttons[0];
			const last = buttons[buttons.length - 1];
			const active = document.activeElement;
			if (event.shiftKey) {
				if (active === first || !buttons.includes(active)) {
					event.preventDefault();
					last.focus();
				}
			} else if (active === last || !buttons.includes(active)) {
				event.preventDefault();
				first.focus();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => {
			window.removeEventListener("keydown", onKey);
			lastFocused?.focus();
		};
	}, [confirming]);
	return (0, react_jsx_runtime.jsxs)(react.Fragment, { children: [
		(0, react_jsx_runtime.jsx)("style", { children: CSS }),
		(0, react_jsx_runtime.jsxs)("div", {
			className: "dsc-sec",
			children: [
				state.notice !== null ? (0, react_jsx_runtime.jsxs)("div", {
					className: state.notice.kind === "success" ? "dsc-banner dsc-banner-success" : "dsc-banner dsc-banner-error",
					role: state.notice.kind === "success" ? "status" : "alert",
					"aria-live": state.notice.kind === "success" ? "polite" : "assertive",
					children: [(0, react_jsx_runtime.jsx)("span", { children: noticeText(state.notice, t) }), (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dsc-close",
						"aria-label": t("banner.close"),
						onClick: () => archived.dismissNotice(),
						children: "×"
					})]
				}) : null,
				state.restored.length > 0 ? (0, react_jsx_runtime.jsxs)("div", {
					className: "dsc-group",
					children: [(0, react_jsx_runtime.jsx)("div", {
						className: "dsc-group-head",
						children: (0, react_jsx_runtime.jsx)("span", {
							className: "dsc-group-title",
							children: t("restored.section")
						})
					}), state.restored.map((row) => (0, react_jsx_runtime.jsx)("div", {
						className: "dsc-row dsc-row-dim",
						children: (0, react_jsx_runtime.jsxs)("div", {
							className: "dsc-row-main",
							children: [(0, react_jsx_runtime.jsx)("span", {
								className: "dsc-row-title",
								title: row.title ?? row.sessionId,
								children: row.title ?? t("row.noTitle")
							}), (0, react_jsx_runtime.jsx)("span", {
								className: "dsc-row-meta",
								children: t("restored.hint")
							})]
						})
					}, row.sessionId))]
				}) : null,
				state.error !== null ? (0, react_jsx_runtime.jsxs)("div", {
					className: "dsc-state dsc-error",
					children: [
						t("panel.error"),
						"：",
						state.error,
						(0, react_jsx_runtime.jsx)("div", {
							style: { marginTop: 8 },
							children: (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsc-btn",
								onClick: () => void archived.refresh(),
								children: t("panel.retry")
							})
						})
					]
				}) : state.loading && state.total === 0 ? (0, react_jsx_runtime.jsx)("div", {
					className: "dsc-state",
					children: t("panel.loading")
				}) : state.total === 0 ? (0, react_jsx_runtime.jsx)("div", {
					className: "dsc-state",
					children: t("panel.empty")
				}) : state.groups.map((group) => (0, react_jsx_runtime.jsxs)("div", {
					className: "dsc-group",
					children: [(0, react_jsx_runtime.jsxs)("div", {
						className: "dsc-group-head",
						children: [(0, react_jsx_runtime.jsx)("span", {
							className: "dsc-group-title",
							children: group.workspace === null ? t("group.ungrouped") : group.workspace.title
						}), group.workspace !== null ? (0, react_jsx_runtime.jsx)("span", {
							className: "dsc-group-path",
							title: group.workspace.path,
							children: group.workspace.path
						}) : null]
					}), group.sessions.map((row) => {
						const pending = archived.pendingIds.has(row.sessionId);
						const busy = archived.sweeping || pending;
						const mountablePresets = state.presets.filter((preset) => preset.broken === void 0);
						const selectedId = selectedPresets[row.sessionId] ?? mountablePresets.find((preset) => preset.id === row.agentPreset)?.id ?? mountablePresets[0]?.id ?? "";
						const selectedPreset = mountablePresets.find((preset) => preset.id === selectedId);
						const systemPresets = state.presets.filter((preset) => preset.trust === "system");
						const userPresets = state.presets.filter((preset) => preset.trust === "user");
						return (0, react_jsx_runtime.jsxs)("div", {
							className: "dsc-row",
							children: [(0, react_jsx_runtime.jsxs)("div", {
								className: "dsc-row-main",
								children: [
									(0, react_jsx_runtime.jsx)("span", {
										className: "dsc-row-title",
										title: row.title ?? row.sessionId,
										children: row.title ?? t("row.noTitle")
									}),
									(0, react_jsx_runtime.jsxs)("span", {
										className: "dsc-row-meta",
										children: [
											row.live ? (0, react_jsx_runtime.jsx)("em", { children: t("row.live") }) : null,
											!row.logPresent ? (0, react_jsx_runtime.jsx)("em", { children: t("row.noLog") }) : null,
											row.createdAt !== null ? (0, react_jsx_runtime.jsx)("span", { children: formatTime(row.createdAt, localeId()) }) : null
										]
									}),
									(0, react_jsx_runtime.jsxs)("span", {
										className: "dsc-preset",
										children: [
											row.agentPreset === null ? t("row.noPreset") : t("row.preset", { preset: row.agentPreset }),
											row.presetAvailable === false ? (0, react_jsx_runtime.jsx)("strong", {
												className: "dsc-preset-bad",
												children: t("row.presetMissing")
											}) : null,
											row.presetBroken ? (0, react_jsx_runtime.jsx)("strong", {
												className: "dsc-preset-bad",
												children: t("row.presetBroken")
											}) : null
										]
									}),
									(0, react_jsx_runtime.jsxs)("div", {
										className: "dsc-continue",
										children: [(0, react_jsx_runtime.jsxs)("select", {
											className: "dsc-select",
											"aria-label": t("continue.select"),
											value: selectedId,
											disabled: busy || state.presetsLoading || state.presets.length === 0,
											onChange: (event) => setSelectedPresets((current) => ({
												...current,
												[row.sessionId]: event.target.value
											})),
											children: [
												state.presetsLoading ? (0, react_jsx_runtime.jsx)("option", {
													value: "",
													children: t("preset.loading")
												}) : null,
												state.presetsError !== null ? (0, react_jsx_runtime.jsx)("option", {
													value: "",
													children: t("preset.loadFailed")
												}) : null,
												systemPresets.length > 0 ? (0, react_jsx_runtime.jsx)("optgroup", {
													label: t("preset.system"),
													children: systemPresets.map((preset) => (0, react_jsx_runtime.jsxs)("option", {
														value: preset.id,
														disabled: preset.broken !== void 0,
														children: [preset.name ?? preset.id, preset.broken !== void 0 ? ` (${t("row.presetBroken")})` : ""]
													}, preset.id))
												}) : null,
												userPresets.length > 0 ? (0, react_jsx_runtime.jsx)("optgroup", {
													label: t("preset.user"),
													children: userPresets.map((preset) => (0, react_jsx_runtime.jsxs)("option", {
														value: preset.id,
														disabled: preset.broken !== void 0,
														children: [preset.name ?? preset.id, preset.broken !== void 0 ? ` (${t("row.presetBroken")})` : ""]
													}, preset.id))
												}) : null
											]
										}), (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "dsc-btn",
											disabled: busy || row.live || selectedPreset === void 0,
											title: row.live ? t("row.liveHint") : void 0,
											onClick: () => {
												if (selectedPreset !== void 0) setConfirming({
													kind: "continue",
													row,
													preset: selectedPreset
												});
											},
											children: t("continue.button")
										})]
									})
								]
							}), (0, react_jsx_runtime.jsxs)("div", {
								className: "dsc-row-actions",
								children: [(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsc-btn",
									disabled: busy,
									onClick: () => void archived.restore(row.sessionId),
									children: t("menu.restore")
								}), (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsc-btn danger",
									disabled: busy || row.live,
									title: row.live ? t("row.liveHint") : void 0,
									onClick: () => setConfirming({
										kind: "delete",
										row
									}),
									children: t("menu.delete")
								})]
							})]
						}, row.sessionId);
					})]
				}, group.workspace?.id ?? "ungrouped")),
				(0, react_jsx_runtime.jsxs)("div", {
					className: "dsc-foot",
					children: [(0, react_jsx_runtime.jsx)("span", { children: t("panel.hint") }), (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dsc-btn",
						disabled: archived.sweeping,
						onClick: () => {
							archived.sweep().then((ok) => {
								if (ok) refreshSessionList();
							});
						},
						children: archived.sweeping ? t("sweep.running") : t("sweep.button")
					})]
				})
			]
		}),
		confirming !== null ? (0, react_jsx_runtime.jsx)("div", {
			className: "dsc-confirm",
			role: "dialog",
			"aria-modal": "true",
			"aria-labelledby": "dsc-confirm-title",
			onMouseDown: () => setConfirming(null),
			children: (0, react_jsx_runtime.jsxs)("div", {
				className: "dsc-confirm-box",
				onMouseDown: (event) => event.stopPropagation(),
				children: [
					(0, react_jsx_runtime.jsx)("div", {
						className: "dsc-confirm-title",
						id: "dsc-confirm-title",
						children: confirming.kind === "delete" ? t("confirm.title") : t("continue.confirm.title")
					}),
					(0, react_jsx_runtime.jsx)("div", {
						className: "dsc-confirm-body",
						children: confirming.kind === "delete" ? t("confirm.body", { title: confirming.row.title ?? confirming.row.sessionId }) : t("continue.confirm.body", {
							title: confirming.row.title ?? confirming.row.sessionId,
							preset: confirming.preset.name ?? confirming.preset.id
						})
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						className: "dsc-confirm-actions",
						children: [(0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dsc-btn",
							ref: cancelRef,
							onClick: () => setConfirming(null),
							children: t("confirm.cancel")
						}), (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dsc-btn danger",
							ref: confirmRef,
							onClick: () => {
								const action = confirming;
								setConfirming(null);
								if (action.kind === "delete") archived.remove(action.row.sessionId).then((ok) => {
									if (ok) refreshSessionList();
								});
								else archived.continueWithPreset(action.row.sessionId, action.preset.id).then((ok) => {
									if (ok) refreshSessionList();
								});
							},
							children: confirming.kind === "delete" ? t("confirm.confirm") : t("continue.confirm.confirm")
						})]
					})
				]
			})
		}) : null
	] });
}

//#endregion
//#region lib/types/client/hooks.js
const INITIAL = {
	loading: true,
	error: null,
	groups: [],
	total: 0,
	notice: null,
	restored: [],
	presets: [],
	presetsLoading: true,
	presetsError: null
};
async function cleanerFetch(path, body) {
	try {
		const init = body === void 0 ? { cache: "no-store" } : {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-dsh-session-cleaner": "1"
			},
			body: JSON.stringify(body)
		};
		const response = await fetch(`/api/dsh-session-cleaner${path}`, init);
		if (!response.ok) return await response.json().catch(() => null) ?? {
			ok: false,
			reason: "internal",
			message: `HTTP ${response.status}`
		};
		return await response.json();
	} catch (error) {
		return {
			ok: false,
			reason: "internal",
			message: error instanceof Error ? error.message : String(error)
		};
	}
}
/** Remove one session from the groups and hand the removed row back. */
function takeSession(groups, sessionId) {
	let row = null;
	const next = [];
	for (const group of groups) {
		const found = group.sessions.find((candidate) => candidate.sessionId === sessionId);
		if (found !== void 0) {
			row = found;
			const sessions = group.sessions.filter((candidate) => candidate.sessionId !== sessionId);
			if (sessions.length > 0) next.push({
				...group,
				sessions
			});
		} else next.push(group);
	}
	return {
		groups: next,
		row
	};
}
function useArchived() {
	const [state, setState] = (0, react.useState)(INITIAL);
	const requestSeq = (0, react.useRef)(0);
	const pendingRef = (0, react.useRef)(/* @__PURE__ */ new Set());
	const [pendingIds, setPendingIds] = (0, react.useState)(() => /* @__PURE__ */ new Set());
	const sweepingRef = (0, react.useRef)(false);
	const [sweeping, setSweeping] = (0, react.useState)(false);
	const refresh = (0, react.useCallback)(async () => {
		const seq = ++requestSeq.current;
		setState((current) => ({
			...current,
			loading: true,
			error: null
		}));
		const result = await cleanerFetch("/list");
		if (seq !== requestSeq.current) return;
		if (!result.ok) {
			setState((current) => ({
				...current,
				loading: false,
				error: result.message ?? "加载失败"
			}));
			return;
		}
		const total = result.groups.reduce((sum, group) => sum + group.sessions.length, 0);
		setState((current) => ({
			...current,
			loading: false,
			error: null,
			groups: result.groups,
			total
		}));
	}, []);
	const refreshPresets = (0, react.useCallback)(async () => {
		setState((current) => ({
			...current,
			presetsLoading: true,
			presetsError: null
		}));
		const result = await cleanerFetch("/presets");
		if (!result.ok) {
			setState((current) => ({
				...current,
				presetsLoading: false,
				presetsError: result.message ?? "预设加载失败"
			}));
			return;
		}
		setState((current) => ({
			...current,
			presetsLoading: false,
			presetsError: null,
			presets: result.presets
		}));
	}, []);
	(0, react.useEffect)(() => {
		refresh();
		refreshPresets();
	}, [refresh, refreshPresets]);
	const act = (0, react.useCallback)(async (path, sessionId) => {
		if (pendingRef.current.has(sessionId)) return false;
		pendingRef.current.add(sessionId);
		setPendingIds(new Set(pendingRef.current));
		requestSeq.current += 1;
		setState((current) => ({
			...current,
			notice: null
		}));
		try {
			const result = await cleanerFetch(path, { sessionId });
			if (!result.ok) {
				requestSeq.current += 1;
				setState((current) => {
					const groups = (result.committed ? takeSession(current.groups, sessionId) : null)?.groups ?? current.groups;
					return {
						...current,
						groups,
						total: groups.reduce((sum, group) => sum + group.sessions.length, 0),
						notice: {
							kind: "error",
							reason: result.reason,
							failedSteps: result.failedSteps,
							logError: result.logError,
							committed: result.committed,
							text: result.message
						}
					};
				});
				return result.committed === true;
			}
			requestSeq.current += 1;
			setState((current) => {
				const { groups, row } = takeSession(current.groups, sessionId);
				const total = groups.reduce((sum, group) => sum + group.sessions.length, 0);
				return {
					...current,
					groups,
					total,
					notice: {
						kind: "success",
						action: result.action,
						text: result.message
					},
					restored: path === "/restore" && row !== null ? [row, ...current.restored].slice(0, 20) : current.restored
				};
			});
			return true;
		} finally {
			pendingRef.current.delete(sessionId);
			setPendingIds(new Set(pendingRef.current));
		}
	}, []);
	return {
		state,
		pendingIds,
		sweeping,
		refresh,
		refreshPresets,
		remove: (0, react.useCallback)((sessionId) => act("/delete", sessionId), [act]),
		restore: (0, react.useCallback)((sessionId) => act("/restore", sessionId), [act]),
		continueWithPreset: (0, react.useCallback)(async (sessionId, presetId) => {
			if (pendingRef.current.has(sessionId)) return false;
			pendingRef.current.add(sessionId);
			setPendingIds(new Set(pendingRef.current));
			setState((current) => ({
				...current,
				notice: null
			}));
			try {
				const result = await cleanerFetch("/continue", {
					sessionId,
					presetId
				});
				if (!result.ok) {
					setState((current) => ({
						...current,
						notice: {
							kind: "error",
							reason: result.reason,
							text: result.message
						}
					}));
					return false;
				}
				setState((current) => ({
					...current,
					notice: {
						kind: "success",
						action: "continue",
						childSessionId: result.childSessionId,
						presetId: result.presetId,
						workspaceAttached: result.workspaceAttached,
						text: result.message
					}
				}));
				return true;
			} finally {
				pendingRef.current.delete(sessionId);
				setPendingIds(new Set(pendingRef.current));
			}
		}, []),
		sweep: (0, react.useCallback)(async () => {
			if (sweepingRef.current) return false;
			sweepingRef.current = true;
			setSweeping(true);
			requestSeq.current += 1;
			setState((current) => ({
				...current,
				notice: null
			}));
			try {
				const result = await cleanerFetch("/sweep", {});
				if (!result.ok) {
					setState((current) => ({
						...current,
						notice: {
							kind: "error",
							reason: result.reason,
							failedSteps: result.failedSteps,
							archived: result.removedArchivedIds?.length,
							projcache: result.removedProjcacheRows?.length,
							slots: result.removedWorkspaceSlots,
							quarantine: result.removedQuarantineFiles,
							text: result.message
						}
					}));
					return false;
				}
				setState((current) => ({
					...current,
					notice: {
						kind: "success",
						action: "sweep",
						archived: result.removedArchivedIds.length,
						projcache: result.removedProjcacheRows.length,
						slots: result.removedWorkspaceSlots,
						quarantine: result.removedQuarantineFiles,
						text: result.message
					}
				}));
				await refresh();
				return true;
			} finally {
				sweepingRef.current = false;
				setSweeping(false);
			}
		}, [refresh]),
		dismissNotice: (0, react.useCallback)(() => setState((current) => ({
			...current,
			notice: null
		})), [])
	};
}

//#endregion
//#region lib/types/client/locales.js
/**
* Locale dictionaries for the dsh-session-cleaner panel.
* @module dsh-session-cleaner/src/client/locales
*/
const NS = "dsh-session-cleaner";
const zh = {
	"footer.label": "已归档对话",
	"panel.title": "已归档对话",
	"panel.loading": "加载中…",
	"panel.error": "加载失败",
	"panel.empty": "暂无归档对话",
	"panel.retry": "重试",
	"group.ungrouped": "未分组",
	"row.noTitle": "（无标题）",
	"row.live": "运行中",
	"row.liveHint": "运行中的会话需重启 dsh 后才能删除",
	"row.noLog": "日志已删除",
	"row.preset": "预设：{preset}",
	"row.noPreset": "未记录预设",
	"row.presetMissing": "原预设已失效",
	"row.presetBroken": "原预设不可用",
	"menu.delete": "删除",
	"menu.restore": "恢复",
	"continue.select": "选择续接预设",
	"continue.button": "用此预设继续",
	"continue.confirm.title": "创建续接会话",
	"continue.confirm.body": "将使用预设「{preset}」创建新会话并继承「{title}」的完整历史；原归档对话不会被修改。",
	"continue.confirm.confirm": "创建",
	"preset.system": "系统预设",
	"preset.user": "用户预设",
	"preset.loading": "正在加载预设…",
	"preset.loadFailed": "预设加载失败",
	"confirm.title": "确认删除",
	"confirm.body": "将彻底删除对话「{title}」的日志与注册表记录，不可恢复。",
	"confirm.cancel": "取消",
	"confirm.confirm": "删除",
	"restored.section": "本次已恢复",
	"restored.hint": "已回到原工作区",
	"sweep.button": "清理残留",
	"sweep.running": "清理中…",
	"panel.hint": "删除、恢复和清理残留会立即写入；续接始终保留原归档对话。",
	"notice.deleted": "已彻底删除：日志、工作区席位与注册表条目均已清理。",
	"notice.restored": "已恢复（取消归档），该对话已回到原工作区。",
	"notice.continued": "已创建续接会话 {id}，目标预设为 {preset}；原归档对话保持不变。",
	"notice.continuedUngrouped": "已创建续接会话 {id}，但工作区挂载失败；请在未分组列表中查看。",
	"notice.sweep.none": "没有发现残留。",
	"notice.sweep.done": "已清理 {archived} 条归档幽灵、{projcache} 条孤儿缓存、{slots} 个孤儿席位与 {quarantine} 个隔离日志。",
	"banner.close": "关闭提示",
	"error.badId": "会话 id 格式无效。",
	"error.notArchived": "该对话不在归档列表中，或已被处理过。",
	"error.live": "该对话正在运行：点开过的会话会一直挂在宿主后台，只有重启 dsh 才会释放（官方机制，插件无法强制关闭）。",
	"error.forbidden": "拒绝跨站请求。",
	"error.notFound": "未知端点。",
	"error.internal": "服务器内部错误。",
	"error.unsupportedBackend": "当前存储后端不提供单文件日志，插件无法安全删除，请改用官方途径处理。",
	"error.writeFailed": "工作区注册表读写失败，操作已取消且未改动数据，请重试。",
	"error.badRequest": "请求内容无效。",
	"error.staleRegistry": "内存态与持久态归档集合不一致，请重启 dsh 后重试。",
	"error.registryUnavailable": "工作区归档集合不可读，未执行操作。",
	"error.unknownPreset": "目标预设不存在，请刷新预设列表后重试。",
	"error.brokenPreset": "目标预设当前不可用。",
	"error.sourceUnreadable": "无法读取源对话的完整、已闭合历史。",
	"error.createFailed": "续接会话创建失败，原归档对话未被修改。",
	"error.partial": "操作未完全成功：{steps}。未提交的改动会尽量回滚，请按提示重试或清理残留。",
	"error.partialCommitted": "删除已提交，但仍有隔离日志等待清理：{steps}。请运行“清理残留”。",
	"error.partialSteps.registry": "工作区注册表",
	"error.partialSteps.workspaceSlots": "工作区席位",
	"error.partialSteps.projcache": "投影缓存",
	"error.partialSteps.log": "日志文件",
	"error.partialSteps.rollback": "回滚",
	"error.partialSteps.quarantine": "隔离目录"
};
const en = {
	"footer.label": "Archived",
	"panel.title": "Archived conversations",
	"panel.loading": "Loading…",
	"panel.error": "Failed to load",
	"panel.empty": "No archived conversations",
	"panel.retry": "Retry",
	"group.ungrouped": "Ungrouped",
	"row.noTitle": "(untitled)",
	"row.live": "live",
	"row.liveHint": "A running session can only be deleted after restarting dsh",
	"row.noLog": "log removed",
	"row.preset": "Preset: {preset}",
	"row.noPreset": "No preset recorded",
	"row.presetMissing": "Original preset missing",
	"row.presetBroken": "Original preset unavailable",
	"menu.delete": "Delete",
	"menu.restore": "Restore",
	"continue.select": "Choose continuation preset",
	"continue.button": "Continue with preset",
	"continue.confirm.title": "Create continuation",
	"continue.confirm.body": "Create a new session with preset “{preset}” and inherit the complete history of “{title}”. The archived source will not be modified.",
	"continue.confirm.confirm": "Create",
	"preset.system": "System presets",
	"preset.user": "User presets",
	"preset.loading": "Loading presets…",
	"preset.loadFailed": "Failed to load presets",
	"confirm.title": "Confirm deletion",
	"confirm.body": "This permanently deletes the log and registry records of “{title}”.",
	"confirm.cancel": "Cancel",
	"confirm.confirm": "Delete",
	"restored.section": "Restored this session",
	"restored.hint": "Returned to its original workspace",
	"sweep.button": "Clean leftovers",
	"sweep.running": "Cleaning…",
	"panel.hint": "Delete, restore, and cleanup apply immediately; continuation always preserves the archived source.",
	"notice.deleted": "Deleted: the log, workspace slot, and registry entry are cleaned.",
	"notice.restored": "Restored (unarchived) and returned to its original workspace.",
	"notice.continued": "Created continuation {id} with preset {preset}; the archived source is unchanged.",
	"notice.continuedUngrouped": "Created continuation {id}, but workspace attachment failed; find it under Ungrouped.",
	"notice.sweep.none": "No leftovers found.",
	"notice.sweep.done": "Cleaned {archived} ghost archive entries, {projcache} orphan cache rows, {slots} orphan workspace slots, and {quarantine} quarantined logs.",
	"banner.close": "Dismiss notice",
	"error.badId": "Invalid session id.",
	"error.notArchived": "That conversation is not archived, or has already been processed.",
	"error.live": "This conversation is running: opened sessions stay alive in the host background until dsh restarts (official behavior; the plugin cannot force-stop it).",
	"error.forbidden": "Cross-origin request rejected.",
	"error.notFound": "Unknown endpoint.",
	"error.internal": "Internal server error.",
	"error.unsupportedBackend": "This storage backend has no per-session log file, so the plugin cannot delete it safely; use the official flow instead.",
	"error.writeFailed": "Could not read/write the workspace registry; nothing was changed, please retry.",
	"error.badRequest": "The request body is invalid.",
	"error.staleRegistry": "The in-memory and durable archive sets differ; restart dsh and retry.",
	"error.registryUnavailable": "The durable archive set is unavailable; no operation was performed.",
	"error.unknownPreset": "The target preset no longer exists; refresh the preset list and retry.",
	"error.brokenPreset": "The target preset is currently unusable.",
	"error.sourceUnreadable": "The source conversation does not have readable, balanced history.",
	"error.createFailed": "Could not create the continuation; the archived source was not modified.",
	"error.partial": "Operation incomplete: {steps}. Uncommitted changes were rolled back where possible; retry or clean leftovers.",
	"error.partialCommitted": "Deletion committed, but quarantined logs still need cleanup: {steps}. Run Clean leftovers.",
	"error.partialSteps.registry": "workspace registry",
	"error.partialSteps.workspaceSlots": "workspace slots",
	"error.partialSteps.projcache": "projection cache",
	"error.partialSteps.log": "log file",
	"error.partialSteps.rollback": "rollback",
	"error.partialSteps.quarantine": "quarantine directory"
};

//#endregion
//#region lib/types/client/index.js
/** Client-side services this entry waits for. */
const inject = [
	"slots",
	"locale",
	"sessions"
];
function apply(ctx) {
	ctx.effect(() => ctx.locale.register(NS, {
		zh,
		en
	}), "dsh-session-cleaner: locale");
	const t = ctx.locale.bind(NS);
	const pendingTimeouts = /* @__PURE__ */ new Set();
	ctx.effect(() => () => {
		for (const id of pendingTimeouts) window.clearTimeout(id);
		pendingTimeouts.clear();
	}, "dsh-session-cleaner: timeout cleanup");
	const refreshSessionList = () => {
		const sessions = ctx.sessions;
		const candidate = sessions?.refresh ?? sessions?.refreshList;
		if (typeof candidate !== "function") return;
		const fn = candidate;
		const run = () => {
			fn.call(sessions).catch(() => {});
		};
		run();
		const id = window.setTimeout(() => {
			pendingTimeouts.delete(id);
			run();
		}, 1e3);
		pendingTimeouts.add(id);
	};
	const localeId = () => String(ctx.locale.getLocale().active);
	ctx.slots.inject("settings.section", () => ctx.slots.register({
		name: "settings.section",
		id: "dsh-session-cleaner",
		order: 50,
		label: () => t("panel.title"),
		locale: NS,
		inject: () => ({
			useArchived,
			refreshSessionList,
			localeId
		})
	}, ArchivedSettingsSection));
}

//#endregion
exports.apply = apply;
exports.inject = inject;
return module.exports; } });
//# sourceMappingURL=client.js.map
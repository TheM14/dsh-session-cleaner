import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { resolveSessionPreset } from "@deepseek-ai/dsh-agent-presets";
import { dshHomePath } from "@deepseek-ai/dsh-home-paths";

//#region lib/types/cleanup-plan.js
/** Pure sweep planning. No storage is touched here. */
function planSweep(input) {
	const archivedGhosts = input.archivedIds.filter((id) => !input.headerIds.has(id) && !input.liveIds.has(id));
	const effectiveArchived = new Set(input.archivedIds.filter((id) => !archivedGhosts.includes(id)));
	const orphanSlotsByWorkspace = /* @__PURE__ */ new Map();
	const remainingAccounted = /* @__PURE__ */ new Set();
	for (const [workspaceId, ids] of input.workspaceSessionIds) {
		const orphan = [];
		for (const id of ids) if (!input.headerIds.has(id) && !input.liveIds.has(id) && !effectiveArchived.has(id)) orphan.push(id);
		else remainingAccounted.add(id);
		if (orphan.length > 0) orphanSlotsByWorkspace.set(workspaceId, orphan);
	}
	return {
		archivedGhosts,
		orphanSlotsByWorkspace,
		orphanProjcacheIds: input.projcacheIds.filter((id) => !input.headerIds.has(id) && !input.liveIds.has(id) && !remainingAccounted.has(id))
	};
}

//#endregion
//#region lib/types/group.js
function rowFor(sessionId, headerById, titleById, liveIds, presetById) {
	const header = headerById.get(sessionId);
	const preset = presetById.get(sessionId);
	return {
		sessionId,
		title: titleById.get(sessionId) ?? null,
		createdAt: header?.createdAt ?? null,
		cwd: header?.cwd ?? null,
		live: liveIds.has(sessionId),
		logPresent: header !== void 0,
		agentPreset: preset?.id ?? null,
		presetAvailable: preset?.available ?? null,
		presetBroken: preset?.broken ?? false
	};
}
/**
* @param archivedIds - effective archive set (already tombstone-filtered).
* @param headerById - persisted session headers keyed by id.
* @param titleById - projection-cache titles keyed by id.
* @param workspaces - registry workspaces in display order.
* @param liveIds - ids currently owned by a live Session.
*/
function groupArchived(archivedIds, headerById, titleById, workspaces, liveIds, presetById = /* @__PURE__ */ new Map()) {
	const groups = [];
	const accounted = /* @__PURE__ */ new Set();
	const archivedSet = new Set(archivedIds);
	for (const workspace of workspaces) {
		const rows = [];
		const sessionIds = Array.isArray(workspace.sessionIds) ? workspace.sessionIds : [];
		for (const rawId of sessionIds) {
			if (typeof rawId !== "string") continue;
			const id = rawId;
			if (!archivedSet.has(id)) continue;
			accounted.add(id);
			rows.push(rowFor(id, headerById, titleById, liveIds, presetById));
		}
		if (rows.length > 0) groups.push({
			workspace: {
				id: String(workspace.id),
				path: workspace.path,
				title: workspace.title
			},
			sessions: rows
		});
	}
	const ungrouped = archivedIds.filter((id) => !accounted.has(id)).map((id) => rowFor(id, headerById, titleById, liveIds, presetById));
	if (ungrouped.length > 0) groups.push({
		workspace: null,
		sessions: ungrouped
	});
	return groups;
}

//#endregion
//#region lib/types/registry-edit.js
/**
* Pure, testable text transforms for the two durable registry documents.
* Every transform is text-in → text-out (or null when the input is not a
* parseable JSON document) so the logic can be unit-tested without a host.
* @module dsh-session-cleaner/src/registry-edit
*/
/**
* Remove `sessionId` from an id list. Non-array values are preserved verbatim
* (never collapsed to `[]`), and an array that does not contain the id is
* returned as-is so callers can detect "no change" by reference identity.
*/
function filterId(list, sessionId) {
	if (!Array.isArray(list)) return list;
	if (!list.includes(sessionId)) return list;
	return list.filter((item) => item !== sessionId);
}
/** Deep-clone a parsed storage document so domain values are never mutated in place. */
function clone(value) {
	return JSON.parse(JSON.stringify(value));
}
/**
* Pure object-level transform for the workspace domain's global state.
* `delete` removes the id from the archive set AND every workspace account;
* `restore` removes it from the archive set only, keeping the workspace slot.
* The input is deep-cloned first (the storage domain forbids in-place
* mutation of stored values).
*
* @returns a NEW state object, or null when the input is not a usable shape.
*/
function filterWorkspaceState(state, sessionId, mode) {
	if (typeof state !== "object" || state === null) return null;
	const next = clone(state);
	let changed = false;
	const global = next.global;
	if (global && "archivedSessionIds" in global) {
		const before = global.archivedSessionIds;
		const after = filterId(before, sessionId);
		if (after !== before) {
			global.archivedSessionIds = after;
			changed = true;
		}
	}
	if (mode === "delete") {
		const workspaces = next.tables?.workspaces;
		if (workspaces) {
			for (const record of Object.values(workspaces)) if (record && "sessionIds" in record) {
				const before = record.sessionIds;
				const after = filterId(before, sessionId);
				if (after !== before) {
					record.sessionIds = after;
					changed = true;
				}
			}
		}
	}
	return changed ? next : null;
}
/**
* Rewrite the projection-cache document (`storages/session_projcache.json`)
* by dropping the session's row (title, stats, token usage…).
*
* @returns the rewritten document text, or null when the input is invalid.
*/
function projcacheJsonAfter(text, sessionId) {
	let doc;
	try {
		doc = JSON.parse(text);
	} catch {
		return null;
	}
	const sessions = doc?.tables?.sessions;
	if (sessions && typeof sessions === "object") delete sessions[sessionId];
	return `${JSON.stringify(doc, null, 2)}\n`;
}

//#endregion
//#region lib/types/types.js
/**
* Shared wire vocabulary for the dsh-session-cleaner HTTP API.
* Host produces these shapes; the Web panel consumes them.
* @module dsh-session-cleaner/src/types
*/
/** Session-id shape guard: session-<8-4-4-4-12 lowercase hex>. */
const SESSION_ID_PATTERN = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

//#endregion
//#region lib/types/index.js
const name = "dsh-session-cleaner";
/** Services this entry requires before activation. */
const inject = [
	"webServer",
	"sessionPersistence",
	"workspaceRegistry",
	"sessions",
	"storageDomain",
	"agents",
	"agentPresets"
];
const API_PREFIX = "/api/dsh-session-cleaner";
const MAX_BODY_BYTES = 65536;
const MUTATION_HEADER = "x-dsh-session-cleaner";
var RequestBodyError = class extends Error {
	status;
	constructor(status, message) {
		super(message);
		this.status = status;
	}
};
function apply(ctx) {
	const tombstones = /* @__PURE__ */ new Map();
	const continuedHandles = /* @__PURE__ */ new Map();
	const continueInflight = /* @__PURE__ */ new Map();
	const markTombstone = (sessionId, value) => {
		tombstones.delete(sessionId);
		tombstones.set(sessionId, value);
		while (tombstones.size > 256) {
			const oldest = tombstones.keys().next().value;
			if (oldest === void 0) break;
			tombstones.delete(oldest);
		}
	};
	const archivedIds = () => ctx.workspaceRegistry.archivedSessionIds;
	/** The already-open host domain, when present in this composition. */
	const domainOf = (name$1) => {
		try {
			return ctx.storageDomain.get(name$1);
		} catch (error) {
			console.error(`[dsh-session-cleaner] storage domain lookup failed (${name$1}): ${String(error)}`);
			throw error;
		}
	};
	function cloneJson(value) {
		return JSON.parse(JSON.stringify(value));
	}
	/**
	* Normalized workspace state, tagged with the source it was read from so
	* writes never mix sources (P0-6). When the host's own domain is open it is
	* the only authoritative source: a domain read failure aborts the mutation
	* instead of silently falling back to a possibly-stale disk snapshot.
	*/
	function readWorkspaceState() {
		let domain;
		try {
			domain = domainOf("workspace");
		} catch {
			return null;
		}
		if (domain !== void 0) try {
			return {
				source: "domain",
				state: {
					global: cloneJson(domain.global.get()),
					tables: { workspaces: Object.fromEntries(domain.table("workspaces").entries()) }
				}
			};
		} catch (error) {
			console.error(`[dsh-session-cleaner] workspace domain read failed: ${String(error)}`);
			return null;
		}
		try {
			return {
				source: "disk",
				state: JSON.parse(readFileSync(dshHomePath("storages", "workspace.json"), "utf8"))
			};
		} catch {
			return null;
		}
	}
	/** Disk-only whole-document rewrite for the workspace registry (same source). */
	function rewriteWorkspaceDoc(mutate) {
		const target = dshHomePath("storages", "workspace.json");
		try {
			const doc = JSON.parse(readFileSync(target, "utf8"));
			mutate(doc);
			writeAtomicSync(target, `${JSON.stringify(doc, null, 2)}\n`);
			return true;
		} catch {
			return false;
		}
	}
	/** Replace the workspace global singleton in the SAME source it was read from. */
	async function setWorkspaceGlobal(source, global) {
		if (source === "domain") try {
			const domain = domainOf("workspace");
			if (domain === void 0) return false;
			await domain.global.set(global);
			return true;
		} catch (error) {
			console.error(`[dsh-session-cleaner] workspace domain global write failed: ${String(error)}`);
			return false;
		}
		return rewriteWorkspaceDoc((doc) => {
			doc.global = global;
		});
	}
	/**
	* Remove one or more session ids from a single workspace record in one atomic
	* write. On the domain this is a per-record read-modify-write
	* (`table.update`); on disk it rewrites the whole document (the only option
	* for a JSON file).
	*/
	async function removeSessionsFromWorkspaceRecord(source, workspaceId, sessionIds) {
		const ids = new Set(sessionIds);
		if (source === "domain") try {
			const domain = domainOf("workspace");
			if (domain === void 0) return false;
			await domain.table("workspaces").update(workspaceId, (current) => {
				const record = cloneJson(current);
				if (record && Array.isArray(record.sessionIds)) record.sessionIds = record.sessionIds.filter((id) => !ids.has(id));
				return record;
			});
			return true;
		} catch (error) {
			console.error(`[dsh-session-cleaner] workspace record update failed (${workspaceId}): ${String(error)}`);
			return false;
		}
		return rewriteWorkspaceDoc((doc) => {
			const record = (doc.tables ?? {}).workspaces?.[workspaceId];
			if (record && Array.isArray(record.sessionIds)) record.sessionIds = record.sessionIds.filter((id) => !ids.has(id));
		});
	}
	function jsonEqual(left, right) {
		return JSON.stringify(left) === JSON.stringify(right);
	}
	async function setWorkspaceRecordSessionIds(domain, workspaceId, sessionIds) {
		await domain.table("workspaces").update(workspaceId, (current) => {
			const record = current && typeof current === "object" ? cloneJson(current) : {};
			record.sessionIds = Array.isArray(sessionIds) ? cloneJson(sessionIds) : sessionIds;
			return record;
		});
	}
	/** Apply one pure workspace transform and retain a compensating rollback. */
	async function applyWorkspaceMutation(read, sessionId, mode) {
		const next = filterWorkspaceState(read.state, sessionId, mode);
		if (next === null) return {
			ok: false,
			rollbackOk: true,
			rollback: async () => true
		};
		if (read.source === "disk") {
			const target = dshHomePath("storages", "workspace.json");
			try {
				writeAtomicSync(target, `${JSON.stringify(next, null, 2)}\n`);
			} catch (error) {
				console.error(`[dsh-session-cleaner] workspace disk write failed: ${String(error)}`);
				return {
					ok: false,
					rollbackOk: true,
					rollback: async () => true
				};
			}
			return {
				ok: true,
				rollbackOk: true,
				rollback: async () => {
					try {
						writeAtomicSync(target, `${JSON.stringify(read.state, null, 2)}\n`);
						return true;
					} catch (error) {
						console.error(`[dsh-session-cleaner] workspace disk rollback failed: ${String(error)}`);
						return false;
					}
				}
			};
		}
		let domain;
		try {
			domain = domainOf("workspace");
		} catch {
			return {
				ok: false,
				rollbackOk: true,
				rollback: async () => true
			};
		}
		if (domain === void 0) return {
			ok: false,
			rollbackOk: true,
			rollback: async () => true
		};
		const globalChanged = !jsonEqual(read.state.global, next.global);
		const originalWorkspaces = read.state.tables?.workspaces ?? {};
		const nextWorkspaces = next.tables?.workspaces ?? {};
		const changedWorkspaceIds = Object.keys(originalWorkspaces).filter((workspaceId) => !jsonEqual(originalWorkspaces[workspaceId]?.sessionIds, nextWorkspaces[workspaceId]?.sessionIds));
		let globalWritten = false;
		const writtenWorkspaceIds = [];
		const rollback = async () => {
			let ok = true;
			for (const workspaceId of [...writtenWorkspaceIds].reverse()) try {
				await setWorkspaceRecordSessionIds(domain, workspaceId, originalWorkspaces[workspaceId]?.sessionIds);
			} catch (error) {
				console.error(`[dsh-session-cleaner] workspace record rollback failed (${workspaceId}): ${String(error)}`);
				ok = false;
			}
			if (globalWritten) try {
				await domain.global.set(cloneJson(read.state.global));
			} catch (error) {
				console.error(`[dsh-session-cleaner] workspace global rollback failed: ${String(error)}`);
				ok = false;
			}
			return ok;
		};
		try {
			if (globalChanged) {
				globalWritten = true;
				await domain.global.set(cloneJson(next.global));
			}
			for (const workspaceId of changedWorkspaceIds) {
				writtenWorkspaceIds.push(workspaceId);
				await setWorkspaceRecordSessionIds(domain, workspaceId, nextWorkspaces[workspaceId]?.sessionIds);
			}
			return {
				ok: true,
				rollbackOk: true,
				rollback
			};
		} catch (error) {
			console.error(`[dsh-session-cleaner] workspace mutation failed: ${String(error)}`);
			const rollbackOk = await rollback();
			return {
				ok: false,
				rollbackOk,
				rollback: async () => rollbackOk
			};
		}
	}
	function readProjcacheSnapshot(sessionId) {
		let domain;
		try {
			domain = domainOf("session_projcache");
		} catch {
			return null;
		}
		if (domain !== void 0) try {
			const value = domain.table("sessions").get(sessionId);
			return {
				source: "domain",
				present: value !== void 0,
				value: value === void 0 ? void 0 : cloneJson(value)
			};
		} catch (error) {
			console.error(`[dsh-session-cleaner] projcache domain read failed: ${String(error)}`);
			return null;
		}
		const target = dshHomePath("storages", "session_projcache.json");
		if (!existsSync(target)) return {
			source: "disk",
			present: false
		};
		try {
			const value = JSON.parse(readFileSync(target, "utf8")).tables?.sessions?.[sessionId];
			return {
				source: "disk",
				present: value !== void 0,
				value: value === void 0 ? void 0 : cloneJson(value)
			};
		} catch (error) {
			console.error(`[dsh-session-cleaner] projcache disk read failed: ${String(error)}`);
			return null;
		}
	}
	/** Remove the projection-cache row in the SAME source (domain or disk only). */
	async function removeProjcacheRow(sessionId, source) {
		let domain;
		try {
			domain = domainOf("session_projcache");
		} catch {
			return false;
		}
		if (source !== "disk" && domain !== void 0) try {
			await domain.table("sessions").delete(sessionId);
			return true;
		} catch (error) {
			console.error(`[dsh-session-cleaner] projcache domain delete failed: ${String(error)}`);
			return false;
		}
		if (source === "domain") return false;
		if (!existsSync(dshHomePath("storages", "session_projcache.json"))) return true;
		return rewriteStorage("session_projcache.json", (text) => projcacheJsonAfter(text, sessionId));
	}
	async function restoreProjcacheRow(sessionId, snapshot) {
		if (!snapshot.present) return true;
		if (snapshot.source === "domain") {
			let domain;
			try {
				domain = domainOf("session_projcache");
				if (domain === void 0) return false;
				await domain.table("sessions").put(sessionId, cloneJson(snapshot.value));
				return true;
			} catch (error) {
				console.error(`[dsh-session-cleaner] projcache rollback failed: ${String(error)}`);
				return false;
			}
		}
		const target = dshHomePath("storages", "session_projcache.json");
		try {
			const doc = existsSync(target) ? JSON.parse(readFileSync(target, "utf8")) : { tables: { sessions: {} } };
			doc.tables ??= {};
			doc.tables.sessions ??= {};
			doc.tables.sessions[sessionId] = cloneJson(snapshot.value);
			writeAtomicSync(target, `${JSON.stringify(doc, null, 2)}\n`);
			return true;
		} catch (error) {
			console.error(`[dsh-session-cleaner] projcache disk rollback failed: ${String(error)}`);
			return false;
		}
	}
	function readProjcacheKeys() {
		let domain;
		try {
			domain = domainOf("session_projcache");
		} catch {
			return null;
		}
		if (domain !== void 0) try {
			return [...domain.table("sessions").entries()].map(([key]) => key);
		} catch (error) {
			console.error(`[dsh-session-cleaner] projcache domain read failed: ${String(error)}`);
			return null;
		}
		const target = dshHomePath("storages", "session_projcache.json");
		if (!existsSync(target)) return [];
		try {
			const doc = JSON.parse(readFileSync(target, "utf8"));
			return Object.keys(doc?.tables?.sessions ?? {});
		} catch (error) {
			console.error(`[dsh-session-cleaner] projcache disk read failed: ${String(error)}`);
			return null;
		}
	}
	const quarantineRoot = () => join(dirname(dshHomePath("storages", "workspace.json")), ".dsh-session-cleaner-trash");
	function quarantineLog(originalPath, sessionId) {
		if (!existsSync(originalPath)) return {
			originalPath,
			quarantinePath: "",
			moved: false
		};
		const sessionDir = join(quarantineRoot(), sessionId);
		const quarantinePath = join(sessionDir, basename(originalPath));
		try {
			mkdirSync(sessionDir, { recursive: true });
			if (existsSync(quarantinePath)) return null;
			renameSync(originalPath, quarantinePath);
			return {
				originalPath,
				quarantinePath,
				moved: true
			};
		} catch (error) {
			console.error(`[dsh-session-cleaner] log quarantine failed (${sessionId}): ${String(error)}`);
			return null;
		}
	}
	function restoreQuarantinedLog(log) {
		if (!log.moved) return true;
		try {
			mkdirSync(dirname(log.originalPath), { recursive: true });
			renameSync(log.quarantinePath, log.originalPath);
			try {
				rmdirSync(dirname(log.quarantinePath));
			} catch {}
			return true;
		} catch (error) {
			console.error(`[dsh-session-cleaner] log quarantine rollback failed: ${String(error)}`);
			return false;
		}
	}
	function purgeQuarantinedLog(log) {
		if (!log.moved) return { ok: true };
		try {
			rmSync(log.quarantinePath);
			try {
				rmdirSync(dirname(log.quarantinePath));
			} catch {}
			try {
				rmdirSync(dirname(log.originalPath));
			} catch {}
			return { ok: true };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(`[dsh-session-cleaner] quarantined log purge failed: ${message}`);
			return {
				ok: false,
				error: message
			};
		}
	}
	function readQuarantineFiles() {
		const root = quarantineRoot();
		if (!existsSync(root)) return [];
		try {
			const files = [];
			for (const sessionEntry of readdirSync(root, { withFileTypes: true })) {
				if (!sessionEntry.isDirectory() || !SESSION_ID_PATTERN.test(sessionEntry.name)) continue;
				const sessionDir = join(root, sessionEntry.name);
				for (const fileEntry of readdirSync(sessionDir, { withFileTypes: true })) if (fileEntry.isFile()) files.push(join(sessionDir, fileEntry.name));
			}
			return files;
		} catch (error) {
			console.error(`[dsh-session-cleaner] quarantine read failed: ${String(error)}`);
			return null;
		}
	}
	function purgeQuarantineFile(filePath) {
		try {
			rmSync(filePath);
			try {
				rmdirSync(dirname(filePath));
			} catch {}
			return true;
		} catch (error) {
			console.error(`[dsh-session-cleaner] quarantine sweep failed (${filePath}): ${String(error)}`);
			return false;
		}
	}
	let mutationTail = Promise.resolve();
	function enqueueMutation(operation) {
		const run = mutationTail.then(operation, operation);
		mutationTail = run.then(() => void 0, () => void 0);
		return run;
	}
	/**
	* The archive set `/list` reports. The durable `archivedSessionIds` is the
	* authority (delete/restore write it directly), tombstone-filtered so an
	* in-flight mutation can never leak a row back into a response.
	*/
	function readEffectiveArchivedIds() {
		const read = readWorkspaceState();
		const raw = Array.isArray(read?.state?.global?.archivedSessionIds) ? read.state.global.archivedSessionIds : archivedIds();
		return (Array.isArray(raw) ? raw : []).filter((id) => typeof id === "string" && !tombstones.has(id));
	}
	async function readPresetStates(sessionIds, headerById) {
		let roster = null;
		try {
			const presets = await ctx.agentPresets.list();
			roster = new Map(presets.map((preset) => [preset.id, {
				id: preset.id,
				name: preset.name,
				description: preset.description,
				trust: preset.trust,
				broken: preset.broken
			}]));
		} catch (error) {
			console.error(`[dsh-session-cleaner] preset roster read failed: ${String(error)}`);
		}
		const entries = await Promise.all(sessionIds.map(async (sessionId) => {
			const header = headerById.get(sessionId);
			let presetId = header?.agentPreset ?? null;
			if (header !== void 0) try {
				const inspection = await ctx.sessionPersistence.inspect(sessionId);
				presetId = resolveSessionPreset({
					header: inspection.meta,
					events: inspection.events
				}) ?? null;
			} catch (error) {
				console.error(`[dsh-session-cleaner] preset inspection failed (${sessionId}): ${String(error)}`);
			}
			const preset = presetId === null ? void 0 : roster?.get(presetId);
			return [sessionId, {
				id: presetId,
				available: roster === null || presetId === null ? null : preset !== void 0,
				broken: preset?.broken !== void 0
			}];
		}));
		return new Map(entries);
	}
	async function handleList() {
		const headers = await ctx.sessionPersistence.list();
		const effective = readEffectiveArchivedIds();
		const headerById = new Map(headers.map((header) => [String(header.id), header]));
		const liveIds = new Set(ctx.sessions.list().map((session) => String(session.id)));
		const presetStates = await readPresetStates(effective, headerById);
		const groups = groupArchived(effective, headerById, readTitles(), ctx.workspaceRegistry.list(), liveIds, presetStates);
		return {
			ok: true,
			groups,
			total: groups.reduce((sum, group) => sum + group.sessions.length, 0)
		};
	}
	async function handleDelete(rawBody) {
		const sessionId = bodySessionId(rawBody);
		if (sessionId === null) return {
			ok: false,
			reason: "bad-id",
			message: "会话 id 格式无效"
		};
		if (tombstones.has(sessionId)) return {
			ok: false,
			reason: "not-archived",
			message: "该对话已处理，请勿重复操作。"
		};
		return enqueueMutation(async () => {
			if (tombstones.has(sessionId)) return {
				ok: false,
				reason: "not-archived",
				message: "该对话已处理，请勿重复操作。"
			};
			const read = readWorkspaceState();
			if (read === null) return {
				ok: false,
				reason: "write-failed",
				message: "无法读取工作区注册表（存储域与磁盘均不可用），已取消删除，请重试。"
			};
			const durableArchived = read.state.global?.archivedSessionIds;
			if (!Array.isArray(durableArchived)) return {
				ok: false,
				reason: "registry-unavailable",
				message: "工作区归档集合不可读，删除已取消。"
			};
			if (!durableArchived.includes(sessionId)) return archivedIds().includes(sessionId) ? {
				ok: false,
				reason: "stale-registry",
				message: "内存态与持久态归档集合不一致，请重启 dsh 后重试。"
			} : {
				ok: false,
				reason: "not-archived",
				message: "只能删除已归档的对话。"
			};
			if (ctx.sessions.get(sessionId)) return {
				ok: false,
				reason: "live",
				message: "该对话正在运行。请重启 dsh，且不要再次打开该对话，然后重试删除。"
			};
			const header = (await ctx.sessionPersistence.list()).find((candidate) => String(candidate.id) === sessionId);
			const location = header ? ctx.sessionPersistence.locate(header) : void 0;
			if (header !== void 0 && location?.path === void 0) return {
				ok: false,
				reason: "unsupported-backend",
				message: "当前会话存储后端不提供单文件日志，插件无法安全删除。"
			};
			const projcacheSnapshot = readProjcacheSnapshot(sessionId);
			if (projcacheSnapshot === null) return {
				ok: false,
				reason: "write-failed",
				message: "无法读取投影缓存，删除已取消且未改动数据。"
			};
			let quarantined = {
				originalPath: "",
				quarantinePath: "",
				moved: false
			};
			if (location?.path) {
				const result = quarantineLog(location.path, sessionId);
				if (result === null) return {
					ok: false,
					reason: "write-failed",
					message: "无法隔离日志文件，删除已取消且未改动数据。"
				};
				quarantined = result;
			}
			if (ctx.sessions.get(sessionId)) return restoreQuarantinedLog(quarantined) ? {
				ok: false,
				reason: "live",
				message: "该对话在排队期间变为运行中，删除已取消。"
			} : {
				ok: false,
				reason: "partial",
				failedSteps: ["rollback"],
				message: "会话在排队期间变为运行中，且日志隔离回滚失败；请勿继续操作并检查隔离目录。"
			};
			const workspaceCommit = await applyWorkspaceMutation(read, sessionId, "delete");
			if (!workspaceCommit.ok) {
				const logRollbackOk = restoreQuarantinedLog(quarantined);
				const failedSteps = ["registry"];
				if (!workspaceCommit.rollbackOk || !logRollbackOk) failedSteps.push("rollback");
				console.info(`[dsh-session-cleaner] delete ${sessionId}: registry failed, rollback=${workspaceCommit.rollbackOk && logRollbackOk}`);
				return {
					ok: false,
					reason: "partial",
					failedSteps,
					message: workspaceCommit.rollbackOk && logRollbackOk ? "工作区注册表更新失败；所有可见改动已回滚，可以重试。" : "工作区注册表更新失败，且回滚未完全成功；请先运行清理残留。"
				};
			}
			if (!await removeProjcacheRow(sessionId, projcacheSnapshot.source)) {
				const [registryRollbackOk, projcacheRollbackOk] = await Promise.all([workspaceCommit.rollback(), restoreProjcacheRow(sessionId, projcacheSnapshot)]);
				const logRollbackOk = restoreQuarantinedLog(quarantined);
				const failedSteps = ["projcache"];
				if (!registryRollbackOk || !projcacheRollbackOk || !logRollbackOk) failedSteps.push("rollback");
				console.info(`[dsh-session-cleaner] delete ${sessionId}: projcache failed, rollback=${registryRollbackOk && projcacheRollbackOk && logRollbackOk}`);
				return {
					ok: false,
					reason: "partial",
					failedSteps,
					message: registryRollbackOk && projcacheRollbackOk && logRollbackOk ? "投影缓存更新失败；所有可见改动已回滚，可以重试。" : "投影缓存更新失败，且回滚未完全成功；请先运行清理残留。"
				};
			}
			const purge = purgeQuarantinedLog(quarantined);
			markTombstone(sessionId, "deleted");
			if (!purge.ok) {
				console.info(`[dsh-session-cleaner] delete ${sessionId}: committed, quarantine cleanup pending`);
				return {
					ok: false,
					reason: "partial",
					failedSteps: ["log"],
					logError: purge.error,
					committed: true,
					message: "删除已经提交，但隔离日志尚未最终清理；请运行“清理残留”。"
				};
			}
			console.info(`[dsh-session-cleaner] delete ${sessionId}: committed`);
			return {
				ok: true,
				sessionId,
				action: "delete",
				logRemoved: quarantined.moved,
				registryUpdated: true,
				projcacheUpdated: true,
				needsRestart: false,
				message: "已彻底删除日志文件、工作区席位与注册表条目。"
			};
		});
	}
	async function handleRestore(rawBody) {
		const sessionId = bodySessionId(rawBody);
		if (sessionId === null) return {
			ok: false,
			reason: "bad-id",
			message: "会话 id 格式无效"
		};
		if (tombstones.has(sessionId)) return {
			ok: false,
			reason: "not-archived",
			message: "该对话已处理，请勿重复操作。"
		};
		return enqueueMutation(async () => {
			if (tombstones.has(sessionId)) return {
				ok: false,
				reason: "not-archived",
				message: "该对话已处理，请勿重复操作。"
			};
			const read = readWorkspaceState();
			if (read === null) return {
				ok: false,
				reason: "write-failed",
				message: "无法读取工作区注册表（存储域与磁盘均不可用），已取消恢复，请重试。"
			};
			const durableArchived = read.state.global?.archivedSessionIds;
			if (!Array.isArray(durableArchived)) return {
				ok: false,
				reason: "registry-unavailable",
				message: "工作区归档集合不可读，恢复已取消。"
			};
			if (!durableArchived.includes(sessionId)) return archivedIds().includes(sessionId) ? {
				ok: false,
				reason: "stale-registry",
				message: "内存态与持久态归档集合不一致，请重启 dsh 后重试。"
			} : {
				ok: false,
				reason: "not-archived",
				message: "该对话不在归档列表中。"
			};
			const commit = await applyWorkspaceMutation(read, sessionId, "restore");
			if (!commit.ok) return commit.rollbackOk ? {
				ok: false,
				reason: "write-failed",
				message: "恢复失败，注册表改动已回滚，可以重试。"
			} : {
				ok: false,
				reason: "partial",
				failedSteps: ["registry", "rollback"],
				message: "恢复失败，且注册表回滚未完全成功；请重启 dsh 后检查状态。"
			};
			markTombstone(sessionId, "restored");
			console.info(`[dsh-session-cleaner] restore ${sessionId}: committed`);
			return {
				ok: true,
				sessionId,
				action: "restore",
				logRemoved: false,
				registryUpdated: true,
				projcacheUpdated: false,
				needsRestart: false,
				message: "已恢复（取消归档），该对话已回到原工作区。"
			};
		});
	}
	async function handlePresets() {
		return {
			ok: true,
			presets: (await ctx.agentPresets.list()).map((preset) => ({
				id: preset.id,
				name: preset.name,
				description: preset.description,
				trust: preset.trust,
				broken: preset.broken
			}))
		};
	}
	async function handleContinue(rawBody) {
		const body = bodyContinue(rawBody);
		if (body === null) return {
			ok: false,
			reason: "bad-request",
			message: "sessionId 或 presetId 无效。"
		};
		const inflightKey = `${body.sessionId}\u0000${body.presetId}`;
		const existing = continueInflight.get(inflightKey);
		if (existing !== void 0) return existing;
		const operation = enqueueMutation(async () => {
			const read = readWorkspaceState();
			if (read === null) return {
				ok: false,
				reason: "registry-unavailable",
				message: "无法读取工作区注册表，续接已取消。"
			};
			const durableArchived = read.state.global?.archivedSessionIds;
			if (!Array.isArray(durableArchived)) return {
				ok: false,
				reason: "registry-unavailable",
				message: "工作区归档集合不可读，续接已取消。"
			};
			if (!durableArchived.includes(body.sessionId)) return archivedIds().includes(body.sessionId) ? {
				ok: false,
				reason: "stale-registry",
				message: "内存态与持久态归档集合不一致，请重启 dsh 后重试。"
			} : {
				ok: false,
				reason: "not-archived",
				message: "只能从已归档对话创建续接会话。"
			};
			if (ctx.sessions.get(body.sessionId)) return {
				ok: false,
				reason: "live",
				message: "源对话正在运行，请重启 dsh 后再创建续接会话。"
			};
			const preset = (await ctx.agentPresets.list()).find((candidate) => candidate.id === body.presetId);
			if (preset === void 0) return {
				ok: false,
				reason: "unknown-preset",
				message: "目标预设不存在，请刷新预设列表后重试。"
			};
			if (preset.broken !== void 0) return {
				ok: false,
				reason: "broken-preset",
				message: `目标预设不可用：${preset.broken}`
			};
			let source;
			try {
				source = await ctx.sessionPersistence.inspect(body.sessionId);
			} catch (error) {
				console.error(`[dsh-session-cleaner] source inspection failed (${body.sessionId}): ${String(error)}`);
				return {
					ok: false,
					reason: "source-unreadable",
					message: "无法读取源对话的完整、已闭合历史。"
				};
			}
			if (source.events.length === 0) return {
				ok: false,
				reason: "source-unreadable",
				message: "源对话没有可续接的持久历史。"
			};
			const childSessionId = `session-${randomUUID()}`;
			const presetBoundary = {
				type: "agent-preset/selected",
				seq: source.events.length,
				time: Date.now(),
				data: { agentPreset: preset.id }
			};
			try {
				const handle = await ctx.agents.create({
					sessionId: childSessionId,
					seed: [...source.events, presetBoundary],
					meta: {
						cwd: source.meta.cwd,
						parentSession: body.sessionId,
						seedLength: source.events.length,
						agentPreset: preset.id
					},
					setup: async (agentCtx) => {
						await ctx.agentPresets.mount(agentCtx, preset.id);
					}
				});
				continuedHandles.set(childSessionId, handle);
			} catch (error) {
				console.error(`[dsh-session-cleaner] continuation create failed (${body.sessionId}): ${String(error)}`);
				return {
					ok: false,
					reason: "create-failed",
					message: error instanceof Error ? error.message : String(error)
				};
			}
			let workspaceAttached = false;
			const sourceWorkspace = ctx.workspaceRegistry.list().find((workspace) => Array.isArray(workspace.sessionIds) && workspace.sessionIds.includes(body.sessionId));
			if (sourceWorkspace !== void 0) try {
				await sourceWorkspace.attachSession(childSessionId);
				workspaceAttached = true;
			} catch (error) {
				console.error(`[dsh-session-cleaner] continuation workspace attach failed (${childSessionId}): ${String(error)}`);
			}
			console.info(`[dsh-session-cleaner] continue ${body.sessionId} -> ${childSessionId}, preset=${preset.id}, attached=${workspaceAttached}`);
			return {
				ok: true,
				action: "continue",
				childSessionId,
				sourceSessionId: body.sessionId,
				presetId: preset.id,
				workspaceAttached,
				message: workspaceAttached ? "已用目标预设创建续接会话，原归档对话保持不变。" : "已用目标预设创建续接会话；工作区挂载失败，新会话将显示在未分组列表。"
			};
		});
		continueInflight.set(inflightKey, operation);
		operation.then(() => continueInflight.delete(inflightKey), () => continueInflight.delete(inflightKey));
		return operation;
	}
	async function handleSweep() {
		return enqueueMutation(async () => {
			const headers = await ctx.sessionPersistence.list();
			const headerIds = new Set(headers.map((header) => String(header.id)));
			const liveIds = new Set(ctx.sessions.list().map((session) => String(session.id)));
			const read = readWorkspaceState();
			if (read === null) return {
				ok: false,
				reason: "registry-unavailable",
				message: "无法读取工作区注册表，未执行任何清理。"
			};
			const rawArchived = read.state.global?.archivedSessionIds;
			if (!Array.isArray(rawArchived)) return {
				ok: false,
				reason: "registry-unavailable",
				message: "工作区归档集合不可读，未执行任何清理。"
			};
			const archived = rawArchived.filter((id) => typeof id === "string");
			const workspaceIds = /* @__PURE__ */ new Map();
			for (const [workspaceId, record] of Object.entries(read.state.tables?.workspaces ?? {})) if (record && Array.isArray(record.sessionIds)) workspaceIds.set(workspaceId, record.sessionIds.filter((id) => typeof id === "string"));
			const projcacheIds = readProjcacheKeys();
			if (projcacheIds === null) return {
				ok: false,
				reason: "write-failed",
				message: "无法读取投影缓存，未执行任何清理。"
			};
			const quarantineFiles = readQuarantineFiles();
			if (quarantineFiles === null) return {
				ok: false,
				reason: "write-failed",
				message: "无法读取隔离目录，未执行任何清理。"
			};
			const plan = planSweep({
				archivedIds: archived,
				headerIds,
				liveIds,
				workspaceSessionIds: workspaceIds,
				projcacheIds
			});
			const removedArchivedIds = [];
			if (plan.archivedGhosts.length > 0) {
				if (!await setWorkspaceGlobal(read.source, {
					...read.state.global,
					archivedSessionIds: archived.filter((id) => !plan.archivedGhosts.includes(id))
				})) return {
					ok: false,
					reason: "partial",
					failedSteps: ["registry"],
					removedArchivedIds,
					removedProjcacheRows: [],
					removedWorkspaceSlots: 0,
					removedQuarantineFiles: 0,
					message: "归档幽灵写回失败，后续清理已停止。"
				};
				removedArchivedIds.push(...plan.archivedGhosts);
				for (const id of plan.archivedGhosts) markTombstone(id, "deleted");
			}
			let removedWorkspaceSlots = 0;
			for (const [workspaceId, orphan] of plan.orphanSlotsByWorkspace) {
				if (!await removeSessionsFromWorkspaceRecord(read.source, workspaceId, orphan)) return {
					ok: false,
					reason: "partial",
					failedSteps: ["workspace-slots"],
					removedArchivedIds,
					removedProjcacheRows: [],
					removedWorkspaceSlots,
					removedQuarantineFiles: 0,
					message: `工作区 ${workspaceId} 的孤儿席位清理失败，后续清理已停止。`
				};
				removedWorkspaceSlots += orphan.length;
			}
			const removedProjcacheRows = [];
			for (const id of plan.orphanProjcacheIds) {
				if (!await removeProjcacheRow(id)) return {
					ok: false,
					reason: "partial",
					failedSteps: ["projcache"],
					removedArchivedIds,
					removedProjcacheRows,
					removedWorkspaceSlots,
					removedQuarantineFiles: 0,
					message: `投影缓存 ${id} 清理失败，后续清理已停止。`
				};
				removedProjcacheRows.push(id);
			}
			let removedQuarantineFiles = 0;
			for (const filePath of quarantineFiles) {
				if (!purgeQuarantineFile(filePath)) return {
					ok: false,
					reason: "partial",
					failedSteps: ["quarantine"],
					removedArchivedIds,
					removedProjcacheRows,
					removedWorkspaceSlots,
					removedQuarantineFiles,
					message: "隔离日志清理失败，其余未处理隔离项已保留。"
				};
				removedQuarantineFiles += 1;
			}
			const total = removedArchivedIds.length + removedProjcacheRows.length + removedWorkspaceSlots + removedQuarantineFiles;
			console.info(`[dsh-session-cleaner] sweep: archived=${removedArchivedIds.length}, slots=${removedWorkspaceSlots}, projcache=${removedProjcacheRows.length}, quarantine=${removedQuarantineFiles}`);
			return {
				ok: true,
				removedArchivedIds,
				removedProjcacheRows,
				removedWorkspaceSlots,
				removedQuarantineFiles,
				message: total === 0 ? "没有发现残留。" : `已清理 ${removedArchivedIds.length} 条归档幽灵、${removedProjcacheRows.length} 条孤儿缓存、${removedWorkspaceSlots} 个孤儿席位与 ${removedQuarantineFiles} 个隔离日志。`
			};
		});
	}
	async function route(req, res) {
		const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
		if (!pathname.startsWith(API_PREFIX)) {
			send(res, 404, {
				ok: false,
				reason: "not-found",
				message: "未知端点"
			});
			return;
		}
		if (!originAllowed(req)) {
			send(res, 403, {
				ok: false,
				reason: "forbidden",
				message: "拒绝跨站请求"
			}, { vary: "Origin" });
			return;
		}
		const sub = pathname.slice(24);
		try {
			if (req.method === "GET" && (sub === "" || sub === "/" || sub === "/list")) {
				send(res, 200, await handleList());
				return;
			}
			if (req.method === "GET" && sub === "/presets") {
				send(res, 200, await handlePresets());
				return;
			}
			if (req.method === "POST" && !mutationRequestAllowed(req)) {
				send(res, 403, {
					ok: false,
					reason: "forbidden",
					message: "请求缺少同源操作凭据"
				}, { vary: "Origin" });
				return;
			}
			if (req.method === "POST" && sub === "/delete") {
				const result = await handleDelete(await readJsonBody(req));
				send(res, statusFor(result), result);
				return;
			}
			if (req.method === "POST" && sub === "/restore") {
				const result = await handleRestore(await readJsonBody(req));
				send(res, statusFor(result), result);
				return;
			}
			if (req.method === "POST" && sub === "/continue") {
				const result = await handleContinue(await readJsonBody(req));
				send(res, statusFor(result), result);
				return;
			}
			if (req.method === "POST" && sub === "/sweep") {
				await readJsonBody(req);
				const result = await handleSweep();
				send(res, statusFor(result), result);
				return;
			}
			send(res, 404, {
				ok: false,
				reason: "not-found",
				message: "未知端点"
			});
		} catch (error) {
			if (error instanceof RequestBodyError) {
				send(res, error.status, {
					ok: false,
					reason: "bad-request",
					message: error.message
				});
				return;
			}
			send(res, 500, {
				ok: false,
				reason: "internal",
				message: error instanceof Error ? error.message : String(error)
			});
		}
	}
	const runtime = {
		tombstones,
		route
	};
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: API_PREFIX,
		handler: (req, res) => runtime.route(req, res)
	}), "dsh-session-cleaner: routes");
	ctx.effect(() => async () => {
		const handles = [...continuedHandles.values()];
		continuedHandles.clear();
		await Promise.allSettled(handles.map((handle) => handle.dispose()));
	}, "dsh-session-cleaner: continuation cleanup");
	/** Titles from the projection cache, domain memory first; fail-soft. */
	function readTitles() {
		const result = /* @__PURE__ */ new Map();
		const collect = (sessions) => {
			for (const [id, record] of Object.entries(sessions ?? {})) {
				const value = record?.rows?.title?.val;
				result.set(id, typeof value === "string" && value.length > 0 ? value : null);
			}
		};
		let domain;
		try {
			domain = domainOf("session_projcache");
		} catch {
			domain = void 0;
		}
		if (domain !== void 0) try {
			const sessions = {};
			for (const [key, value] of domain.table("sessions").entries()) sessions[key] = value;
			collect(sessions);
			return result;
		} catch {}
		try {
			collect(JSON.parse(readFileSync(dshHomePath("storages", "session_projcache.json"), "utf8"))?.tables?.sessions);
		} catch {}
		return result;
	}
}
function send(res, status, value, extraHeaders = {}) {
	const body = JSON.stringify(value);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
		...extraHeaders
	});
	res.end(body);
}
function statusFor(result) {
	if (result.ok) return 200;
	switch (result.reason) {
		case "bad-id":
		case "bad-request":
		case "unknown-preset": return 400;
		case "forbidden": return 403;
		case "not-found": return 404;
		case "not-archived":
		case "live":
		case "stale-registry":
		case "broken-preset":
		case "unsupported-backend": return 409;
		default: return 500;
	}
}
/** Same-origin browser guard: an Origin header must match the request Host. */
function originAllowed(req) {
	const origin = req.headers.origin;
	if (origin === void 0) return true;
	try {
		return new URL(origin).host === req.headers.host;
	} catch {
		return false;
	}
}
function mutationRequestAllowed(req) {
	if (req.headers[MUTATION_HEADER] !== "1") return false;
	const site = req.headers["sec-fetch-site"];
	return site === void 0 || site === "same-origin";
}
function bodySessionId(rawBody) {
	if (typeof rawBody !== "object" || rawBody === null) return null;
	const sessionId = rawBody.sessionId;
	if (typeof sessionId !== "string" || !SESSION_ID_PATTERN.test(sessionId)) return null;
	return sessionId;
}
function bodyContinue(rawBody) {
	if (typeof rawBody !== "object" || rawBody === null) return null;
	const body = rawBody;
	if (typeof body.sessionId !== "string" || !SESSION_ID_PATTERN.test(body.sessionId)) return null;
	if (typeof body.presetId !== "string" || body.presetId.length < 1 || body.presetId.length > 128) return null;
	return {
		sessionId: body.sessionId,
		presetId: body.presetId
	};
}
async function readJsonBody(req) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
		size += buffer.length;
		if (size > MAX_BODY_BYTES) throw new RequestBodyError(413, "请求体超过 64KB 限制");
		chunks.push(buffer);
	}
	const text = Buffer.concat(chunks).toString("utf8");
	if (text === "") return {};
	try {
		return JSON.parse(text);
	} catch {
		throw new RequestBodyError(400, "请求体不是有效的 JSON");
	}
}
/** Disk fallback: read a storage document, transform it, write it back atomically. */
function rewriteStorage(fileName, transform) {
	const target = dshHomePath("storages", fileName);
	try {
		const next = transform(readFileSync(target, "utf8"));
		if (next === null) return false;
		writeAtomicSync(target, next);
		return true;
	} catch {
		return false;
	}
}
function writeAtomicSync(target, text) {
	const tmp = `${target}.dsh-session-cleaner.${process.pid}.${randomUUID()}.tmp`;
	try {
		writeFileSync(tmp, text, "utf8");
		renameSync(tmp, target);
	} finally {
		if (existsSync(tmp)) try {
			rmSync(tmp);
		} catch {}
	}
}

//#endregion
export { apply, inject, name };
//# sourceMappingURL=index.js.map
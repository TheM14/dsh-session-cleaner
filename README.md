# dsh-session-cleaner

**English** | [简体中文](README.zh-CN.md)

An archived-session management plugin for DeepSeek Harness. It adds an **Archived Conversations** page to Settings with restore, safe deletion, leftover cleanup, and continuation under a new agent preset.

The plugin does not replace existing menus or rewrite a source session's header or event history. Its UI uses the host's semantic design tokens and follows the active theme.

## Features

- List archived conversations by workspace with title, creation time, log status, and live status.
- Display each session's effective preset and flag a missing or broken source preset.
- Restore a conversation to its original workspace, with immediate official-sidebar updates.
- Permanently delete an archived conversation through a rollback-aware quarantine and commit flow.
- Clean ghost archive entries, orphan workspace slots, orphan projection-cache rows, and quarantined logs.
- Create a full-history continuation with any available system or user preset while preserving the archived source.

## Requirements

- A DeepSeek Harness release compatible with `0.1.0-rc.6`.
- Node.js and npm.
- The dsh Web profile; this plugin's client bundle targets the Web platform.

## Installation

Clone and build the repository:

```powershell
git clone <repository-url>
cd dsh-session-cleaner
npm install
npm run build
```

Add the repository's absolute path to the dsh Web profile, then restart `dsh web`:

```powershell
dsh plugin --profile web add (Get-Location).Path
dsh web
```

To uninstall:

```powershell
dsh plugin --profile web remove dsh-session-cleaner
```

## Usage

1. Open dsh Settings and select **Archived Conversations**.
2. Select **Restore** to return a conversation to its original workspace.
3. Select **Delete** and confirm to permanently remove its log and registry data.
4. Choose a target preset and select **Continue with preset** to create a new session with the complete inherited history.
5. Select **Clean leftovers** to remove safely identifiable residue from earlier operations or external state changes.

Deletion is permanent. A live session is never deleted. If the host still owns a session, restart dsh and do not open that session again before deleting it.

## Data Safety

Deletion follows this order:

```text
verify archived + not live
  -> rename log into quarantine
  -> commit workspace registry
  -> commit projection cache
  -> purge quarantined log
```

If the registry or projection-cache write fails, the plugin stops and attempts to roll back prior changes. If logical deletion commits but final file cleanup fails, the quarantined log remains under `$DSH_HOME/storages/.dsh-session-cleaner-trash/` and can be removed by **Clean leftovers**.

Sweep reads every required state before it starts writing. Any prerequisite read failure aborts the cleanup. A staged write failure also stops later stages and returns the completed counts.

Every POST request requires a plugin-specific sentinel header. The host also validates `Origin`, `Sec-Fetch-Site`, session-id syntax, and a 64KB request-body limit.

## Continue With a New Preset

Continuation creates a lineage child through the public `ctx.agents.create` and `ctx.agentPresets.mount` services:

- the seed contains the source session's complete durable event prefix;
- a target `agent-preset/selected` boundary is appended;
- metadata records `parentSession`, `seedLength`, and the target `agentPreset`;
- the child is attached to the source workspace after creation;
- the source log, header, and archive state remain untouched.

Real Web validation confirmed that the complete history renders, the target preset survives a cold restart, and the source log hash remains unchanged.

## Development

```powershell
npm run build
npm test
npx tsc --noEmit -p tsconfig.json
```

`npm test` cleans and rebuilds `lib/` before running the pure-logic and fake-host route tests. Prebuilt Host and Client bundles, declarations, and sourcemaps live in `lib/` and are intentionally committed.

See [plugin-design.md](plugin-design.md) for the detailed transaction, security, and architecture decisions.

## License

[MIT](LICENSE)

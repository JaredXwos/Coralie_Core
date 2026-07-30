---
name: orchestrate-container-codex-workers
description: Coordinate container-codex workers for agent-owned repository changes. Use when repository writes must run in a container worker, when commit and verification require separate agents, or when recovering safely after a worker timeout.
---

# Orchestrate Container Codex Workers

## Roles

- If you are the coordinator and container-codex is available, remain read-only and delegate repository writes to a container worker.
- If you are a worker explicitly assigned edits inside `/workspaces/Coralie_Core`, edit directly and do not recursively delegate.
- Do not expand the requested scope.

## Workflow

1. Record the initial branch, HEAD, and status. Preserve unrelated and user changes.
2. Run read-only analysis in parallel when useful. Give each editing worker an explicit, non-overlapping file scope.
3. Assign implementation to a container worker. Require edits through `apply_patch` and prohibit scope expansion.
4. Treat a timeout as indeterminate, not a failure. Inspect repository status and diff before retrying. Use `codex-reply` only when the timed-out invocation returned a thread ID.
5. The coordinator delegates integration and the required build/validation commands to an integration worker. The assigned integration worker runs `npm run build`, `npm run typecheck`, `npm test`, and `git diff --check` directly and does not recursively delegate. Because `dist/` is tracked, regenerate it with `npm run build` whenever relevant.
6. Only when the user explicitly requests a commit, assign a dedicated commit worker. Have it stage and commit exactly the relevant files; do not push.
7. Assign a fresh, independent verification worker. Have it verify the exact commit, confirm an initially clean status, perform a deterministic rebuild and test run, and confirm a final clean status.
8. Push only after explicit user approval, normally from the host when requested.

## Diagnose Anomalies

Check, in order:

1. `pwd`
2. Repository root
3. Expected file visibility
4. The direct runner
5. The exact failing command in a fresh session

## Report

Report changed files, validation results, commit identifier or absence, final clean or dirty state, and push state.

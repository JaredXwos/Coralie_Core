# Repository Agent Policy

- A coordinating agent with container-codex available must remain read-only and delegate repository writes to a container worker. A worker explicitly assigned edits may edit directly and must not recursively delegate.
- Record the initial branch, HEAD, and status. Preserve unrelated and user changes.
- Use `$orchestrate-container-codex-workers` for agent-owned repository workflows.
- `dist/` is tracked. Regenerate it with `npm run build` when relevant.
- Before any commit, require `npm run build`, `npm run typecheck`, `npm test`, and `git diff --check`.
- For agent-owned commit workflows, use separate implementation, commit, and verification workers.
- Treat a worker timeout as indeterminate. Inspect status and diff before retrying.
- Never stage, commit, or push unless explicitly requested. Push only after explicit approval.

# Changelog

## 0.1.0 — 2026-11-19

First working version.

- Sidebar panel (`sidebar.panellist` order 25 + the `main` key `xyq`) with the
  same page. The Settings page alone was not reachable: the sidebar foot that
  hosts the `settings.section` seat is not drawn in every shell, so the panel
  row is the dependable door.
- Settings page (`settings.section`, order 63) with CLI status, sign-in state,
  credit balance, image/video model lists, recent runs, and the state and
  download directories.
- Composer status pill (`conversation.composer.dock`, order 20) sharing the
  panel snapshot.
- Six tools: `xyq_status`, `xyq_models`, `xyq_generate_image`,
  `xyq_generate_video`, `xyq_result`, `xyq_upload`.
- Two web routes: `GET /dsh-xyq/v2/state` and `POST /dsh-xyq/v2/action`, both
  rejected with 401 unless the request carries an authenticated harness
  session cookie. The state route exposes the account, the credit balance, and
  recent prompts, so it is not a public read either.
- The route path carries a tag (`ROUTE_TAG` in `lib/index.js`, mirrored by hand
  in `lib/client.js` because the two halves are separate bundles). The web
  server never releases a route it accepted, so a process that started before
  the trampoline existed could not be moved to the new code by any reload: the
  old `/dsh-xyq/state` stayed bound to the old handler. A path that was never
  registered is always free, so bumping the tag is the one way to reach an
  already-running harness. Bump it only for a change the old path cannot absorb
  on its own; ordinary logic changes ride the trampoline.
- Run journal in `<DSH home>/xyq/runs.json`, capped at 60 entries, so a run
  survives a restart and can be resumed by id. The journal is re-read when the
  file changed under it, because a second instance may have advanced it.
- CLI discovery by config path, then the installed package next to `PATH`, the
  Node executable, the npm global directory, and the profile `node_modules`,
  falling back to the package's `scripts/run.js`.
- A reload (disable then enable) serves the new code. Measured against the real
  loader: the scene keeps the route objects it accepted and `register` throws on
  a duplicate `(kind, path)` — the throwing registration is the reloaded one, so
  the object that survives closes over the *older* module copy. That is how the
  panel showed the previous journal and an empty model list while the tools were
  correct. Each route now installs a trampoline that reads the newest handler
  from a `Symbol.for` table on `globalThis`, which survives a module reload; the
  run journal re-reads its file, and the model cache never stores an empty or
  failed result. `scripts/host-smoke.mjs` mounts twice and asserts the surviving
  route object serves the newest config and journal.
- `--ratio` accepts what a person reads: image models take an integer code
  (`3` = 9:16) while video models take a label (`9:16`), so the label is folded
  through the model's own `option_labels` table first.
- `query-result` needs both ids at once. One id is now completed from the run
  journal; a still-running task exits non-zero with a valid payload, so success
  is decided by the payload, not the exit code.
- `xyq_models` with a name answers a short summary instead of the raw response:
  a video model's description is tens of kilobytes of pricing and material
  limits, which would swamp a reply.

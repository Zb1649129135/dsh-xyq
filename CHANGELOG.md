# Changelog

## 0.1.1 — 2026-11-20

Four fixes from a UI review. The page is a status view and now says so.

- The run card states plainly that the page cannot submit: generation starts in
  the conversation. An empty card used to look like a missing button, so the
  sentence sits above the list whether or not runs exist. `detail/DETAIL*.md`
  say the same.
- Sign-in reports both outcomes. The request that starts `login` returns while
  the browser is still open, so the page now watches `state.login` flip from
  running to finished and then shows the CLI's error, or clears the note when the
  account came back. A failed sign-in also turns the button into "sign in again"
  (`signInForce`, previously defined and unused) and forces a fresh credential,
  because the usual failure is a stale local token.
- The Downloads button opens the download folder. The host spawns the platform
  opener (`open`, `explorer`, `xdg-open`), detached and unref'd, so a missing
  file manager cannot take the process down; it returns whether the opener
  started. Its label was a copy of the read-only path row above it.
- Check reports progress and hands back the files. It shows a "checking, media
  may be downloaded" note while the call runs (it can take minutes), and then a
  result card listing each downloaded path with an Open button and a `draft`
  badge on preview videos. A new `open-file` action opens one of them; it refuses
  any path outside the download directory, so the action route is not a general
  file opener. Removing a run asks first.
- `scripts/client-render.mjs` drives the Check path end to end and asserts the
  result card lists both files with the draft badge; `scripts/host-smoke.mjs`
  asserts `open-file` refuses an outside path and a missing one.

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

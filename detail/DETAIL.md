# Xiaoyunque

Xiaoyunque (小云雀, XYQ, Pippit) generates images and videos from a prompt. The
official `pippit-tool-cli` already does the work; this plugin puts it under one
roof inside DeepSeek Harness, so an agent can generate media and a person can
see what happened.

## What it adds

- A sidebar panel, **小云雀**, beside the other panel rows, plus a page under
  Settings. Both show the same thing: whether the CLI is installed, whether you
  are signed in, how many credits remain, the model catalogue for images and
  videos, and the runs started from this harness.
- A quiet status pill below the composer with the signed-in state and credit
  balance, so you notice an expired sign-in before a generation fails.
- Six agent tools: `xyq_status`, `xyq_models`, `xyq_generate_image`,
  `xyq_generate_video`, `xyq_result`, `xyq_upload`.

Three seats, one page. The sidebar row is the dependable door, because the
sidebar foot that hosts the Settings seat is not drawn in every shell; each seat
is registered through `slots.inject`, so an absent one costs that entry and
nothing else.

The page reports, it does not submit. Generation starts in the conversation —
you ask the agent for an image or a video and `xyq_generate_image` /
`xyq_generate_video` run — and the panel then lists the run, checks its progress,
and opens the downloaded files. Nothing on the page can start a generation, and
it says so above the run list rather than leaving an empty card that looks like a
missing button.

## The CLI is the engine

Every operation shells out to `pippit-tool-cli` and reads its JSON. Nothing here
reimplements the HTTP API, so a CLI upgrade upgrades the plugin's reach. The
plugin looks for the binary in this order:

1. `cliPath` from the plugin config, when set.
2. `bin/pippit-tool-cli.exe` inside an installed `@pippit-dev/cli` package, found
   by walking `PATH`, the directory around the running Node executable, the npm
   global directory, and the profile's own `node_modules`.
3. `scripts/run.js` of that package, launched with the current Node executable.

Install the CLI with `npx @pippit-dev/cli@latest install` and sign in with
`pippit-tool-cli login`. The panel repeats both hints when it finds something
missing.

## Generation returns a handle, not a file

`generate-image` and `generate-video` submit a run and return a thread id, a run
id, and a web link. The media arrives later. Ask for it with `xyq_result`, which
calls `query-result` and downloads into **that run's own folder**. Each run is
recorded in `runs.json` next to the plugin state, so the panel can list recent
work even after a restart, and `xyq_result` can resume a run by id alone.

## Media follows the workspace

At first every run downloaded into one shared folder, which is wrong: the media
is the product of this piece of work, so it belongs next to it. The folder is
now decided at submit time and written into the run journal:

```
<session workspace>/.xyq/<first 8 chars of the run id>/
```

It is decided at **submit** time and stored on the **run** rather than at poll
time from the caller, because the two callers know different things. A tool has
`exec.agent` and can read the session's workspace (authoritatively from the
host's `workingDirectory` service; `session.header.cwd` is only where the
session started and cannot follow a later move). The panel button goes over
HTTP, has no agent at all, and knows nothing. Recording the decision on the run
means a later poll lands in the same folder whichever side asks.

`downloadDir` therefore degrades into a fallback: it only receives runs with no
workspace, plus runs submitted before this change, whose journal entries have no
folder field. Old runs are not migrated — they are already where they are. The
`dir` argument of `xyq_result` overrides the landing folder for one call and is
not written back to the run.

Both "open" actions follow the same shift: `open-file` accepts only files inside
these product folders, and `open-download-dir` only folders this plugin itself
writes to, because either action can be triggered from the page.

## Reloading

Disabling and re-enabling the plugin is enough to load a changed `lib/*.js`; no
restart. That sounds like a detail, but it forced one design decision. The host
web server keeps the route object it accepted and throws on a second
registration for the same `(kind, path)` — the throwing registration is the
reloaded one, so the object that stays behind closes over the *older* module
copy. The panel then shows the previous journal and an empty model list while
the tools, served by the new fiber, are correct.

So each route installs a trampoline that looks up the newest handler in a
`Symbol.for` table on `globalThis`, which the reloaded copy overwrites. The run
journal also re-reads its file before every read (a second instance may have
advanced it), and the model cache refuses to store an empty or failed result, so
a transient failure cannot look like a missing catalogue for five minutes.

One consequence worth stating plainly: the trampoline only helps once a copy of
it is actually holding the route. A process that started before this code
existed keeps serving the handler it registered then, and no reload can reach
it — because the web server never releases an accepted route either.

That is why the path is tagged (`/dsh-xyq/v2/state`, `/dsh-xyq/v2/action`). A
path that was never registered is always free, so a bump registers cleanly even
in a harness that has been running for hours, and the new copy starts serving
immediately without a restart. The tag lives in two files because the host and
client halves ship as separate bundles that cannot import each other; keep them
equal by hand. Bump it only for a change the old path cannot absorb on its own —
ordinary logic changes ride the trampoline.

## Configuration

| Key | Meaning |
| --- | --- |
| `cliPath` | Explicit path to the CLI. Empty means auto-discover. |
| `cwd` | Working directory for CLI calls. The CLI reads `config.toml` from its current directory, so this is how you point it at a PPE environment. |
| `downloadDir` | Where runs without a workspace — and runs submitted before this change — save media. Empty means `<DSH home>/xyq/downloads`. A run with a workspace lands in `<workspace>/.xyq/<run id>/` and ignores this key. |
| `teamId` | Team space id. Empty means the CLI's own default; `0` means the personal space. |
| `stateTtlMs` | How long a state snapshot is reused before the next CLI call. |

## Credentials

Sign-in uses the CLI's browser loopback flow. The plugin never reads, stores, or
prints the access key. `XYQ_ACCESS_KEY` in the environment still wins over a
browser login, which is why signing out here clears the local credential but
cannot clear an environment variable the CLI inherited.

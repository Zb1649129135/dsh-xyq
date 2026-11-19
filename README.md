# dsh-xyq

A DeepSeek Harness plugin for Xiaoyunque (小云雀 / XYQ / Pippit). It surfaces the
`pippit-tool-cli` toolkit inside the harness: a sidebar panel with sign-in state
and credits, a status pill under the composer, and six agent tools that
generate images and videos, upload source files, and fetch results.

```bash
npx @pippit-dev/cli@latest install   # the engine
pippit-tool-cli login                # then sign in
```

Then install the plugin from this directory with `plugin_manager
install_bundle` (target = the absolute path) and click 小云雀 in the sidebar.

The plugin declares three client seats, and any of them is enough to reach it:

| Seat | What it draws |
| --- | --- |
| `sidebar.panellist` + `main` | The 小云雀 row in the sidebar and the panel page behind it. |
| `settings.section` | A page under Settings, at order 63. |
| `conversation.composer.dock` | The status pill under the composer. |

Each seat is registered through `slots.inject`, so a shell that never declares
one leaves that entry absent instead of failing to boot.

## Tools

| Tool | Does |
| --- | --- |
| `xyq_status` | CLI location and version, sign-in state, credential expiry, credit balance. |
| `xyq_models` | Image or video model catalogue; pass a name to describe one model. |
| `xyq_generate_image` | Submit an image run. Needs `prompt` and `model`. |
| `xyq_generate_video` | Submit a video run; accepts reference images, videos, and audio. |
| `xyq_result` | Read a run, download its media, and report where it landed. |
| `xyq_upload` | Upload a local file or an HTTPS URL and return the asset id. |

Generation returns a thread id, a run id, and a web link — the media follows
later, which is what `xyq_result` is for. Pass either id: the other one is
recovered from the run journal.

## Layout

```
dsh-xyq/
  lib/cli.js      launch discovery, JSON parsing, one child process per call
  lib/store.js    state directory, run journal, atomic JSON writes
  lib/ops.js      every CLI operation, plus the cached state snapshot
  lib/index.js    tools and web routes (host half)
  lib/client.js   sidebar panel, settings page, composer pill (web half)
  locale/         en.json, zh.json — plugin manager metadata
  detail/         the long description shown on the plugin page
```

## Configuration

`cliPath`, `cwd`, `downloadDir`, `teamId`, `stateTtlMs` — documented in
[detail/DETAIL.md](detail/DETAIL.md). They are set on the plugin row, so a
change needs no rebuild.

## Notes

- The plugin never reads the access key. Sign-in shells out to
  `pippit-tool-cli login`, which stores the credential itself.
- Nothing is polled in the background. The panel refreshes on open, on window
  focus, and on demand; the pill shares that snapshot.
- The web routes require the harness browser session, so a script — or a model
  with shell access — cannot drive the CLI on your behalf.
- Disabling and enabling the plugin is enough to pick up a changed `lib/*.js`;
  no restart is needed. The routes are owned by the plugin's fiber, and the
  surviving route objects read the newest handler through a table on
  `globalThis`, because the web server refuses a second registration for the
  same path.

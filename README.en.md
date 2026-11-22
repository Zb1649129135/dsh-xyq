# dsh-xyq

A DeepSeek Harness plugin for Xiaoyunque (小云雀 / XYQ / Pippit). It surfaces the
`pippit-tool-cli` toolkit inside the harness: a sidebar panel with sign-in state
and credits, a status pill under the composer, and six agent tools that
generate images and videos, upload source files, and fetch results.

## Install

Install the engine first, then the plugin:

```bash
npx @pippit-dev/cli@latest install   # the engine
pippit-tool-cli login                # then sign in

dsh plugin --profile web add dsh-xyq # the plugin
```

Replace `web` with your profile name if it differs, and pin a version with
`dsh-xyq@0.2.0`. Afterwards click 小云雀 in the sidebar, or find the same page
under Settings.

DeepSeek Harness Desktop manages its own profile, and the `dsh` command above
refuses `--profile desktop` outright. Desktop users install in the app:
Settings → Plugins, then enter `dsh-xyq`. For the command line, quit the desktop
app completely first and use the CLI that ships with it, which is allowed to
manage that profile:

```bash
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  plugin --profile desktop add dsh-xyq
```

To run a checkout instead of a release, install the directory rather than the
name — pnpm links it, and `files` stops filtering:

```bash
dsh plugin --profile web add /absolute/path/to/dsh-xyq
```

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

### Video arguments: the service wants four, the model knows the defaults

The service requires `model`, `ratio`, `duration_sec` and `resolution`, and the
CLI supplies none of them. You may therefore omit all four — the plugin fills
them from the model's own parameter table — but the request always carries them.

The ratio and the resolution are checked locally. The CLI **posts the task and
then** lets the service reject it, so a bad ratio costs a wasted run. Which values
are legal depends on the model (`wan3.0` has no 21:9, `happyhorse-1.1` has no
adaptive, the mini models take no resolution at all), so read them from
`xyq_models` for the model you picked.

`xyq_result` always passes `--download-dir`, which the CLI also treats as
mandatory; there is no option to skip the download. A video run records the
arguments it was submitted with, and the reply repeats them.

## Where the media lands

A run submitted from a conversation stores its media **in that session's
workspace**, one folder per conversation:

```
<workspace>/.xyq/<first 8 chars of the session id>/
```

Everything generated from one conversation — images and videos alike — sits in
that single folder, so a batch is obvious at a glance and no run gets a folder
of its own. A conversation that generated nothing leaves no folder behind.

The folder is recorded when the run is submitted, so a later poll lands in the
same place whichever caller asks — the panel button, `xyq_result`, or another
session. `downloadDir` is therefore no longer the landing folder for everything;
it only receives runs that have no workspace, such as ones submitted before this
change. The `dir` argument of `xyq_result` overrides the location for one call
and is not written back to the run.

Every run row carries an "open folder" button, and the result card shows the
folder belonging to the conversation.

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
  assets/pay/     WeChat Pay and Alipay QR codes
```

## Configuration

`cliPath`, `cwd`, `downloadDir`, `teamId`, `stateTtlMs` — documented in
[detail/DETAIL.md](detail/DETAIL.md). They are set on the plugin row, so a
change needs no rebuild. `downloadDir` is only where runs without a workspace
(including older ones) land.

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
- That trampoline only helps once a copy of it is holding the route. A harness
  started before it existed keeps serving the handler it registered then, and no
  reload can reach it — so the path is tagged (`/dsh-xyq/v2/…`). A path that was
  never registered is always free, which is what makes the tag work on an
  already-running harness. Bump it only for a change the old path cannot absorb;
  ordinary changes ride the trampoline.

## Buy the author a coffee

This plugin was built in the gaps between other things — evenings, weekends, the
odd half hour before a meeting. Plenty of it was not fun: `pippit-tool-cli` will
append a notice line to its stdout at any moment, so the JSON has to be fished
back out of the noise; the harness web server refuses a second registration for
the same path, so the routes ride a trampoline table on `globalThis`; and the
sidebar panel has to serve three client seats at once, none of which may be
allowed to stop the plugin from booting. There was no budget and no deadline
behind any of it. Only the fact that I wanted to use it myself.

So it is free, has no ads, and collects nothing. The code is all here to read
and change. If it genuinely saved you a few hours — or you would simply rather
it did not quietly stop being maintained one day — scan one of the codes below.
Any amount is fine; a one-yuan instant coffee wakes me up just as well as a
thirty-yuan pour-over.

| WeChat Pay | Alipay |
| :---: | :---: |
| <img src="assets/pay/wechat.png" alt="WeChat Pay QR code" width="220"> | <img src="assets/pay/alipay.png" alt="Alipay QR code" width="220"> |

No need to scan anything, though. Filing an issue that says exactly where you
got stuck, pointing out a vague sentence in the docs, or just passing the plugin
on to someone who might use it — those help more than money does, and they make
it better.

Thanks for reading this far, and for spending your time here.

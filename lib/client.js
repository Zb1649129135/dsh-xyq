/**
 * dsh-xyq — client half.
 *
 * Two pieces of UI, both registered through the Slots service:
 *   • a Settings page (settings.section + settings.section.icon) that shows the
 *     CLI state, the login state, the credit balance, the model catalog and the
 *     recent runs, and offers the few human-only actions;
 *   • a composer pill (conversation.composer.dock) that says, in one line,
 *     whether Xiaoyunque is usable right now.
 *
 * The factory below must stay side-effect free: it only builds the module. All
 * DOM work happens inside `apply`, whose registrations are owned by the calling
 * fiber and torn down with it.
 */

window.__ModuleLoader__.load({
  id: "dsh-xyq",
  factory(require) {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require("react");
    var h = React.createElement;

    /** Slot ids, kept in one place because the host sorts by `order`. */
    var SETTINGS_SLOT = "settings.section";
    var SETTINGS_ICON_SLOT = "settings.section.icon";
    var DOCK_SLOT = "conversation.composer.dock";
    var PANELLIST_SLOT = "sidebar.panellist";
    var MAIN_SLOT = "main";
    var SETTINGS_ID = "xyq";
    /** Sits in the gap between windows-mcp-settings (62) and bili (100). */
    var SETTINGS_ORDER = 63;
    /** Sits after activity (0), usage (1) and the qoder credit chip (10). */
    var DOCK_ORDER = 20;
    /**
     * The sidebar row sits next to the other panel entries (10, 20, 30). It is
     * the reachable door to this plugin: the Settings page keeps its own seat,
     * but the sidebar foot that hosts that seat is not drawn in every shell.
     */
    var PANEL_ORDER = 25;
    var STYLE_ID = "dsh-xyq-styles";
    /**
     * Kept equal to `ROUTE_TAG` in `lib/index.js` by hand: the host and the client
     * are separate bundles, so neither can import the other. Bump both together
     * when the route layer itself changes.
     */
    var ROUTE_TAG = "v2";
    var STATE_ROUTE = "/dsh-xyq/" + ROUTE_TAG + "/state";
    var ACTION_ROUTE = "/dsh-xyq/" + ROUTE_TAG + "/action";

    /** Every user-visible string, in both languages. */
    var COPY = {
      en: {
        title: "Xiaoyunque",
        subtitle: "Image and video generation through pippit-tool-cli.",
        cli: "CLI",
        cliFound: "found",
        cliMissing: "not found",
        version: "Version",
        login: "Account",
        loggedIn: "Signed in",
        loggedOut: "Signed out",
        signIn: "Sign in",
        signInForce: "Sign in again",
        signOut: "Sign out",
        signingIn: "Waiting for the browser…",
        credit: "Credit",
        creditUnit: "points",
        refresh: "Refresh",
        models: "Models",
        imageModels: "Image",
        videoModels: "Video",
        noModels: "No models loaded yet.",
        modelsNeedLogin: "Sign in to read the model catalog.",
        runs: "Recent runs",
        noRuns: "Nothing submitted yet.",
        query: "Check",
        forget: "Remove",
        downloadDir: "Shared folder",
        taskDir: "This run",
        stateDir: "State",
        taskDirRule: "A run submitted in a conversation stores its media in that workspace, under .xyq/<run id>. The shared folder only receives runs with no workspace.",
        team: "Space",
        personalSpace: "Personal",
        hintInstall: "Install with npx @pippit-dev/cli@latest install, then leave cliPath empty or point it at the binary.",
        hintLogin: "Sign in opens the browser once; the credential stays on this machine.",
        pillReady: "Xiaoyunque",
        pillLoggedOut: "Xiaoyunque · sign in",
        pillMissing: "Xiaoyunque · no CLI",
        pillCredit: "{{n}} pts",
        loading: "Loading…",
        failed: "Request failed",
        statusSubmitted: "submitted",
        hintAsk: "This page shows state; it cannot submit. Start a run in the conversation — ask the agent to generate an image or a video with Xiaoyunque — and the files appear here.",
        openFolder: "Open folder",
        opened: "Opened",
        openFile: "Open",
        imageResult: "Image",
        videoResult: "Video",
        draftBadge: "draft",
        checking: "Checking… media may be downloaded, which can take minutes.",
        filesReady: "{{n}} file(s) ready",
        loginRunning: "Waiting for the browser…",
        loginFailed: "Sign-in failed",
        confirmForget: "Remove this run from the list? The media stays in the download folder.",
        result: "Result",
        noFiles: "No media yet — check again once the run finishes.",
      },
      zh: {
        title: "小云雀",
        subtitle: "通过 pippit-tool-cli 生成图片与视频。",
        cli: "CLI",
        cliFound: "已找到",
        cliMissing: "未找到",
        version: "版本",
        login: "账号",
        loggedIn: "已登录",
        loggedOut: "未登录",
        signIn: "登录",
        signInForce: "重新登录",
        signOut: "退出登录",
        signingIn: "正在等待浏览器授权…",
        credit: "积分",
        creditUnit: "分",
        refresh: "刷新",
        models: "模型",
        imageModels: "图片",
        videoModels: "视频",
        noModels: "还没有读取模型列表。",
        modelsNeedLogin: "登录后才能读取模型目录。",
        runs: "最近任务",
        noRuns: "还没有提交过任务。",
        query: "查询",
        forget: "移除",
        downloadDir: "共享目录",
        taskDir: "本次任务",
        stateDir: "状态目录",
        taskDirRule: "在对话里提交的任务，产物落在该工作区的 .xyq/<任务 id>/ 下；共享目录只接没有工作区的任务。",
        team: "空间",
        personalSpace: "个人",
        hintInstall: "先运行 npx @pippit-dev/cli@latest install，然后 cliPath 留空或指向可执行文件。",
        hintLogin: "登录只会打开一次浏览器，凭证保存在本机。",
        pillReady: "小云雀",
        pillLoggedOut: "小云雀 · 未登录",
        pillMissing: "小云雀 · 未装 CLI",
        pillCredit: "{{n}} 分",
        loading: "加载中…",
        failed: "请求失败",
        statusSubmitted: "已提交",
        hintAsk: "这一页只显示状态，不能提交任务。在对话里让小云雀生成图片或视频，产物会回到这里。",
        openFolder: "打开文件夹",
        opened: "已打开",
        openFile: "打开",
        imageResult: "图片",
        videoResult: "视频",
        draftBadge: "草稿",
        checking: "查询中… 可能要下载产物，需要几分钟。",
        filesReady: "{{n}} 个文件已就绪",
        loginRunning: "正在等待浏览器授权…",
        loginFailed: "登录失败",
        confirmForget: "从列表里移除这条任务？产物仍留在下载目录。",
        result: "结果",
        noFiles: "还没有产物——任务完成后再查询一次。",
      },
    };

    /** The active copy, following the Host locale and falling back to the browser. */
    function copy() {
      var language = "";
      try {
        if (hostLocale !== null && typeof hostLocale.getLocale === "function") {
          language = String(hostLocale.getLocale().active || "");
        }
      } catch (error) {
        language = "";
      }
      if (language === "") {
        try {
          language = String(navigator.language || "");
        } catch (error) {
          language = "";
        }
      }
      return language.toLowerCase().indexOf("zh") === 0 ? COPY.zh : COPY.en;
    }

    /** Interpolate `{{name}}` placeholders. */
    function fill(template, values) {
      return String(template).replace(/\{\{(\w+)\}\}/g, function (match, key) {
        return Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match;
      });
    }

    /** The locale service, or null. Never in `inject`: a missing one must not block the fiber. */
    function readLocaleService(ctx) {
      try {
        var service = typeof ctx.get === "function" ? ctx.get("locale") : null;
        if (service !== null && service !== undefined && typeof service.getLocale === "function") return service;
      } catch (error) {
        /* a composition without a locale service is normal */
      }
      return null;
    }

    var hostLocale = null;

    /** Resolve a route against the page's own base path. */
    function apiUrl(path) {
      try {
        return new URL(String(path).replace(/^\/+/, ""), document.baseURI).pathname;
      } catch (error) {
        return "/" + String(path).replace(/^\/+/, "");
      }
    }

    /** Throw away a cached `<style>` and install the current CSS. */
    function installStyles() {
      try {
        var element = document.getElementById(STYLE_ID);
        if (element === null) {
          element = document.createElement("style");
          element.id = STYLE_ID;
          document.head.appendChild(element);
        }
        if (element.textContent !== CSS) element.textContent = CSS;
      } catch (error) {
        /* a page without a head is not worth crashing over */
      }
    }

    /** Read the host state; a failure comes back as `{ error }` instead of throwing. */
    function fetchState(force) {
      var url = apiUrl(STATE_ROUTE) + (force === true ? "?force=1" : "");
      return fetch(url, { cache: "no-store", headers: { accept: "application/json" } })
        .then(function (response) {
          return response.json().then(function (body) {
            if (!response.ok) throw new Error((body && (body.error || body.hint)) || "HTTP " + response.status);
            return body;
          });
        })
        .catch(function (error) {
          return { error: String((error && error.message) || error) };
        });
    }

    /** Post one action; resolves to the parsed body (or `{ error }`). */
    function postAction(action, payload) {
      return fetch(apiUrl(ACTION_ROUTE), {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ action: action, payload: payload === undefined ? {} : payload }),
      })
        .then(function (response) {
          return response.json().then(function (body) {
            if (!response.ok && !(body && body.error)) throw new Error("HTTP " + response.status);
            return body;
          });
        })
        .catch(function (error) {
          return { ok: false, error: String((error && error.message) || error) };
        });
    }

    /**
     * Poll the host state while the component is mounted.
     *
     * `busy` suppresses a poll that would overwrite a just-applied local change,
     * the same way the reference plugin keeps its optimistic writes from being
     * clobbered by an in-flight read.
     */
    function useHostState(intervalMs) {
      var pair = React.useState({ phase: "loading", state: null, error: null });
      var view = pair[0];
      var setView = pair[1];
      var busy = React.useRef(false);
      var alive = React.useRef(true);

      var load = React.useCallback(function (force) {
        if (busy.current) return;
        return fetchState(force).then(function (body) {
          if (!alive.current) return;
          if (body && body.error) setView({ phase: "error", state: null, error: body.error });
          else setView({ phase: "ready", state: body, error: null });
        });
      }, []);

      React.useEffect(function () {
        alive.current = true;
        load(false);
        var timer = setInterval(function () {
          load(false);
        }, Math.max(2000, intervalMs || 8000));
        var onFocus = function () {
          load(false);
        };
        window.addEventListener("focus", onFocus);
        return function () {
          alive.current = false;
          clearInterval(timer);
          window.removeEventListener("focus", onFocus);
        };
      }, [intervalMs, load]);

      return {
        view: view,
        reload: load,
        begin: function () {
          busy.current = true;
        },
        end: function () {
          busy.current = false;
        },
      };
    }

    /* ---------------------------------------------------------------- *
     * icons
     * ---------------------------------------------------------------- */

    /** The bird mark, shared by the settings nav icon and the composer pill. */
    function BirdMark(props) {
      var size = typeof props.size === "number" ? props.size : 16;
      return h(
        "svg",
        { width: size, height: size, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" },
        h("path", {
          d: "M3.5 15.2c3.1 0 5.4-1.3 6.7-3.2 1.2-1.7 3.1-3.1 5.6-3.6l3.7-.8-1.5 3.1c-.4 3.6-3.2 6.3-7 6.3H8.1l-1.4 2.2-1.1-2.9-2.1-1.1Z",
          fill: "currentColor",
          opacity: "0.92",
        }),
        h("circle", { cx: "15.4", cy: "10.4", r: "0.95", fill: "var(--dsw-alias-bg-base, #fff)" }),
      );
    }

    /** A one-line dot that encodes the current health. */
    function StatusDot(props) {
      var tone = props.tone === "ok" ? "ok" : props.tone === "warn" ? "warn" : "idle";
      return h("span", { class: "xyq-dot xyq-dot--" + tone, "aria-hidden": "true" });
    }

    /* ---------------------------------------------------------------- *
     * the page, shared by the settings seat and the sidebar panel
     * ---------------------------------------------------------------- */

    /** One labelled row; `wide` lets the value wrap under its label. */
    function Row(props) {
      return h(
        "div",
        { class: "xyq-row" + (props.wide ? " xyq-row--wide" : "") },
        h("span", { class: "xyq-row__label" }, props.label),
        h("span", { class: "xyq-row__value" }, props.children),
      );
    }

    /** A small quiet button. */
    function Button(props) {
      return h(
        "button",
        {
          type: "button",
          class: "xyq-btn" + (props.quiet ? " xyq-btn--quiet" : ""),
          disabled: props.disabled === true,
          onClick: props.onClick,
          title: props.title,
        },
        props.children,
      );
    }

    /** The Settings page. */
    function SettingsSection(props) {
      var text = copy();
      var host = useHostState(8000);
      var view = host.view;
      var modelPair = React.useState({ phase: "idle", type: "image", models: [], error: null, cached: false });
      var models = modelPair[0];
      var setModels = modelPair[1];
      var busyPair = React.useState("");
      var busy = busyPair[0];
      var setBusy = busyPair[1];
      var notePair = React.useState(null);
      var note = notePair[0];
      var setNote = notePair[1];
      var resultPair = React.useState(null);
      var result = resultPair[0];
      var setResult = resultPair[1];

      var state = view.state;
      var loggedIn = state !== null && state.auth && state.auth.loggedIn === true;

      var loadModels = React.useCallback(
        function (type, refresh) {
          setModels(function (previous) {
            return { phase: "loading", type: type, models: previous.models, error: null, cached: previous.cached };
          });
          return postAction("models", { type: type, refresh: refresh === true }).then(function (body) {
            setModels({
              phase: "ready",
              type: type,
              models: Array.isArray(body.models) ? body.models : [],
              error: body.ok === false ? String(body.error || text.failed) : null,
              cached: body.cached === true,
            });
          });
        },
        [text.failed],
      );

      /*
       * Load the catalog once the account is known, and retry on its own after an
       * empty or failed read: a reload can outlive a short-lived auth hiccup, and
       * an empty card that never retries looks like a broken plugin.
       */
      React.useEffect(
        function () {
          if (!loggedIn) return undefined;
          var empty = models.phase !== "idle" && models.phase !== "loading" && (models.error !== null || models.models.length === 0);
          if (models.phase !== "idle" && !empty) return undefined;
          var timer = setTimeout(function () {
            loadModels(models.type, false);
          }, empty ? 15000 : 0);
          return function () {
            clearTimeout(timer);
          };
        },
        [loggedIn, models.phase, models.error, models.models.length, models.type, loadModels],
      );

      /*
       * A retry after a failed sign-in asks the CLI to force a fresh credential:
       * the usual failure is a stale local token, and a plain `login` would offer
       * to keep it. The first sign-in stays non-forcing.
       */
      var signIn = function (force) {
        setBusy("login");
        setNote(null);
        host.begin();
        postAction("login", { force: force === true }).then(function (body) {
          host.end();
          setBusy("");
          if (body && body.ok === false) setNote(String(body.error || text.loginFailed));
          else if (body && body.error) setNote(String(body.error));
          else setNote(text.loginRunning);
          host.reload(true);
        });
      };

      var signOut = function () {
        setBusy("logout");
        host.begin();
        postAction("logout").then(function (body) {
          host.end();
          setBusy("");
          if (body && body.ok === false) setNote(String(body.error || text.failed));
          host.reload(true);
        });
      };

      /*
       * A sign-in finishes in the browser, minutes later, so the panel cannot report
       * it from the request that started it: it watches the host's login record flip
       * from running to finished and then reads the outcome — success, a CLI error,
       * or a browser the user simply closed.
       */
      var lastLogin = React.useRef(null);
      React.useEffect(
        function () {
          var record = state && state.login ? state.login : null;
          var running = record !== null && record.running === true;
          var error = record !== null && typeof record.error === "string" ? record.error.trim() : "";
          var previous = lastLogin.current;
          lastLogin.current = { running: running };
          if (previous === null || previous.running !== true || running) return;
          if (error !== "") setNote(error);
          else if (loggedIn) setNote(null);
          else setNote(text.loginFailed);
        },
        [state, loggedIn, text.loginFailed],
      );

      /** Files a query handed back, as the page lists them. */
      var resultFiles = function (query) {
        var files = [];
        if (query === null) return files;
        var images = Array.isArray(query.images) ? query.images : [];
        var videos = Array.isArray(query.videos) ? query.videos : [];
        for (var index = 0; index < images.length; index += 1) {
          if (images[index] && images[index].path) files.push({ kind: "image", path: String(images[index].path), draft: false });
        }
        for (var other = 0; other < videos.length; other += 1) {
          if (videos[other] && videos[other].path) {
            files.push({ kind: "video", path: String(videos[other].path), draft: videos[other].draft === true });
          }
        }
        return files;
      };

      var checkRun = function (run) {
        var key = (run.runId || "") + "|" + (run.threadId || "");
        setBusy("query:" + key);
        setResult(null);
        setNote(text.checking);
        host.begin();
        postAction("query", { runId: run.runId, threadId: run.threadId }).then(function (body) {
          host.end();
          setBusy("");
          var answer = body && body.result ? body.result : null;
          if (!body || body.ok === false) {
            setNote(String((body && body.error) || text.failed));
          } else if (answer !== null && answer.errorMessage) {
            setNote(answer.errorMessage);
          } else {
            setNote(null);
            setResult({
              key: key,
              status: answer !== null && answer.status ? String(answer.status) : "",
              completed: answer !== null && answer.completed === true,
              files: resultFiles(answer),
              /* Where this run's media actually landed: the Host decides, so the
                 page reports it rather than guessing from the config card. */
              dir: body && body.downloadDir ? String(body.downloadDir) : "",
            });
          }
          host.reload(true);
        });
      };

      var forgetRun = function (run) {
        var key = (run.runId || "") + "|" + (run.threadId || "");
        var confirm = typeof window !== "undefined" && typeof window.confirm === "function" ? window.confirm : null;
        if (confirm !== null && confirm(text.confirmForget) !== true) return;
        setBusy("forget:" + key);
        host.begin();
        postAction("forget", { runId: run.runId, threadId: run.threadId }).then(function (body) {
          host.end();
          setBusy("");
          if (body && body.ok === false) {
            setNote(String(body.error || text.failed));
            return;
          }
          setNote(null);
          if (result !== null && result.key === key) setResult(null);
          host.reload(true);
        });
      };

      var openFolder = function (dir) {
        setBusy("open");
        postAction("open-download-dir", dir ? { dir: dir } : {}).then(function (body) {
          setBusy("");
          if (body && body.ok === false) setNote(String(body.error || text.failed));
          else setNote(text.opened + (body && body.path ? " · " + String(body.path) : ""));
        });
      };

      var openFile = function (path) {
        postAction("open-file", { path: path }).then(function (body) {
          if (body && body.ok === false) setNote(String(body.error || text.failed));
        });
      };

      var loading = view.phase === "loading";
      var failed = view.phase === "error";
      var cli = state && state.cli ? state.cli : null;
      var cliFound = cli !== null && cli.found === true;
      var auth = state && state.auth ? state.auth : null;
      var credit = state && state.credit ? state.credit : null;
      var runs = state && Array.isArray(state.runs) ? state.runs : [];
      var config = state && state.config ? state.config : null;
      var loginRunning = state && state.login && state.login.running === true;
      /* A finished login that ended badly: the button becomes "sign in again". */
      var loginEndedBadly =
        state && state.login && state.login.running === false && typeof state.login.error === "string" && state.login.error.trim() !== "";

      var header = h(
        "div",
        { class: "xyq-head" },
        h("div", { class: "xyq-head__mark" }, h(BirdMark, { size: 28 })),
        h(
          "div",
          { class: "xyq-head__text" },
          h("div", { class: "xyq-head__title" }, text.title),
          h("div", { class: "xyq-head__sub" }, text.subtitle),
        ),
        h(
          "div",
          { class: "xyq-head__actions" },
          h(Button, {
            quiet: true,
            disabled: busy !== "",
            onClick: function () {
              host.reload(true);
              if (loggedIn) loadModels(models.type, true);
            },
          }, text.refresh),
        ),
      );

      var body;
      if (failed) {
        body = h("div", { class: "xyq-error" }, text.failed + ": " + String(view.error || ""));
      } else if (loading || state === null) {
        body = h("div", { class: "xyq-note" }, text.loading);
      } else {
        body = h(
          "div",
          { class: "xyq-body" },
          h(
            "section",
            { class: "xyq-card" },
            h(
              "div",
              { class: "xyq-card__head" },
              h(StatusDot, { tone: !cliFound ? "idle" : loggedIn ? "ok" : "warn" }),
              h("span", { class: "xyq-card__title" }, text.cli + " / " + text.login),
            ),
            h(Row, { label: text.cli }, cliFound ? text.cliFound : text.cliMissing),
            cliFound && cli.command ? h(Row, { label: "", wide: true }, h("code", { class: "xyq-code" }, cli.command)) : null,
            cliFound && cli.version ? h(Row, { label: text.version }, cli.version) : null,
            !cliFound ? h("div", { class: "xyq-hint" }, text.hintInstall) : null,
            h(
              Row,
              { label: text.login },
              h(
                "span",
                { class: "xyq-inline" },
                h(StatusDot, { tone: loggedIn ? "ok" : "warn" }),
                h("span", null, loggedIn ? text.loggedIn + (auth && auth.uid ? " · " + auth.uid : "") : text.loggedOut),
              ),
            ),
            loggedIn && auth && auth.expiresAt ? h(Row, { label: "", wide: true }, "expires_at: " + auth.expiresAt) : null,
            credit !== null
              ? h(
                  Row,
                  { label: text.credit },
                  typeof credit.error === "string" && credit.error !== ""
                    ? credit.error
                    : (credit.totalRemain || "0") + " " + text.creditUnit,
                )
              : null,
            h(
              "div",
              { class: "xyq-actions" },
              !loggedIn
                ? h(
                    Button,
                    {
                      disabled: busy !== "" || loginRunning,
                      onClick: function () {
                        signIn(loginEndedBadly);
                      },
                    },
                    loginRunning ? text.signingIn : loginEndedBadly ? text.signInForce : text.signIn,
                  )
                : h(Button, { quiet: true, disabled: busy !== "" || loginRunning, onClick: signOut }, text.signOut),
            ),
            !loggedIn && cliFound ? h("div", { class: "xyq-hint" }, text.hintLogin) : null,
          ),
          h(
            "section",
            { class: "xyq-card" },
            h(
              "div",
              { class: "xyq-card__head" },
              h("span", { class: "xyq-card__title" }, text.models),
              h(
                "div",
                { class: "xyq-tabs" },
                h(
                  "button",
                  {
                    type: "button",
                    class: "xyq-tab" + (models.type === "image" ? " xyq-tab--on" : ""),
                    onClick: function () {
                      loadModels("image", false);
                    },
                  },
                  text.imageModels,
                ),
                h(
                  "button",
                  {
                    type: "button",
                    class: "xyq-tab" + (models.type === "video" ? " xyq-tab--on" : ""),
                    onClick: function () {
                      loadModels("video", false);
                    },
                  },
                  text.videoModels,
                ),
              ),
            ),
            !loggedIn
              ? h("div", { class: "xyq-note" }, text.modelsNeedLogin)
              : models.phase === "loading"
                ? h("div", { class: "xyq-note" }, text.loading)
                : models.error !== null
                  ? h("div", { class: "xyq-error" }, models.error)
                  : models.models.length === 0
                    ? h("div", { class: "xyq-note" }, text.noModels)
                    : h(
                        "ul",
                        { class: "xyq-models" },
                        models.models.slice(0, 40).map(function (model) {
                          return h(
                            "li",
                            { class: "xyq-model", key: model.key || model.name },
                            h("span", { class: "xyq-model__name" }, model.name || model.key),
                            model.description ? h("span", { class: "xyq-model__desc" }, model.description) : null,
                            model.key && model.key !== model.name ? h("code", { class: "xyq-model__key" }, model.key) : null,
                          );
                        }),
                      ),
          ),
          h(
            "section",
            { class: "xyq-card" },
            h(
              "div",
              { class: "xyq-card__head" },
              h("span", { class: "xyq-card__title" }, text.runs),
              runs.length > 0 ? h("span", { class: "xyq-count" }, String(runs.length)) : null,
            ),
            /* The page is a status view, and this is the one line that says so:
               without it an empty card looks like a submit button is missing. */
            h("div", { class: "xyq-hint" }, text.hintAsk),
            runs.length === 0
              ? h("div", { class: "xyq-note" }, text.noRuns)
              : h(
                  "ul",
                  { class: "xyq-runs" },
                  runs.map(function (run) {
                    var key = (run.runId || "") + "|" + (run.threadId || "");
                    return h(
                      "li",
                      { class: "xyq-run", key: key },
                      h(
                        "div",
                        { class: "xyq-run__main" },
                        h("span", { class: "xyq-chip" }, run.kind === "video" ? text.videoModels : text.imageModels),
                        h("span", { class: "xyq-run__prompt" }, run.prompt || "—"),
                      ),
                      h(
                        "div",
                        { class: "xyq-run__meta" },
                        h("span", { class: "xyq-run__status" }, run.status || text.statusSubmitted),
                        run.webThreadLink
                          ? h(
                              "a",
                              { class: "xyq-link", href: run.webThreadLink, target: "_blank", rel: "noreferrer noopener" },
                              "web",
                            )
                          : null,
                        h(
                          Button,
                          {
                            quiet: true,
                            disabled: busy !== "",
                            onClick: function () {
                              checkRun(run);
                            },
                          },
                          text.query,
                        ),
                        run.dir
                          ? h(
                              Button,
                              {
                                quiet: true,
                                title: String(run.dir),
                                onClick: function () {
                                  openFolder(String(run.dir));
                                },
                              },
                              text.openFolder,
                            )
                          : null,
                        h(
                          Button,
                          {
                            quiet: true,
                            disabled: busy !== "",
                            onClick: function () {
                              forgetRun(run);
                            },
                          },
                          text.forget,
                        ),
                      ),
                    );
                  }),
                ),
          ),
          result !== null
            ? h(
                "section",
                { class: "xyq-card" },
                h(
                  "div",
                  { class: "xyq-card__head" },
                  h(StatusDot, { tone: result.completed ? "ok" : "warn" }),
                  h("span", { class: "xyq-card__title" }, text.result),
                  result.status !== "" ? h("span", { class: "xyq-count" }, result.status) : null,
                ),
                result.files.length === 0
                  ? h("div", { class: "xyq-note" }, text.noFiles)
                  : h(
                      "div",
                      null,
                      h("div", { class: "xyq-note" }, fill(text.filesReady, { n: result.files.length })),
                      h(
                        "ul",
                        { class: "xyq-files" },
                        result.files.map(function (file, index) {
                          return h(
                            "li",
                            { class: "xyq-file", key: file.path + "|" + index },
                            h("span", { class: "xyq-chip" }, file.kind === "video" ? text.videoResult : text.imageResult),
                            h("code", { class: "xyq-code xyq-file__path" }, file.path),
                            file.draft ? h("span", { class: "xyq-badge" }, text.draftBadge) : null,
                            h(
                              Button,
                              {
                                quiet: true,
                                title: file.path,
                                onClick: function () {
                                  openFile(file.path);
                                },
                              },
                              text.openFile,
                            ),
                          );
                        }),
                      ),
                    ),
                result.dir !== ""
                  ? h(
                      Row,
                      { label: text.taskDir, wide: true },
                      h("code", { class: "xyq-code" }, result.dir),
                      h(
                        Button,
                        {
                          quiet: true,
                          disabled: busy !== "",
                          title: result.dir,
                          onClick: function () {
                            openFolder(result.dir);
                          },
                        },
                        text.openFolder,
                      ),
                    )
                  : null,
              )
            : null,
          config !== null
            ? h(
                "section",
                { class: "xyq-card xyq-card--quiet" },
                h(Row, { label: text.downloadDir, wide: true }, h("code", { class: "xyq-code" }, config.downloadDir || "—")),
                config.taskDirRule ? h("div", { class: "xyq-hint" }, text.taskDirRule) : null,
                h(Row, { label: text.stateDir, wide: true }, h("code", { class: "xyq-code" }, config.stateDir || "—")),
                h(Row, { label: text.team }, config.teamId === "" ? text.personalSpace : config.teamId),
                h(
                  "div",
                  { class: "xyq-actions" },
                  h(
                    Button,
                    {
                      quiet: true,
                      disabled: busy !== "",
                      onClick: function () {
                        openFolder("");
                      },
                      title: config.downloadDir || "",
                    },
                    text.openFolder,
                  ),
                ),
              )
            : null,
          note !== null ? h("div", { class: "xyq-note xyq-note--result", role: "status", "aria-live": "polite" }, String(note)) : null,
        );
      }

      return h("div", { class: "xyq-page" }, header, body);
    }

    /** The settings nav icon; `size` comes from the slot owner. */
    function SettingsIcon(props) {
      return h(BirdMark, { size: typeof props.size === "number" ? props.size : 16 });
    }

    /* ---------------------------------------------------------------- *
     * composer pill
     * ---------------------------------------------------------------- */

    /** The one-line status chip under the composer. */
    function ComposerPill() {
      var text = copy();
      var host = useHostState(15000);
      var state = host.view.state;
      var tone = "idle";
      var label = text.pillMissing;
      if (state !== null) {
        var cliFound = state.cli && state.cli.found === true;
        var loggedIn = state.auth && state.auth.loggedIn === true;
        if (!cliFound) {
          tone = "idle";
          label = text.pillMissing;
        } else if (!loggedIn) {
          tone = "warn";
          label = text.pillLoggedOut;
        } else {
          tone = "ok";
          var credit = state.credit;
          var total = credit && typeof credit.totalRemain === "string" ? credit.totalRemain : "";
          label = total === "" ? text.pillReady : text.pillReady + " · " + fill(text.pillCredit, { n: total });
        }
      }
      return h(
        "div",
        { class: "xyq-pill", title: label },
        h(StatusDot, { tone: tone }),
        h("span", { class: "xyq-pill__label" }, label),
      );
    }

    /* ---------------------------------------------------------------- *
     * sidebar panel
     * ---------------------------------------------------------------- */

    /**
     * The sidebar row glyph. The shell owns the button, the label, the tooltip
     * and the rail geometry; this draws only the mark, at the size it hands in.
     * `data-dsh-panel-entry` is the only hook this plugin owns inside that
     * shell-drawn row, so skins can resolve which row belongs to it.
     */
    function PanelIcon(props) {
      var size = typeof props.size === "number" ? props.size : 16;
      return h(
        "svg",
        {
          "data-dsh-panel-entry": SETTINGS_ID,
          viewBox: "0 0 16 16",
          width: size,
          height: size,
          fill: "none",
          stroke: "currentColor",
          strokeWidth: "1.3",
          strokeLinecap: "round",
          strokeLinejoin: "round",
          "aria-hidden": "true",
        },
        h("path", { d: "M2.4 11.4c1.6-2.6 3.4-3.9 5.6-3.9s3.9 1.3 5.6 3.9" }),
        h("path", { d: "M8 7.6V3.1" }),
        h("path", { d: "M5.9 5 8 2.9 10.1 5" }),
      );
    }

    /**
     * The main-column page. The layout mounts it only while this panel is the
     * selected one, so the conversation keeps the centre column otherwise.
     */
    function PanelPage() {
      return h("div", { class: "xyq-panel" }, h(SettingsSection, null));
    }

    /* ---------------------------------------------------------------- *
     * registration
     * ---------------------------------------------------------------- */

    /** Register the Settings page and its nav icon; each failure is local. */
    function registerSettings(ctx) {
      try {
        ctx.slots.inject(SETTINGS_SLOT, function () {
          return ctx.slots.register(
            {
              name: SETTINGS_SLOT,
              id: SETTINGS_ID,
              order: SETTINGS_ORDER,
              label: function () {
                return copy().title;
              },
            },
            SettingsSection,
          );
        });
      } catch (error) {
        console.error("[dsh-xyq] could not register the settings section", error);
      }
      try {
        ctx.slots.inject(SETTINGS_ICON_SLOT, function () {
          return ctx.slots.register(
            {
              name: SETTINGS_ICON_SLOT,
              id: SETTINGS_ID,
              order: SETTINGS_ORDER,
              label: function () {
                return copy().title;
              },
            },
            SettingsIcon,
          );
        });
      } catch (error) {
        console.error("[dsh-xyq] could not register the settings icon", error);
      }
    }

    /**
     * Register the sidebar row and the main-column page behind it.
     *
     * Both seats are declared by shell plugins this package does not depend on
     * at runtime, so each registration goes through `slots.inject`: the callback
     * runs only once the owner declares the seat, and a shell that never
     * declares it leaves the row simply absent instead of failing the boot.
     */
    function registerSidebarPanel(ctx) {
      try {
        ctx.slots.inject(PANELLIST_SLOT, function () {
          return ctx.slots.register(
            {
              name: PANELLIST_SLOT,
              id: SETTINGS_ID,
              order: PANEL_ORDER,
              label: function () {
                return copy().title;
              },
            },
            PanelIcon,
          );
        });
      } catch (error) {
        console.error("[dsh-xyq] could not register the sidebar row", error);
      }
      try {
        ctx.slots.inject(MAIN_SLOT, function () {
          return ctx.slots.register({ name: MAIN_SLOT, key: SETTINGS_ID }, PanelPage);
        });
      } catch (error) {
        console.error("[dsh-xyq] could not register the panel page", error);
      }
    }

    /** Register the composer pill; a failure only costs the pill. */
    function registerComposerPill(ctx) {
      try {
        ctx.slots.inject(DOCK_SLOT, function () {
          return ctx.slots.register(
            { name: DOCK_SLOT, id: SETTINGS_ID, order: DOCK_ORDER },
            ComposerPill,
          );
        });
      } catch (error) {
        console.error("[dsh-xyq] could not register the composer pill", error);
      }
    }

    /** Mount the client half. Never throws: a missing pill is better than a blank page. */
    function apply(ctx) {
      try {
        hostLocale = readLocaleService(ctx);
        installStyles();
        registerSettings(ctx);
        registerSidebarPanel(ctx);
        registerComposerPill(ctx);
      } catch (error) {
        console.error("[dsh-xyq] client apply failed", error);
      }
    }

    var CSS = [
      ".xyq-panel{height:100%;overflow:auto;padding:28px 32px}",
      /* The panel column is much wider than the settings column, so the page
         keeps its own measure instead of stretching cards across the screen. */
      ".xyq-panel .xyq-page{max-width:820px;margin-left:auto;margin-right:auto}",
      ".xyq-page{display:flex;flex-direction:column;gap:16px;padding:4px 2px 24px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.55}",
      ".xyq-head{display:flex;align-items:flex-start;gap:12px}",
      ".xyq-head__mark{display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:10px;color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent);flex:none}",
      ".xyq-head__text{min-width:0;flex:1}",
      ".xyq-head__title{font-size:15px;font-weight:600}",
      ".xyq-head__sub{color:var(--dsw-alias-label-secondary);font-size:12px}",
      ".xyq-head__actions{display:flex;gap:8px;flex:none}",
      ".xyq-body{display:flex;flex-direction:column;gap:12px}",
      ".xyq-card{display:flex;flex-direction:column;gap:8px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm,10px);background:var(--dsw-alias-bg-layer-1)}",
      ".xyq-card--quiet{background:transparent}",
      ".xyq-card__head{display:flex;align-items:center;gap:8px}",
      ".xyq-card__title{font-weight:600;font-size:12px;letter-spacing:.02em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}",
      ".xyq-tabs{margin-left:auto;display:flex;gap:4px}",
      ".xyq-tab{appearance:none;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;padding:2px 8px;border-radius:6px;cursor:pointer}",
      ".xyq-tab:hover{background:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent))}",
      ".xyq-tab--on{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}",
      ".xyq-row{display:grid;grid-template-columns:auto minmax(0,1fr);gap:2px 12px;align-items:baseline}",
      ".xyq-row--wide{grid-template-columns:minmax(0,1fr)}",
      ".xyq-row__label{color:var(--dsw-alias-label-secondary);font-size:12px;white-space:nowrap}",
      ".xyq-row__value{min-width:0;overflow-wrap:anywhere}",
      ".xyq-inline{display:inline-flex;align-items:center;gap:6px;min-width:0}",
      ".xyq-code{font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11.5px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}",
      ".xyq-hint{color:var(--dsw-alias-label-secondary);font-size:12px}",
      ".xyq-note{color:var(--dsw-alias-label-secondary);font-size:12px}",
      ".xyq-note--result{color:var(--dsw-alias-label-primary)}",
      ".xyq-error{color:var(--dsw-alias-state-error-primary);font-size:12px;overflow-wrap:anywhere}",
      ".xyq-actions{display:flex;gap:8px;flex-wrap:wrap}",
      ".xyq-btn{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:4px 12px;border-radius:7px;cursor:pointer;transition:background .12s ease}",
      ".xyq-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent))}",
      ".xyq-btn:disabled{opacity:.5;cursor:default}",
      ".xyq-btn--quiet{border-color:transparent;background:transparent;color:var(--dsw-alias-label-secondary);padding:3px 8px}",
      ".xyq-dot{display:inline-block;width:6px;height:6px;border-radius:50%;flex:none;background:var(--dsw-alias-state-idle-primary)}",
      ".xyq-dot--ok{background:var(--dsw-alias-state-success-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-success-primary) 22%,transparent)}",
      ".xyq-dot--warn{background:var(--dsw-alias-state-warn-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-warn-primary) 22%,transparent)}",
      ".xyq-dot--idle{background:var(--dsw-alias-state-idle-primary)}",
      ".xyq-models{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none;max-height:260px;overflow:auto}",
      ".xyq-model{display:flex;flex-wrap:wrap;gap:2px 8px;align-items:baseline}",
      ".xyq-model__name{font-weight:500}",
      ".xyq-model__desc{color:var(--dsw-alias-label-secondary);font-size:12px}",
      ".xyq-model__key{font-size:11px;color:var(--dsw-alias-label-secondary)}",
      ".xyq-count{color:var(--dsw-alias-label-secondary);font-size:11px}",
      ".xyq-runs{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}",
      ".xyq-run{display:flex;flex-direction:column;gap:4px;padding:8px 0;border-top:1px solid var(--dsw-alias-border-l1)}",
      ".xyq-run:first-child{border-top:none;padding-top:0}",
      ".xyq-run__main{display:flex;gap:8px;align-items:baseline;min-width:0}",
      ".xyq-run__prompt{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".xyq-run__meta{display:flex;gap:8px;align-items:center;flex-wrap:wrap;color:var(--dsw-alias-label-secondary);font-size:11.5px}",
      ".xyq-run__status{font-size:11.5px}",
      ".xyq-chip{flex:none;font-size:11px;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);border-radius:5px;padding:0 6px}",
      ".xyq-link{color:var(--dsw-alias-brand-primary);text-decoration:none}",
      ".xyq-link:hover{text-decoration:underline}",
      ".xyq-badge{flex:none;font-size:11px;color:var(--dsw-alias-state-warn-primary);border:1px solid var(--dsw-alias-state-warn-primary);border-radius:5px;padding:0 6px}",
      ".xyq-files{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}",
      ".xyq-file{display:flex;gap:8px;align-items:center;min-width:0;flex-wrap:wrap}",
      ".xyq-file__path{flex:1;min-width:120px}",
      ".xyq-pill{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:var(--dsw-radius-sm,8px);border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:500;cursor:default}",
      ".xyq-pill:hover{background:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent))}",
      ".xyq-pill__label{white-space:nowrap}",
      "@media (prefers-reduced-motion:reduce){.xyq-btn{transition:none}}",
    ].join("");

    var inject = ["slots"];
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});

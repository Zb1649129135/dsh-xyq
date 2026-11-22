/**
 * Host smoke test: mount the plugin the way the loader does and drive its
 * routes and tools in-process.
 *
 * The live GUI needs a signed cookie and a real HTTP round trip; this harness
 * needs neither, so a broken handler surfaces here. It fakes only what `apply`
 * actually touches: `inject`, `effect`, `get`, `logger`, and a bare
 * request/response pair.
 *
 * Run with `node scripts/host-smoke.mjs`.
 */

import { ACTION_ROUTE, STATE_ROUTE, apply } from "../lib/index.js";

let failures = 0;
function check(label, ok, detail) {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok" : "!!"} ${label}${detail === undefined ? "" : ` — ${detail}`}`);
}

/* ---------------------------------------------------------------- *
 * a context just real enough
 * ---------------------------------------------------------------- */

const disposers = [];
const tools = new Map();
const routes = new Map();

const fakeTools = {
  register(definition) {
    tools.set(definition.name, definition);
    return () => tools.delete(definition.name);
  },
};

const fakeWebServer = {
  protocol: "http:",
  register(route) {
    routes.set(route.path, route);
    return () => routes.delete(route.path);
  },
};

const ctx = {
  logger() {
    return { warn() {}, info() {}, debug() {} };
  },
  inject(names, callback) {
    // A Cordis proxy exposes injected services as properties of the scoped
    // context, so the fake has to do the same.
    const scope = {
      tools: names.includes("tools") ? fakeTools : undefined,
      webServer: names.includes("webServer") ? fakeWebServer : undefined,
      get(key) {
        if (key === "tools") return fakeTools;
        if (key === "webServer") return fakeWebServer;
        return undefined;
      },
      on() {},
      effect(fn) {
        const dispose = fn();
        disposers.push(dispose);
      },
      logger: this.logger,
    };
    callback(scope);
    return () => {};
  },
  on() {},
  effect(fn) {
    const dispose = fn();
    if (typeof dispose === "function") disposers.push(dispose);
  },
  get() {
    return undefined;
  },
};

apply(ctx, { stateTtlMs: 1000 });

console.log("mount");
check("tools registered", tools.size >= 6, [...tools.keys()].join(", "));
check("state route", routes.has(STATE_ROUTE));
check("action route", routes.has(ACTION_ROUTE));

/* ---------------------------------------------------------------- *
 * request / response
 * ---------------------------------------------------------------- */

function request(method, url, body) {
  return { method, url, body, headers: {} };
}

function response() {
  const captured = { status: 0, headers: {}, body: "" };
  captured.writeHead = (status, headers) => {
    captured.status = status;
    Object.assign(captured.headers, headers ?? {});
  };
  captured.end = (payload) => {
    captured.body = String(payload ?? "");
  };
  captured.json = () => JSON.parse(captured.body);
  return captured;
}

async function call(route, req) {
  const out = response();
  await routes.get(route).handler(req, out);
  return out;
}

/**
 * The route reads its body from the request stream, which a test cannot pipe
 * politely, so hand it a minimal readable instead.
 */
function withBody(req, payload) {
  let delivered = false;
  req.on = (event, handler) => {
    if (event === "data" && !delivered) {
      delivered = true;
      handler(Buffer.from(JSON.stringify(payload)));
    }
    if (event === "end") handler();
    return req;
  };
  return req;
}

console.log("routes");
const state = await call(STATE_ROUTE, request("GET", STATE_ROUTE));
check("GET /state answers 200", state.status === 200, `status ${state.status}`);
const snapshot = state.json();
check("snapshot names the CLI", typeof snapshot?.cli === "object", snapshot?.cli?.command ?? "(none)");
check("snapshot reports auth", typeof snapshot?.auth?.loggedIn === "boolean", `loggedIn=${snapshot?.auth?.loggedIn}`);
check("snapshot carries config", typeof snapshot?.config?.stateDir === "string", snapshot?.config?.stateDir);
check("tools report the same CLI", typeof tools.get("xyq_status") === "object");

const bad = await call(ACTION_ROUTE, withBody(request("POST", ACTION_ROUTE), { action: "no-such-action" }));
check("unknown action answers 400", bad.status === 400, `status ${bad.status}`);

const refresh = await call(ACTION_ROUTE, withBody(request("POST", ACTION_ROUTE), { action: "refresh" }));
check("refresh answers 200", refresh.status === 200, `status ${refresh.status}`);
check("refresh returns a snapshot", typeof refresh.json()?.state?.cli === "object");

const wrongMethod = await call(STATE_ROUTE, request("POST", STATE_ROUTE));
check("POST /state answers 405", wrongMethod.status === 405, `status ${wrongMethod.status}`);

/* The Downloads button and the per-file links both end up here: a path guard that
   accepts a stray absolute path would make the action route a file opener. */
const outside = await call(ACTION_ROUTE, withBody(request("POST", ACTION_ROUTE), { action: "open-file", payload: { path: "/etc/passwd" } }));
check(
  "open-file refuses a path outside the download folder",
  outside.status === 200 && outside.json()?.ok === false && outside.json()?.opened === false,
  `${outside.status} ${outside.json()?.error ?? ""}`,
);
const blankFile = await call(ACTION_ROUTE, withBody(request("POST", ACTION_ROUTE), { action: "open-file", payload: {} }));
check("open-file refuses a missing path", blankFile.json()?.ok === false, blankFile.json()?.error ?? "");

/* The folder button takes a folder from the page, so it is a whitelist too. */
const strayFolder = await call(
  ACTION_ROUTE,
  withBody(request("POST", ACTION_ROUTE), { action: "open-download-dir", payload: { dir: "/etc" } }),
);
check(
  "open-download-dir refuses a folder this plugin never writes to",
  strayFolder.json()?.ok === false && strayFolder.json()?.opened === false,
  strayFolder.json()?.error ?? "",
);

/* ---------------------------------------------------------------- *
 * where a run's media lands
 * ---------------------------------------------------------------- */

console.log("landing folders");
const store = await import("../lib/store.js");
const id = store.shortRunId("skill_1a2b3c4d-5e6f-7890-abcd-ef0123456789", "");
check("a run id becomes a folder name", id === "1a2b3c4d", id);
check(
  "the task folder sits under the workspace",
  store.taskDirectory("D:/work", "abc").replace(/\\/g, "/").endsWith("/work/.xyq/abc"),
  store.taskDirectory("D:/work", "abc"),
);
const fallback = store.resolveDownloadDir("");
check(
  "an explicit dir wins",
  store.resolveRunDir({ dir: "D:/picked", recorded: "D:/recorded", workspace: "D:/ws", runId: "abc", fallback }) === store.resolveRunDir({ dir: "D:/picked", fallback }),
  store.resolveRunDir({ dir: "D:/picked", recorded: "D:/recorded", workspace: "D:/ws", runId: "abc", fallback }),
);
check(
  "a recorded dir survives a later call from another session",
  store.resolveRunDir({ recorded: "D:/recorded", workspace: "D:/other", runId: "abc", fallback }) === store.resolveRunDir({ recorded: "D:/recorded", fallback }),
  store.resolveRunDir({ recorded: "D:/recorded", workspace: "D:/other", runId: "abc", fallback }),
);
check(
  "a fresh run lands in its workspace",
  store.resolveRunDir({ workspace: "D:/ws", runId: "abcdef", fallback }) === store.taskDirectory("D:/ws", "abcdef"),
  store.resolveRunDir({ workspace: "D:/ws", runId: "abcdef", fallback }),
);
check("without a workspace the shared folder is the fallback", store.resolveRunDir({ runId: "abcdef", fallback }) === fallback);

/* ---------------------------------------------------------------- *
 * a tool call end to end
 * ---------------------------------------------------------------- */

console.log("tools");
const status = tools.get("xyq_status");
const rendered = await status.execute({}, {});
check("xyq_status returns a report", typeof rendered?.report === "string", `${String(rendered?.report ?? "").split("\n")[0]}`);
const content = status.output.render({}, rendered);
check("xyq_status renders", Array.isArray(content) && content[0]?.type === "text", `${content?.[0]?.text?.length ?? 0} chars`);

const image = tools.get("xyq_generate_image");
const refused = await image.execute({ prompt: "test" }, {});
check(
  "generate_image refuses a missing model without a CLI call",
  typeof refused?.report === "string" && refused.report.includes("model"),
  refused?.report,
);

/*
 * `query-result` needs both ids together and exits non-zero while a task is still
 * running. A one-id retry used to produce "状态: unknown" for a job that was fine.
 */
const resultTool = tools.get("xyq_result");
const noIds = await resultTool.execute({}, {});
check("xyq_result asks for an id", typeof noIds?.report === "string" && noIds.report.includes("runId"), noIds?.report);

const runs = await (async () => {
  try {
    const { readJsonFile, stateDirectory } = await import("../lib/store.js");
    const journal = await readJsonFile(`${stateDirectory()}/runs.json`);
    return Array.isArray(journal?.runs) ? journal.runs : [];
  } catch {
    return [];
  }
})();

if (runs.length > 0) {
  const known = runs[0];
  const oneId = await resultTool.execute({ runId: known.runId }, {});
  const text = String(oneId?.report ?? "");
  check("a run-id-only query resolves its thread", !text.includes("缺少") && !text.includes("只找到"), text.split("\n").slice(0, 3).join(" / "));
} else {
  console.log("  ok  journal is empty, skipped the one-id query");
}

for (const dispose of disposers.splice(0)) {
  try {
    if (typeof dispose === "function") dispose();
  } catch {
    /* unwinding on purpose */
  }
}

/* ---------------------------------------------------------------- *
 * a reload, the way the loader does one
 * ---------------------------------------------------------------- */

/*
 * A disable/enable reload mounts a second fiber while the Web server keeps the
 * route object it already accepted — and the real `register` throws on a
 * duplicate path, so that second registration is the one that fails. The route
 * object left behind closes over the older module copy, which is how a page came
 * to show the previous journal and an empty model list while the tools were
 * correct. These checks pin the fix: after the second mount, the surviving route
 * objects must serve the newest handler and the newest config.
 */
console.log("reload");

const reloadRoutes = new Map();
const reloadTools = new Map();
const reloadWebServer = {
  protocol: "http:",
  register(route) {
    if (reloadRoutes.has(route.path)) throw new Error(`webserver: duplicate exact route "${route.path}"`);
    reloadRoutes.set(route.path, route);
    return () => reloadRoutes.delete(route.path);
  },
};

function reloadContext() {
  return {
    logger() {
      return { warn() {}, info() {}, debug() {} };
    },
    inject(names, callback) {
      const scope = {
        tools: names.includes("tools") ? { register: (definition) => (reloadTools.set(definition.name, definition), () => {}) } : undefined,
        webServer: names.includes("webServer") ? reloadWebServer : undefined,
        get(key) {
          if (key === "tools" && names.includes("tools")) return scope.tools;
          if (key === "webServer" && names.includes("webServer")) return reloadWebServer;
          return undefined;
        },
        on() {},
        effect(fn) {
          fn();
        },
        logger: this.logger,
      };
      callback(scope);
      return () => {};
    },
    on() {},
    effect(fn) {
      fn();
    },
    get() {
      return undefined;
    },
  };
}

// The first mount stands in for the session that is already running.
apply(reloadContext(), { stateTtlMs: 1000, teamId: "0" });
const firstHandlers = new Map([...reloadRoutes].map(([path, route]) => [path, route.handler]));

// The second mount is the reload: same paths, a new team id, a new fiber.
apply(reloadContext(), { stateTtlMs: 1000, teamId: "424242" });

check("a duplicate registration does not throw out of apply", reloadRoutes.size === 2, `${reloadRoutes.size} routes`);
check("the surviving route object is the first one", reloadRoutes.get(STATE_ROUTE)?.handler === firstHandlers.get(STATE_ROUTE));

const afterReload = await (async () => {
  const out = response();
  await reloadRoutes.get(STATE_ROUTE).handler(request("GET", STATE_ROUTE), out);
  return { status: out.status, json: out.json() };
})();
check("the surviving route answers 200 after a reload", afterReload.status === 200, `status ${afterReload.status}`);
check(
  "the surviving route serves the newest config",
  afterReload.json?.config?.teamId === "424242",
  `teamId=${afterReload.json?.config?.teamId}`,
);

const reloadedJournal = reloadRoutes.get(ACTION_ROUTE);
const afterReloadAction = await (async () => {
  const out = response();
  await reloadedJournal.handler(withBody(request("POST", ACTION_ROUTE), { action: "refresh" }), out);
  return { status: out.status, json: out.json() };
})();
check("the surviving action route still dispatches", afterReloadAction.status === 200, `status ${afterReloadAction.status}`);
check("the surviving action route sees the newest journal", Array.isArray(afterReloadAction.json?.state?.runs), `${afterReloadAction.json?.state?.runs?.length ?? "?"} runs`);

console.log(failures === 0 ? "PASS" : `FAIL (${failures})`);
process.exitCode = failures === 0 ? 0 : 1;

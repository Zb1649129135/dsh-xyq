/**
 * dsh-xyq — Xiaoyunque (小云雀) generation tools and Settings page for DSH.
 *
 * The Host half owns two things: the `pippit-tool-cli` process wrapper behind
 * `ops.js`, and the HTTP surface the Client half calls. Both are registered
 * through `ctx.inject`, so a composition without a Web server or without the
 * tools service still loads this package instead of failing the whole tree.
 *
 * Nothing in `apply` may throw: a synchronous throw fails this plugin's loader
 * fiber and surfaces as "Failed to load plugins" for the entire profile.
 */

import { RunJournal, stateDirectory } from "./store.js";
import { createOps, normalizeConfig } from "./ops.js";

const PACKAGE_ID = "dsh-xyq";
/**
 * Bumped whenever the route layer itself changes.
 *
 * The Web server keeps the first route object it accepted for a path, so a
 * process that started before a given fix keeps serving what it registered then
 * — a trampoline cannot help code that predates it. A new path has no such
 * predecessor: registering it always succeeds, so the running process picks the
 * change up without a restart. Bump this only for changes the surviving handler
 * cannot absorb on its own; ordinary logic changes ride the trampoline instead.
 *
 * `lib/client.js` carries the same tag — the two halves are separate bundles and
 * cannot import it, so keep them equal by hand.
 */
const ROUTE_TAG = "v2";
/**
 * One route for reads, one for mutations: fewer paths, one auth gate. Exported
 * so the smoke test can drive them without hardcoding a tag it would have to
 * keep in sync by hand.
 */
export const STATE_ROUTE = `/dsh-xyq/${ROUTE_TAG}/state`;
export const ACTION_ROUTE = `/dsh-xyq/${ROUTE_TAG}/action`;
/** Bytes of request body accepted on the action route. */
const MAX_BODY = 256 * 1024;

/**
 * The newest `ops` this process mounted.
 *
 * A disable/enable reload runs `apply` again in a fresh fiber, but the Web server
 * keeps the route objects it already accepted — the new fiber's `register` for the
 * same path does not replace them, and the old handler closes over the old fiber's
 * instance *and* the old copy of this module. The holder therefore lives on
 * `globalThis` under a registered symbol, which survives a module reload, so the
 * surviving handler resolves to whatever the newest `apply` built.
 */
const OPS_KEY = Symbol.for("dsh-xyq.ops");
let currentOps = null;

/** The live instance; handlers read through this so a reload is not stale. */
function live() {
  const shared = globalThis[OPS_KEY];
  const chosen = shared ?? currentOps;
  if (chosen === null || chosen === undefined) throw new Error("dsh-xyq has no mounted instance yet");
  return chosen;
}

/** Publish one instance for every fiber, current and reloaded. */
function publishOps(ops) {
  currentOps = ops;
  try {
    globalThis[OPS_KEY] = ops;
  } catch {
    /* a frozen global would only cost reload freshness */
  }
}

/**
 * The route handlers of the newest fiber, keyed by path.
 *
 * Registered with `Symbol.for` so a reloaded copy of this module writes into the
 * same table the surviving route objects read from.
 */
function sharedRoutes() {
  const key = Symbol.for("dsh-xyq.routes");
  let table = globalThis[key];
  if (table === null || typeof table !== "object") {
    table = Object.create(null);
    try {
      globalThis[key] = table;
    } catch {
      /* a frozen global falls back to per-fiber routing */
    }
  }
  return table;
}

/** A logger that cannot throw, whatever the context offers. */
function makeLogger(ctx) {
  let sink = null;
  try {
    const candidate = ctx?.logger;
    sink = typeof candidate === "function" ? candidate(PACKAGE_ID) : candidate ?? null;
  } catch {
    sink = null;
  }
  return (message) => {
    try {
      if (sink !== null && typeof sink.warn === "function") sink.warn(`[${PACKAGE_ID}] ${message}`);
      else if (sink !== null && typeof sink.info === "function") sink.info(`[${PACKAGE_ID}] ${message}`);
      else console.warn(`[${PACKAGE_ID}] ${message}`);
    } catch {
      /* logging must never break the boot */
    }
  };
}

/** Read a JSON request body, resolving to `null` for an empty or broken one. */
function readBody(request) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        finish(null);
        try {
          request.destroy();
        } catch {
          /* the socket may already be gone */
        }
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (raw === "") {
        finish({});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        finish(parsed !== null && typeof parsed === "object" ? parsed : {});
      } catch {
        finish(null);
      }
    });
    request.on("error", () => finish(null));
  });
}

/** Quote a value for a one-line tool report, tolerating absent fields. */
function show(value, fallback = "—") {
  const text = typeof value === "string" ? value.trim() : value === undefined || value === null ? "" : String(value);
  return text === "" ? fallback : text;
}

/**
 * The workspace of the session behind one tool call.
 *
 * A tool always has an agent, and the authoritative answer is the Host's
 * `workingDirectory` service: `session.header.cwd` is only the directory the
 * session started in, so it cannot follow a later move. Both are best effort —
 * a composition without that service, or a call with no agent (the smoke
 * harness), yields "" and the run falls back to the shared folder.
 */
function workspaceOf(ctx, exec) {
  const session = exec?.agent?.session ?? null;
  if (session === null || typeof session !== "object") return "";
  try {
    const service = typeof ctx?.get === "function" ? ctx.get("workingDirectory") : undefined;
    const current = typeof service?.get === "function" ? service.get(session) : "";
    if (typeof current === "string" && current.trim() !== "") return current.trim();
  } catch {
    /* fall through to the session's own record */
  }
  const cwd = session?.header?.cwd;
  return typeof cwd === "string" ? cwd.trim() : "";
}

/** The text an agent reads for one submitted run. */
function runReport(title, payload, run) {
  const lines = [`${title}已提交。`];
  if (payload !== null && typeof payload === "object") {
    lines.push(`thread_id: ${show(payload.thread_id)}`, `run_id: ${show(payload.run_id)}`);
    if (typeof payload.team_id === "string" && payload.team_id !== "") lines.push(`team_id: ${payload.team_id}`);
    if (typeof payload.web_thread_link === "string" && payload.web_thread_link !== "") {
      lines.push(`网页: ${payload.web_thread_link}`);
    }
  }
  lines.push(
    "",
    "生成是异步的：用 xyq_result 带上 run_id 查询进度，完成后再取下载地址。",
    run === null ? "本次提交没有返回 run_id，未记入本地运行列表。" : "已记入小云雀面板的最近运行。",
  );
  if (typeof run?.dir === "string" && run.dir !== "") lines.push(`产物目录: ${run.dir}`);
  if (typeof run?.video === "string" && run.video !== "") lines.push(`本次参数: ${run.video}`);
  return lines.join("\n");
}

/** The text an agent reads for one query-result poll. */
function queryReport(value) {
  const result = value?.result ?? null;
  if (result === null) {
    return value?.ok === false ? `查询失败：${show(value.error, "未知错误")}` : "查询没有返回结果。";
  }
  const lines = [
    `状态: ${show(result.status, "unknown")}${result.completed ? "（已完成）" : ""}`,
    `thread_id: ${show(result.threadId)}`,
    `run_id: ${show(result.runId)}`,
  ];
  if (result.errorMessage !== "") lines.push(`错误: ${result.errorMessage}`);
  const videos = Array.isArray(result.videos) ? result.videos : [];
  const images = Array.isArray(result.images) ? result.images : [];
  if (videos.length > 0) {
    lines.push("", "视频:");
    for (const item of videos) {
      lines.push(`- ${show(item.path, show(item.url))}${item.draft ? "（草稿预览）" : ""}`);
    }
  }
  if (images.length > 0) {
    lines.push("", "图片:");
    for (const item of images) lines.push(`- ${show(item.path, show(item.url))}`);
  }
  if (videos.length === 0 && images.length === 0 && !result.completed) {
    lines.push("", "还没有产物：任务仍在运行，稍后再查一次。");
  }
  if (value?.downloadDir) lines.push("", `产物目录: ${value.downloadDir}`);
  return lines.join("\n");
}

/**
 * Register the six agent tools.
 *
 * Each registration is isolated: one failing schema costs that tool, not the
 * page and not the rest of the tools.
 */
function registerTools(ctx, warn) {
  if (typeof ctx?.inject !== "function") return;
  const textOutput = (keys) => ({
    schema: {
      type: "object",
      additionalProperties: true,
      properties: Object.fromEntries(keys.map((key) => [key, { type: "string" }])),
    },
    render(_args, value) {
      const report = typeof value?.report === "string" ? value.report : JSON.stringify(value, null, 2);
      return [{ type: "text", text: report }];
    },
  });

  const tools = [
    {
      name: "xyq_status",
      description:
        "Check the Xiaoyunque (小云雀 / pippit) CLI: whether pippit-tool-cli was found, whether this machine is logged in, the installed CLI version, and the remaining credit balance. Use it first when any other xyq_* tool reports an authentication or missing-CLI error.",
      parameters: { type: "object", additionalProperties: false, properties: {} },
      output: textOutput(["report"]),
      async execute() {
        const state = await live().snapshot({ force: true });
        const lines = [
          `CLI: ${state.cli.found ? show(state.cli.command) : "未找到"}`,
          `版本: ${show(state.cli.version)}`,
          `登录: ${state.auth.loggedIn ? `已登录${state.auth.uid ? `（uid ${state.auth.uid}）` : ""}` : "未登录"}`,
        ];
        if (state.auth.expiresAt !== "") lines.push(`凭证到期: ${state.auth.expiresAt}`);
        if (state.credit !== null) {
          if (typeof state.credit.error === "string" && state.credit.error !== "") lines.push(`积分: 读取失败 - ${state.credit.error}`);
          else lines.push(`剩余积分: ${show(state.credit.totalRemain)}`);
        }
        if (!state.cli.found) {
          lines.push("", "安装 CLI：npx @pippit-dev/cli@latest install，然后在插件行把 cliPath 指向它（或留空自动发现）。");
        } else if (!state.auth.loggedIn) {
          lines.push("", "登录：在 DSH 侧栏「小云雀」面板里点「登录」，或运行 pippit-tool-cli login。");
        }
        if (state.auth.error) lines.push("", `错误: ${state.auth.error}`);
        return { report: lines.join("\n") };
      },
    },
    {
      name: "xyq_models",
      description:
        "List or describe the Xiaoyunque image and video models available to this account. Image generation needs an exact image model display name; video generation needs a video model key. Call this before generating when the model name is unknown.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: { type: "string", enum: ["video", "image"], description: 'Model family. Defaults to "video".' },
          name: {
            type: "string",
            description: "Exact model key or display name. When present, returns that model's parameters instead of the list.",
          },
          refresh: { type: "boolean", description: "Ignore the five-minute catalog cache and re-fetch." },
        },
      },
      output: textOutput(["report"]),
      async execute(args) {
        const type = args?.type === "image" ? "image" : "video";
        const name = typeof args?.name === "string" ? args.name.trim() : "";
        if (name !== "") {
          const described = await live().describeModel(name, type);
          if (!described.ok || described.summary === null) {
            return { report: `读取模型失败：${show(described.error, "未知错误")}` };
          }
          return { report: live().modelReport(described.summary) };
        }
        const listed = await live().readModels(type, args?.refresh === true);
        if (!listed.ok || !Array.isArray(listed.models)) {
          return { report: `模型列表读取失败：${show(listed.error, "未知错误")}\n提示：模型查询需要登录，先运行 pippit-tool-cli login。` };
        }
        const lines = [`${type} 模型 ${listed.models.length} 个${listed.cached ? "（缓存）" : ""}:`];
        for (const model of listed.models) {
          lines.push(`- ${model.name}${model.key !== model.name ? `  key=${model.key}` : ""}${model.description ? ` — ${model.description}` : ""}`);
        }
        lines.push("", type === "image" ? "generate-image 的 --model 用完整显示名。" : "generate-video 的 --model 用上面的 key。");
        return { report: lines.join("\n") };
      },
    },
    {
      name: "xyq_generate_image",
      description:
        "Generate images with Xiaoyunque (小云雀 / pippit). Returns a run_id immediately; the image is produced asynchronously, so follow up with xyq_result. Credit is consumed per generation.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["prompt", "model"],
        properties: {
          prompt: { type: "string", description: "What to draw." },
          model: {
            type: "string",
            description: 'Exact image model display name from xyq_models type="image", e.g. "Seedream 4.0". Quote names containing spaces.',
          },
          ratio: { type: "string", description: "Integer ratio enum from the model's supported list, e.g. 0=adaptive, 2=16:9, 3=9:16, 6=1:1." },
          resolution: { type: "string", description: "Resolution label accepted by that model, e.g. 1K, 2K, 4K." },
          effort: { type: "string", description: "Reasoning effort, only values the model exposes." },
          count: { type: "integer", description: "How many images to generate.", minimum: 1, maximum: 10 },
          images: {
            type: "array",
            items: { type: "string" },
            description: "Local reference image paths (.jpg .jpeg .png .gif .bmp .webp .svg). Repeatable.",
          },
        },
      },
      output: textOutput(["report"]),
      async execute(args, exec) {
        const submitted = await live().generateImage(args, { workspace: workspaceOf(ctx, exec) });
        if (submitted.ok !== true) return { report: `生成失败：${show(submitted.error, "未知错误")}` };
        return { report: runReport("图片生成任务", submitted.data, submitted.run) };
      },
    },
    {
      name: "xyq_generate_video",
      description:
        "Generate a video with Xiaoyunque (小云雀 / pippit). Returns a run_id immediately; rendering is asynchronous, so follow up with xyq_result. Credit is consumed per generation.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          prompt: { type: "string", description: "What the video should show. May be omitted only when rendering a draft with draftTaskId." },
          model: { type: "string", description: "Video model key from xyq_models." },
          ratio: {
            type: "string",
            description: "Aspect ratio. The service requires one; omitted, the model's own default is used. Valid values differ per model, so check xyq_models with the model key before choosing: adaptive, 16:9, 21:9, 9:16, 4:3, 3:4, 1:1.",
          },
          resolution: {
            type: "string",
            description: "Resolution label the model accepts (480p, 720p, 1080p, 4k). Omitted, the model default is used; the mini models take no resolution at all.",
          },
          duration: {
            type: "integer",
            description: "Duration in seconds. Omitted, the model default is used. The service requires this field, so a value outside the model's range is rejected before submitting.",
            minimum: 1,
            maximum: 60,
          },
          taskType: { type: "string", enum: ["auto", "reference", "edit", "extend"], description: "Task type passed to the service." },
          generateType: {
            type: "integer",
            description: "Set 1 for first-and-last-frame generation; supply exactly two images in first, last order.",
          },
          seed: { type: "integer", description: "Custom seed; omit for a random one." },
          draft: { type: "boolean", description: "Render a cheap draft preview first (Seedance 2.5 draft)." },
          draftTaskId: { type: "string", description: "draft_task_id from xyq_result, to render the final video of that draft." },
          images: { type: "array", items: { type: "string" }, description: "Local reference image paths." },
          videos: { type: "array", items: { type: "string" }, description: "Local reference video paths." },
          audios: { type: "array", items: { type: "string" }, description: "Local reference audio paths (.mp3 .wav)." },
        },
      },
      output: textOutput(["report"]),
      async execute(args, exec) {
        const submitted = await live().generateVideo(args, { workspace: workspaceOf(ctx, exec) });
        if (submitted.ok !== true) return { report: `生成失败：${show(submitted.error, "未知错误")}` };
        return { report: runReport("视频生成任务", submitted.data, submitted.run) };
      },
    },
    {
      name: "xyq_result",
      description:
        "Poll one Xiaoyunque (小云雀 / pippit) run by run_id or thread_id, downloading the finished media into the run's folder. A run submitted from a session lands in <workspace>/.xyq/<run id>; one submitted without a session falls back to the shared folder. Generation is asynchronous: call this after xyq_generate_image or xyq_generate_video, and again while it reports running.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          runId: { type: "string", description: "run_id returned by a submit." },
          threadId: { type: "string", description: "thread_id returned by a submit, when the run id is unknown." },
          dir: { type: "string", description: "Absolute folder to download into, overriding the run's own folder." },
        },
      },
      output: textOutput(["report"]),
      async execute(args, exec) {
        const queried = await live().queryResult(args, { workspace: workspaceOf(ctx, exec) });
        return { report: queryReport(queried) };
      },
    },
    {
      name: "xyq_upload",
      description:
        "Upload one local file or one HTTPS URL to Xiaoyunque (小云雀 / pippit) and return its asset id. Use it when a generation needs a reference the local CLI cannot see, such as a remote image.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string", description: "Absolute local file path, under 500 MB." },
          url: { type: "string", description: "HTTPS URL to import. Give either path or url, not both." },
        },
      },
      output: textOutput(["report"]),
      async execute(args) {
        const uploaded = await live().uploadFile(args);
        if (uploaded.ok !== true) return { report: `上传失败：${show(uploaded.error, "未知错误")}` };
        return { report: `已上传。\nasset_id: ${show(uploaded.assetId, "（响应里没有 asset_id）")}` };
      },
    },
  ];

  try {
    ctx.inject(["tools"], (scoped) => {
      if (typeof scoped?.tools?.register !== "function") return;
      for (const definition of tools) {
        try {
          const dispose = scoped.tools.register(definition);
          if (typeof dispose === "function" && typeof scoped.on === "function") {
            try {
              scoped.on("dispose", dispose);
            } catch {
              /* disposal is best-effort */
            }
          }
        } catch (error) {
          warn(`could not register the ${definition.name} tool: ${String(error)}`);
        }
      }
    });
  } catch (error) {
    warn(`could not inject the tools service: ${String(error)}`);
  }
}

/** Register the two Web routes the Settings page and the composer pill use. */
function registerRoutes(ctx, ops, warn) {
  publishOps(ops);
  if (typeof ctx?.inject !== "function") return;
  try {
    ctx.inject(["webServer"], (scoped) => {
      if (typeof scoped?.webServer?.register !== "function") return;

      const respond = (response, status, body) => {
        try {
          const payload = JSON.stringify(body);
          response.writeHead(status, {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            "content-length": Buffer.byteLength(payload),
          });
          response.end(payload);
        } catch {
          /* the socket may already be gone */
        }
      };

      /** The Host's Connection service, wherever this composition exposes it. */
      const connectionService = () => {
        for (const scope of [scoped, ctx]) {
          try {
            if (typeof scope?.get === "function") {
              const found = scope.get("connection");
              if (found !== null && found !== undefined) return found;
            }
          } catch {
            /* a context without that service is a normal composition */
          }
        }
        return null;
      };

      /**
       * Whether the caller speaks for the GUI window: `true`/`false` from the
       * signed session cookie, or `null` when this deployment mounts no
       * Connection service and the answer is not observable.
       */
      const browserSession = (request) => {
        const connection = connectionService();
        const auth = connection === null || connection === undefined ? null : connection.browserAuth;
        if (auth === null || auth === undefined || typeof auth.isAuthenticated !== "function") return null;
        let secure = false;
        try {
          secure = scoped.get("webServer")?.protocol === "https:";
        } catch {
          secure = false;
        }
        try {
          return auth.isAuthenticated(request, secure) === true;
        } catch {
          return false;
        }
      };

      /**
       * Every request has to prove it came from the GUI, never from a script:
       * the state route reports the account, the credit balance and the prompt
       * of every recent run, so it is not a public read either.
       */
      const guarded = (handler) => (request, response) => {
        if (browserSession(request) === false) {
          respond(response, 401, {
            error: "this change has to come from the DSH window",
            hint: "The request carried no signed session cookie. Use the Settings page instead: a script, or a model with shell access, cannot act for you.",
          });
          return;
        }
        return handler(request, response);
      };

      const stateHandler = guarded(async (request, response) => {
        if (request.method !== "GET") {
          respond(response, 405, { error: "method not allowed" });
          return;
        }
        const force = (() => {
          try {
            return new URL(String(request.url ?? ""), "http://127.0.0.1").searchParams.get("force") === "1";
          } catch {
            return false;
          }
        })();
        try {
          respond(response, 200, await live().snapshot({ force }));
        } catch (error) {
          respond(response, 500, { error: String(error?.message ?? error) });
        }
      });

      /**
       * One POST route, dispatched by `action`. Every branch returns JSON so the
       * page never has to parse a stack trace.
       */
      const actionHandler = guarded(async (request, response) => {
        if (request.method !== "POST") {
          respond(response, 405, { error: "method not allowed" });
          return;
        }
        const body = await readBody(request);
        if (body === null) {
          respond(response, 400, { error: "request body is not valid JSON" });
          return;
        }
        const action = typeof body.action === "string" ? body.action : "";
        const payload = body.payload !== null && typeof body.payload === "object" ? body.payload : {};
        try {
          switch (action) {
            case "refresh":
              live().invalidate();
              respond(response, 200, { ok: true, state: await live().snapshot({ force: true }) });
              return;
            case "models": {
              const listed = await live().readModels(payload.type === "image" ? "image" : "video", payload.refresh === true);
              respond(response, 200, {
                ok: listed.ok,
                error: listed.error,
                models: listed.models,
                cached: listed.cached,
                fetchedAt: listed.fetchedAt,
              });
              return;
            }
            case "spaces": {
              const spaces = await live().listSpaces();
              respond(response, 200, spaces);
              return;
            }
            case "login":
              respond(response, 200, { ok: true, ...live().startLogin(payload.force === true) });
              return;
            case "logout": {
              const result = await live().logout();
              respond(response, 200, result);
              return;
            }
            case "query": {
              const queried = await live().queryResult(payload);
              respond(response, 200, { ...queried, state: await live().snapshot({ force: true }) });
              return;
            }
            case "forget": {
              const removed = live().journal.remove(
                typeof payload.runId === "string" ? payload.runId : "",
                typeof payload.threadId === "string" ? payload.threadId : "",
              );
              respond(response, 200, { ok: true, removed, state: await live().snapshot({ force: true }) });
              return;
            }
            case "open-download-dir": {
              /*
               * Opens the OS file manager. With no `dir` this is the shared
               * folder; the page passes a run's own folder instead, and the
               * Host rejects anything outside what this plugin writes.
               */
              respond(response, 200, live().openDownloadDirectory(payload.dir));
              return;
            }
            case "open-file": {
              respond(response, 200, live().openResultFile(payload.path));
              return;
            }
            default:
              respond(response, 400, { error: `unknown action: ${action === "" ? "(empty)" : action}` });
          }
        } catch (error) {
          respond(response, 500, { error: String(error?.message ?? error) });
        }
      });

      for (const [path, handler] of [
        [STATE_ROUTE, stateHandler],
        [ACTION_ROUTE, actionHandler],
      ]) {
        /*
         * The route table keeps the FIRST handler object registered for a path:
         * `register` throws on a duplicate (kind, path), and the throwing
         * registration is the reloaded fiber's. So the object that survives may
         * close over an older copy of this module. Each path therefore gets a
         * trampoline that reads the newest handler out of a registry on
         * `globalThis`, which outlives a module reload; the reloaded fiber
         * overwrites that entry and the surviving object serves the new code.
         */
        const routes = sharedRoutes();
        routes[path] = handler;
        const trampoline = (request, response) => {
          const current = sharedRoutes()[path];
          if (typeof current !== "function") {
            respond(response, 503, { error: "the plugin is reloading" });
            return undefined;
          }
          return current(request, response);
        };
        /*
         * The registration belongs to this fiber, so a real teardown frees the
         * path: `effect` runs the callback at once and disposes what it returns.
         */
        const mount = () => {
          try {
            const dispose = scoped.webServer.register({ kind: "exact", path, handler: trampoline });
            return typeof dispose === "function" ? dispose : undefined;
          } catch (error) {
            // A duplicate path is this plugin's own earlier registration still
            // holding the seat; the trampoline above already points at the
            // newest handler, so nothing is lost.
            warn(`the ${path} route was already registered (a reload, most likely): ${String(error)}`);
            return undefined;
          }
        };
        if (typeof scoped.effect === "function") scoped.effect(mount);
        else mount();
      }
    });
  } catch (error) {
    warn(`could not inject the web server service: ${String(error)}`);
  }
}

/** Mount the plugin. Must never throw. */
export function apply(ctx, config) {
  try {
    const warn = makeLogger(ctx);
    const settings = normalizeConfig(config);
    let journal;
    try {
      journal = new RunJournal(stateDirectory());
    } catch (error) {
      warn(`could not open the run journal: ${String(error)}`);
      journal = new RunJournal(stateDirectory());
    }
    const ops = createOps({ config: settings, journal, warn });
    registerRoutes(ctx, ops, warn);
    registerTools(ctx, warn);
    if (!ops.hasCli()) {
      warn("pippit-tool-cli was not found; the Settings page will explain how to install it.");
    }
  } catch (error) {
    try {
      console.warn(`[${PACKAGE_ID}] apply failed: ${String(error)}`);
    } catch {
      /* nothing left to report through */
    }
  }
}

export default { name: PACKAGE_ID, apply };

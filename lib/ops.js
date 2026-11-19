/**
 * Everything the plugin can do with the Xiaoyunque CLI, in one place.
 *
 * Two callers reach this module — the Web route behind the Settings page and
 * the agent tools — which is why each operation has exactly one implementation
 * here instead of code in both places.
 */

import { resolveLaunch, runCli } from "./cli.js";
import { ensureDirectory, resolveDownloadDir, stateDirectory } from "./store.js";

/** Longest a submit or upload may take before the child is killed. */
const SUBMIT_TIMEOUT = 10 * 60 * 1000;
/** A query-result call downloads media, so it gets room too. */
const QUERY_TIMEOUT = 5 * 60 * 1000;
/** Cheap, local, or network-light calls. */
const SHORT_TIMEOUT = 30 * 1000;
/** How long a credit balance stays fresh before it is fetched again. */
const CREDIT_TTL = 60 * 1000;
/** The CLI caches its model catalog for five minutes; mirror that here. */
const MODEL_TTL = 5 * 60 * 1000;
/** Cap on reference media per submit, to keep one call reviewable. */
const MAX_MEDIA = 8;

/** Trim a config value to a string, empty when unusable. */
function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

/** Clamp a numeric config value into a range, with a fallback. */
function numeric(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

/** Normalise the row config, so a hand-edited patch cannot produce surprises. */
export function normalizeConfig(raw) {
  const source = raw !== null && typeof raw === "object" ? raw : {};
  return {
    cliPath: text(source.cliPath),
    cwd: text(source.cwd),
    downloadDir: text(source.downloadDir),
    teamId: text(source.teamId),
    stateTtlMs: numeric(source.stateTtlMs, 6000, 1000, 120000),
  };
}

/** Keep only non-empty strings from a list-or-scalar argument. */
function mediaList(value) {
  const raw = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return raw.map((item) => text(item)).filter((item) => item !== "").slice(0, MAX_MEDIA);
}

/** Run a query-result payload through the CLI's indented JSON output. */
function readQuery(payload) {
  if (payload === null || typeof payload !== "object") return null;
  return {
    status: text(payload.status),
    completed: payload.completed === true,
    threadId: text(payload.thread_id),
    runId: text(payload.run_id),
    errorMessage: text(payload.error_message),
    videos: Array.isArray(payload.videos)
      ? payload.videos.map((item) => ({
          url: text(item?.download_url),
          path: text(item?.output_path),
          draft: item?.draft === true,
          draftTaskId: text(item?.draft_task_id),
        }))
      : [],
    images: Array.isArray(payload.images)
      ? payload.images.map((item) => ({ url: text(item?.download_url), path: text(item?.output_path) }))
      : [],
  };
}

/**
 * Summarise one video or image model entry from `model list`.
 *
 * Image models carry only a display name; video models carry a key as well. The
 * key therefore falls back to the name, which is also what `--model` accepts for
 * an image, so `key` is always the string to pass on the command line.
 */
function readModel(entry) {
  const name = text(entry?.name);
  return {
    key: text(entry?.key) || name,
    name: name || text(entry?.key),
    kind: text(entry?.kind),
    description: text(entry?.description),
  };
}

/**
 * Distil one model's parameter schema into the flags a caller can actually pass.
 *
 * Image models index ratios by integer code (`{"2":"16:9"}`), video models by the
 * literal string, so both shapes are folded into one list of accepted values.
 */
function summariseModel(model, type) {
  const summary = {
    name: text(model?.name) || text(model?.key),
    kind: text(model?.kind) || type,
    description: text(model?.description),
    ratios: [],
    resolutions: [],
  };
  const ratioLabels = model?.ratio?.option_labels !== null && typeof model?.ratio?.option_labels === "object" ? model.ratio.option_labels : null;
  if (ratioLabels !== null) {
    for (const code of Array.isArray(model.ratio.options) ? model.ratio.options : Object.keys(ratioLabels)) {
      const label = text(ratioLabels[String(code)]);
      summary.ratios.push(label === "" ? String(code) : label);
    }
  } else if (Array.isArray(model?.ratio?.options)) {
    summary.ratios = model.ratio.options.map((option) => text(option)).filter((option) => option !== "");
  }
  if (Array.isArray(model?.resolution?.options)) {
    summary.resolutions = model.resolution.options.map((option) => text(option)).filter((option) => option !== "");
  }
  if (summary.resolutions.length === 0) {
    for (const dimension of Array.isArray(model?.parameter_config?.dimensions) ? model.parameter_config.dimensions : []) {
      if (dimension?.key !== "resolution") continue;
      for (const option of Array.isArray(dimension.option_list) ? dimension.option_list : []) {
        const value = text(option?.value);
        if (value !== "") summary.resolutions.push(value);
      }
    }
  }
  const taskTypes = [];
  for (const mode of Array.isArray(model?.creation_modes) ? model.creation_modes : []) {
    const taskType = text(mode?.task_type);
    if (taskType !== "" && !taskTypes.includes(taskType)) taskTypes.push(taskType);
  }
  if (taskTypes.length > 0) summary.taskTypes = taskTypes;
  const duration = model?.duration ?? null;
  if (duration !== null && typeof duration === "object") {
    summary.duration = { min: Number(duration.min) || null, max: Number(duration.max) || null, default: Number(duration.default) || null, unit: text(duration.unit) || "seconds" };
  }
  return summary;
}

/** The text a caller reads for one model: the facts that map onto flags. */
function modelReport(summary) {
  const lines = [`${summary.name}（${summary.kind}）`];
  if (summary.description !== "") lines.push(summary.description);
  if (summary.ratios.length > 0) lines.push(`--ratio: ${summary.ratios.join(", ")}`);
  if (summary.resolutions.length > 0) lines.push(`--resolution: ${summary.resolutions.join(", ")}`);
  if (summary.duration) {
    const range = summary.duration.min !== null && summary.duration.max !== null ? `${summary.duration.min}-${summary.duration.max}` : "?";
    lines.push(`--duration: ${range} ${summary.duration.unit}${summary.duration.default !== null ? `（默认 ${summary.duration.default}）` : ""}`);
  }
  if (summary.taskTypes) lines.push(`--task-type: ${summary.taskTypes.join(", ")}`);
  return lines.join("\n");
}

/**
 * Build the operation table.
 *
 * @param options.config - normalised row config.
 * @param options.journal - the run journal.
 * @param options.warn - logger that cannot throw.
 */
export function createOps({ config, journal, warn }) {
  /** The resolved launch plan; recomputed per call so a late install is picked up. */
  let launchCache = null;
  const launch = () => {
    if (launchCache === null) launchCache = resolveLaunch(config.cliPath);
    return launchCache;
  };
  /** Forget a cached "not found" answer, e.g. after the user installs the CLI. */
  const forgetLaunch = () => {
    launchCache = null;
  };

  const credit = { at: 0, value: null, error: null };
  const models = { at: 0, type: null, value: null, error: null };
  /** ratio label → integer code, per image model. `null` means "not a code map". */
  const ratioCodes = new Map();
  let login = { running: false, startedAt: 0, finishedAt: 0, error: null };
  let version = null;

  /** Space selector flags, applied after the subcommand name. */
  const spaceArgs = () => (config.teamId === "" ? [] : ["--team-id", config.teamId]);

  /** Run the CLI with the shared cwd and space context. */
  const call = (args, timeoutMs) =>
    runCli(launch(), [...args.slice(0, 1), ...spaceArgs(), ...args.slice(1)], {
      cwd: config.cwd === "" ? undefined : config.cwd,
      timeoutMs,
    });

  /** Turn a CLI result into the shape the callers want. */
  const outcome = (result) => ({ ok: result.ok, error: result.error, data: result.json });

  /* ---------------------------------------------------------------- *
   * reads
   * ---------------------------------------------------------------- */

  /** `status`: the login state, with no network call of its own. */
  async function readStatus() {
    const result = await call(["status"], SHORT_TIMEOUT);
    if (!result.ok) return { loggedIn: false, error: result.error, source: "" };
    const payload = result.json !== null && typeof result.json === "object" ? result.json : {};
    return {
      loggedIn: payload.logged_in === true,
      source: text(payload.source),
      uid: text(payload.uid),
      credentialScope: text(payload.credential_scope),
      expiresAt: text(payload.expires_at),
      defaultSpace: payload.default_space ?? null,
      error: null,
    };
  }

  /** `--version`, cached for the life of the process. */
  async function readVersion() {
    if (version !== null) return version;
    const result = await call(["--version"], SHORT_TIMEOUT);
    version = result.ok ? text(result.stdout).split(/\r?\n/)[0] : null;
    return version;
  }

  /** The credit balance, cached briefly because it is a network call. */
  async function readCredit(force = false) {
    const fresh = credit.at !== 0 && Date.now() - credit.at < CREDIT_TTL;
    if (!force && fresh) return credit;
    const result = await call(["get-credit-balance"], SHORT_TIMEOUT);
    const payload = result.json !== null && typeof result.json === "object" ? result.json : null;
    credit.at = Date.now();
    credit.value = result.ok && payload !== null ? { totalRemain: text(payload.total_remain_amount), logId: text(payload.log_id) } : null;
    credit.error = result.ok ? null : result.error;
    return credit;
  }

  /**
   * The model catalog for one type, cached for the CLI's own five minutes.
   *
   * An empty or failed read is never cached: "signed out for a moment" and "this
   * account has no models" would otherwise stick for five minutes and the page
   * would keep showing an empty catalog after the account came back.
   */
  async function readModels(type, force = false) {
    const wanted = type === "image" ? "image" : "video";
    const fresh = models.at !== 0 && models.type === wanted && Array.isArray(models.value) && models.value.length > 0 && Date.now() - models.at < MODEL_TTL;
    if (!force && fresh) return { ok: true, error: models.error, models: models.value, cached: true, fetchedAt: models.at };
    const args = ["model", ...(force ? ["--refresh"] : []), "-t", wanted];
    const result = await call(args, SHORT_TIMEOUT);
    const payload = result.json !== null && typeof result.json === "object" ? result.json : null;
    const list = Array.isArray(payload?.models) ? payload.models.map(readModel).filter((item) => item.key !== "") : null;
    const usable = result.ok && list !== null && list.length > 0;
    if (usable) {
      models.at = Date.now();
      models.type = wanted;
      models.value = list;
      models.error = null;
    }
    return { ok: result.ok, error: result.ok ? null : result.error, models: list, cached: payload?.cached === true, fetchedAt: usable ? models.at : 0 };
  }

  /**
   * A model's parameter schema, distilled.
   *
   * The raw payload is 30-60 KB for a video model — plans, benefit maps, safety
   * popups, material limits — and handing that to a model costs more context than
   * the whole conversation. Only what a caller can turn into CLI flags survives:
   * the accepted `--ratio` values, `--resolution` values, the `--duration` range,
   * and the task types the model offers.
   */
  async function describeModel(name, type) {
    const wanted = type === "image" ? "image" : "video";
    const result = await call(["model", name, "-t", wanted], SHORT_TIMEOUT);
    const payload = result.json !== null && typeof result.json === "object" ? result.json : null;
    const model = payload?.model !== null && typeof payload?.model === "object" ? payload.model : null;
    if (!result.ok || model === null) return { ok: result.ok, error: result.error, model: null, summary: null };
    return { ok: true, error: null, model, summary: summariseModel(model, wanted) };
  }

  /** The spaces this account can generate in. */
  async function listSpaces() {
    const result = await call(["space", "list"], SHORT_TIMEOUT);
    const payload = result.json !== null && typeof result.json === "object" ? result.json : null;
    return {
      ok: result.ok,
      error: result.error,
      spaces: Array.isArray(payload?.spaces) ? payload.spaces : [],
      current: payload?.current ?? null,
    };
  }

  /* ---------------------------------------------------------------- *
   * submits
   * ---------------------------------------------------------------- */

  /** Record a submitted run and return it. */
  function record(kind, payload, prompt, model) {
    const runId = text(payload?.run_id);
    const threadId = text(payload?.thread_id);
    if (runId === "" && threadId === "") return null;
    return journal.add({
      runId,
      threadId,
      kind,
      prompt,
      model,
      webThreadLink: text(payload?.web_thread_link),
      status: "submitted",
      createdAt: Date.now(),
    });
  }

  /**
   * `generate-image --ratio` takes an integer code, not the label a caller sees.
   *
   * `model list` and the distilled description both speak in labels ("16:9"), so the
   * label is translated back through the model's own `option_labels` map. A caller
   * that already passes a code is left alone; an unknown label is passed through
   * unchanged and the CLI's own error explains what it accepts.
   */
  async function imageRatioCode(model, ratio) {
    if (/^-?\d+$/.test(ratio)) return ratio;
    const cached = ratioCodes.get(model);
    let codes = cached;
    if (codes === undefined) {
      const described = await describeModel(model, "image");
      codes = null;
      const labels = described.model?.ratio?.option_labels;
      if (labels !== null && typeof labels === "object") {
        codes = new Map();
        for (const [code, label] of Object.entries(labels)) codes.set(text(label), code);
      }
      ratioCodes.set(model, codes);
    }
    if (codes === null) return ratio;
    return codes.get(ratio) ?? ratio;
  }

  /** `generate-image`. */
  async function generateImage(args) {
    const prompt = text(args?.prompt);
    const model = text(args?.model);
    if (prompt === "") return { ok: false, error: "缺少 --prompt：请描述要生成的画面。" };
    if (model === "") return { ok: false, error: "缺少 --model：请先用 xyq_models 查询可用的图片模型完整名称。" };

    const argv = ["generate-image", "--prompt", prompt, "--model", model];
    const ratio = text(args?.ratio);
    if (ratio !== "") argv.push("--ratio", await imageRatioCode(model, ratio));
    const resolution = text(args?.resolution);
    if (resolution !== "") argv.push("--resolution", resolution);
    const effort = text(args?.effort);
    if (effort !== "") argv.push("--effort", effort);
    const count = Number(args?.count);
    if (Number.isFinite(count) && count > 0) argv.push("--generate-image-count", String(Math.round(count)));
    for (const image of mediaList(args?.images)) argv.push("--image", image);

    const result = await call(argv, SUBMIT_TIMEOUT);
    if (!result.ok) return outcome(result);
    const run = record("image", result.json, prompt, model);
    return { ok: true, error: null, data: result.json, run };
  }

  /** `generate-video`. */
  async function generateVideo(args) {
    const prompt = text(args?.prompt);
    const draftTaskId = text(args?.draftTaskId);
    if (prompt === "" && draftTaskId === "") {
      return { ok: false, error: "缺少 --prompt：请描述要生成的视频内容。" };
    }

    const argv = ["generate-video"];
    if (prompt !== "") argv.push("--prompt", prompt);
    const model = text(args?.model);
    if (model !== "") argv.push("--model", model);
    const ratio = text(args?.ratio);
    if (ratio !== "") argv.push("--ratio", ratio);
    const resolution = text(args?.resolution);
    if (resolution !== "") argv.push("--resolution", resolution);
    const taskType = text(args?.taskType);
    if (taskType !== "") argv.push("--task-type", taskType);
    const duration = Number(args?.duration);
    if (Number.isFinite(duration) && duration > 0) argv.push("--duration", String(Math.round(duration)));
    const generateType = Number(args?.generateType);
    if (Number.isFinite(generateType) && generateType > 0) argv.push("--generate-type", String(Math.round(generateType)));
    const seed = Number(args?.seed);
    if (Number.isFinite(seed)) argv.push("--seed", String(Math.round(seed)));
    if (args?.draft === true) argv.push("--draft");
    if (draftTaskId !== "") argv.push("--draft-task-id", draftTaskId);
    for (const image of mediaList(args?.images)) argv.push("--image", image);
    for (const video of mediaList(args?.videos)) argv.push("--video", video);
    for (const audio of mediaList(args?.audios)) argv.push("--audio", audio);

    const result = await call(argv, SUBMIT_TIMEOUT);
    if (!result.ok) return outcome(result);
    const run = record("video", result.json, prompt, model);
    return { ok: true, error: null, data: result.json, run };
  }

  /** `upload-file`: one local path or one HTTPS URL. */
  async function uploadFile(args) {
    const path = text(args?.path);
    const url = text(args?.url);
    if ((path === "") === (url === "")) return { ok: false, error: "请给出 --path（本地文件）或 --url（HTTPS 链接）其中之一。" };
    if (url !== "" && !/^https:\/\//i.test(url)) return { ok: false, error: "--url 只接受 HTTPS 链接。" };
    const argv = url === "" ? ["upload-file", "--path", path] : ["upload-file", "--url", url];
    const result = await call(argv, SUBMIT_TIMEOUT);
    const payload = result.json !== null && typeof result.json === "object" ? result.json : null;
    return { ok: result.ok, error: result.error, assetId: text(payload?.asset_id), data: result.json };
  }

  /* ---------------------------------------------------------------- *
   * results
   * ---------------------------------------------------------------- */

  /**
   * `query-result`: one poll, optionally downloading into the managed folder.
   *
   * The CLI insists on both ids together, so a caller that knows only one — which is
   * easy, since a submit prints both but a retry may quote only the run id — gets the
   * other from the journal. A still-running task exits non-zero while returning a
   * perfectly good `{status:"running"}` payload, so the payload decides success.
   */
  async function queryResult(args) {
    let runId = text(args?.runId);
    let threadId = text(args?.threadId);
    if (runId === "" || threadId === "") {
      const known = journal.list(200).find((run) => (runId !== "" ? run.runId === runId : run.threadId === threadId));
      if (known) {
        if (runId === "") runId = text(known.runId);
        if (threadId === "") threadId = text(known.threadId);
      }
    }
    if (runId === "" && threadId === "") return { ok: false, error: "请给出 runId 或 threadId。" };
    if (runId === "" || threadId === "") {
      return { ok: false, error: `查询需要 run_id 与 thread_id 两个参数，只找到 ${runId === "" ? "--thread-id" : "--run-id"}：请把另一个也传进来。` };
    }
    const argv = ["query-result", "--run-id", runId, "--thread-id", threadId];
    if (args?.download !== false) {
      const directory = ensureDirectory(resolveDownloadDir(config.downloadDir));
      if (directory !== null) argv.push("--download-dir", directory);
    }
    const result = await call(argv, QUERY_TIMEOUT);
    const parsed = readQuery(result.json);
    const failed = parsed === null;
    const status = parsed === null ? "" : parsed.status !== "" ? parsed.status : parsed.completed ? "completed" : "unknown";
    if (parsed !== null) journal.patch(runId, threadId, { status, note: parsed.errorMessage });
    return {
      ok: !failed,
      error: failed ? result.error : null,
      result: parsed,
      raw: result.json,
      downloadDir: resolveDownloadDir(config.downloadDir),
    };
  }

  /* ---------------------------------------------------------------- *
   * session actions (GUI only)
   * ---------------------------------------------------------------- */

  /** Start `login` without blocking the request; the page polls `status`. */
  function startLogin(force) {
    if (login.running) return { started: false, running: true, startedAt: login.startedAt };
    login = { running: true, startedAt: Date.now(), finishedAt: 0, error: null };
    const args = force === true ? ["login", "--force"] : ["login"];
    void call(args, 6 * 60 * 1000).then((result) => {
      login = {
        running: false,
        startedAt: login.startedAt,
        finishedAt: Date.now(),
        error: result.ok ? null : result.error,
      };
      if (result.ok) {
        credit.at = 0;
        models.at = 0;
      }
      forgetLaunch();
    });
    return { started: true, running: true, startedAt: login.startedAt };
  }

  /** `logout`: clears the local credential only; the CLI says so itself. */
  async function logout() {
    const result = await call(["logout"], SHORT_TIMEOUT);
    credit.at = 0;
    models.at = 0;
    return outcome(result);
  }

  /* ---------------------------------------------------------------- *
   * the GUI snapshot
   * ---------------------------------------------------------------- */

  let snapshotCache = { at: 0, value: null };

  /** Everything the Settings page and the composer pill render from. */
  async function snapshot({ force = false } = {}) {
    const fresh = snapshotCache.at !== 0 && Date.now() - snapshotCache.at < config.stateTtlMs;
    if (!force && fresh && snapshotCache.value !== null) return { ...snapshotCache.value, cached: true };

    const plan = launch();
    const cli = {
      found: plan.command !== null,
      command: plan.command,
      root: plan.root,
      configured: config.cliPath,
      tried: plan.tried.slice(0, 8),
    };
    if (!cli.found) forgetLaunch();

    const auth = cli.found ? await readStatus() : { loggedIn: false, error: "未找到 pippit-tool-cli。", source: "" };
    const cliVersion = cli.found ? await readVersion() : null;
    let creditView = null;
    if (auth.loggedIn) {
      const balance = await readCredit();
      creditView = balance.value === null ? { error: balance.error } : { ...balance.value, error: null };
    }

    const value = {
      cli: { ...cli, version: cliVersion },
      auth,
      credit: creditView,
      login,
      runs: journal.list(20),
      config: {
        cwd: config.cwd,
        teamId: config.teamId,
        downloadDir: resolveDownloadDir(config.downloadDir),
        stateDir: stateDirectory(),
        configuredDownloadDir: config.downloadDir,
      },
      cached: false,
      at: Date.now(),
    };
    snapshotCache = { at: value.at, value };
    return value;
  }

  /** Drop every cached read, e.g. after the row config was edited. */
  function invalidate() {
    snapshotCache = { at: 0, value: null };
    credit.at = 0;
    models.at = 0;
    forgetLaunch();
  }

  return {
    launch,
    forgetLaunch,
    snapshot,
    invalidate,
    readStatus,
    readCredit,
    readModels,
    describeModel,
    modelReport,
    imageRatioCode,
    listSpaces,
    generateImage,
    generateVideo,
    uploadFile,
    queryResult,
    startLogin,
    logout,
    /** Where finished media lands, for the page's "open folder" row. */
    downloadDirectory: () => resolveDownloadDir(config.downloadDir),
    hasCli: () => launch().command !== null,
    journal,
  };
}

/**
 * Everything the plugin can do with the Xiaoyunque CLI, in one place.
 *
 * Two callers reach this module — the Web route behind the Settings page and
 * the agent tools — which is why each operation has exactly one implementation
 * here instead of code in both places.
 */

import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { resolveLaunch, runCli } from "./cli.js";
import { ensureDirectory, resolveDownloadDir, resolveRunDir, sessionDirectory, shortSessionId, stateDirectory } from "./store.js";

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
  summary.ratioDefault = text(model?.ratio?.default);
  if (Array.isArray(model?.resolution?.options)) {
    summary.resolutions = model.resolution.options.map((option) => text(option)).filter((option) => option !== "");
  }
  summary.resolutionDefault = text(model?.resolution?.default);
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
  if (summary.ratios.length > 0) lines.push(`--ratio: ${summary.ratios.join(", ")}${summary.ratioDefault !== "" ? `（默认 ${summary.ratioDefault}）` : ""}`);
  if (summary.resolutions.length > 0) lines.push(`--resolution: ${summary.resolutions.join(", ")}${summary.resolutionDefault !== "" ? `（默认 ${summary.resolutionDefault}）` : ""}`);
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
  /** model key → distilled video spec, so a submit does not re-describe every time. */
  const videoSpecs = new Map();
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

  /** A video model's parameter table, cached for the catalog TTL. */
  async function videoSpec(model) {
    const cached = videoSpecs.get(model);
    if (cached !== undefined && Date.now() - cached.at < MODEL_TTL) return cached.summary;
    const described = await describeModel(model, "video");
    const summary = described.ok && described.summary !== null ? described.summary : null;
    videoSpecs.set(model, { at: Date.now(), summary });
    return summary;
  }

  /**
   * Fill the values `generate-video` insists on, checked against the model itself.
   *
   * The service rejects a request that omits `model`, `ratio`, `duration_sec` or
   * `resolution`, and the CLI substitutes nothing, so every submit needs all four.
   * The accepted set differs per model — `wan3.0` has no 21:9, `happyhorse-1.1` has
   * no adaptive, the mini models expose no resolution at all — which is why the
   * defaults and the range come from the model rather than a fixed list.
   *
   * The check has to happen here: the CLI posts the task before the service
   * validates the ratio, so a bad value costs a run and a log line instead of an
   * error. `视频比例参数不符合模型规范` is what a caller would otherwise see.
   */
  async function videoPlan(args) {
    const model = text(args?.model);
    if (model === "") return { error: "缺少 --model：请先用 xyq_models 查出视频模型 key。" };
    const spec = await videoSpec(model);
    if (spec === null) return { error: `没有读到模型 ${model} 的参数：请先用 xyq_models 确认它是视频模型 key。` };

    const ratio = text(args?.ratio) || spec.ratioDefault;
    if (ratio === "") return { error: "缺少 --ratio：该模型没有默认比例，请从 xyq_models 的模型参数里选一个。" };
    if (spec.ratios.length > 0 && !spec.ratios.includes(ratio)) {
      return { error: `--ratio ${ratio} 不被 ${spec.name} 接受，可选：${spec.ratios.join(", ")}。` };
    }

    const resolution = text(args?.resolution) || spec.resolutionDefault;
    if (resolution !== "" && spec.resolutions.length > 0 && !spec.resolutions.includes(resolution)) {
      return { error: `--resolution ${resolution} 不被 ${spec.name} 接受，可选：${spec.resolutions.join(", ")}。` };
    }

    const asked = Number(args?.duration);
    const hasAsked = Number.isFinite(asked) && asked > 0;
    const duration = hasAsked ? Math.round(asked) : (spec.duration?.default ?? null);
    if (duration === null) return { error: "缺少 --duration：该模型没有默认时长，请给一个秒数。" };
    const low = spec.duration?.min ?? null;
    const high = spec.duration?.max ?? null;
    if ((low !== null && duration < low) || (high !== null && duration > high)) {
      return { error: `--duration ${duration} 超出 ${spec.name} 的范围（${low ?? "?"}-${high ?? "?"} 秒）。` };
    }

    return { model, ratio, resolution, duration, spec };
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

  /**
   * Record a submitted run and return it.
   *
   * The folder is decided here, not at query time, because the two callers know
   * different things: a tool always knows the session behind the call, while the
   * Web route has no agent at all. Storing the decision on the run lets a later
   * poll from either caller land in the same folder.
   *
   * The folder belongs to the conversation, not to the run: four images from one
   * conversation land side by side, and a conversation that generated nothing
   * never gets a folder at all.
   */
  function record(kind, payload, prompt, model, context = {}, extra = {}) {
    const runId = text(payload?.run_id);
    const threadId = text(payload?.thread_id);
    if (runId === "" && threadId === "") return null;
    const workspace = text(context?.workspace);
    const sessionId = text(context?.sessionId);
    const folder = shortSessionId(sessionId);
    const placed = workspace !== "" && folder !== "" ? sessionDirectory(workspace, folder) : "";
    return journal.add({
      runId,
      threadId,
      kind,
      prompt,
      model,
      webThreadLink: text(payload?.web_thread_link),
      status: "submitted",
      createdAt: Date.now(),
      workspace,
      sessionId,
      dir: placed,
      video: text(extra?.video),
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

  /** `generate-image`. `context` decides where the media will land. */
  async function generateImage(args, context = {}) {
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
    const run = record("image", result.json, prompt, model, context);
    return { ok: true, error: null, data: result.json, run };
  }

  /** `generate-video`. `context` decides where the media will land. */
  async function generateVideo(args, context = {}) {
    const prompt = text(args?.prompt);
    const draftTaskId = text(args?.draftTaskId);
    if (prompt === "" && draftTaskId === "") {
      return { ok: false, error: "缺少 --prompt：请描述要生成的视频内容。" };
    }

    const plan = await videoPlan(args);
    if (plan.error !== undefined) return { ok: false, error: plan.error };

    const argv = ["generate-video"];
    if (prompt !== "") argv.push("--prompt", prompt);
    argv.push("--model", plan.model, "--ratio", plan.ratio, "--duration", String(plan.duration));
    if (plan.resolution !== "") argv.push("--resolution", plan.resolution);
    const taskType = text(args?.taskType);
    if (taskType !== "") argv.push("--task-type", taskType);
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
    const run = record("video", result.json, prompt, plan.model, context, {
      video: `${plan.model} · ${plan.ratio} · ${plan.resolution === "" ? "默认清晰度" : plan.resolution} · ${plan.duration}s`,
    });
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
  async function queryResult(args, context = {}) {
    let runId = text(args?.runId);
    let threadId = text(args?.threadId);
    let known = null;
    if (runId === "" || threadId === "") {
      known = journal.list(200).find((run) => (runId !== "" ? run.runId === runId : run.threadId === threadId)) ?? null;
      if (known) {
        if (runId === "") runId = text(known.runId);
        if (threadId === "") threadId = text(known.threadId);
      }
    } else {
      known = journal.list(200).find((run) => (run.runId === runId && run.runId !== "") || (run.threadId === threadId && run.threadId !== "")) ?? null;
    }
    if (runId === "" && threadId === "") return { ok: false, error: "请给出 runId 或 threadId。" };
    if (runId === "" || threadId === "") {
      return { ok: false, error: `查询需要 run_id 与 thread_id 两个参数，只找到 ${runId === "" ? "--thread-id" : "--run-id"}：请把另一个也传进来。` };
    }
    const directory = resolveRunDir({
      dir: args?.dir,
      recorded: known?.dir,
      workspace: text(context?.workspace),
      sessionId: text(context?.sessionId),
      fallback: resolveDownloadDir(config.downloadDir),
    });
    const argv = ["query-result", "--run-id", runId, "--thread-id", threadId];
    /* The CLI treats this flag as mandatory: without it the answer degrades to
       `status:"unknown"` with a `缺少必填参数 --download-dir` note, which reads like
       a failed task. So the folder is always passed, never optional. */
    const ready = ensureDirectory(directory);
    if (ready === null) return { ok: false, error: `无法创建产物目录：${directory}` };
    argv.push("--download-dir", ready);
    const result = await call(argv, QUERY_TIMEOUT);
    const parsed = readQuery(result.json);
    const failed = parsed === null;
    const status = parsed === null ? "" : parsed.status !== "" ? parsed.status : parsed.completed ? "completed" : "unknown";
    /* A run recorded before the folder was decided gets it here, so the next poll
       — from either caller — goes to the same place. */
    const patch = { status };
    if (parsed !== null) patch.note = parsed.errorMessage;
    if (known?.dir !== directory && text(args?.dir) === "") patch.dir = directory;
    if (parsed !== null || known?.dir !== directory) journal.patch(runId, threadId, patch);
    return {
      ok: !failed,
      error: failed ? result.error : null,
      result: parsed,
      raw: result.json,
      downloadDir: directory,
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
   * handing a path to the OS
   * ---------------------------------------------------------------- */

  /**
   * Ask the desktop to show one path.
   *
   * The Host half may only use Node built-ins, and the Electron shell exposes no
   * `shell.openPath` to a bundle, so this spawns the platform's own opener. It is
   * detached and unref'd: a missing file manager, a slow one, or a closed window
   * must never keep the plugin's process alive. Returns whether the opener was
   * started, not whether a window appeared — only the user can tell that.
   */
  function reveal(path) {
    const plan =
      process.platform === "darwin"
        ? { command: "open", argv: [path] }
        : process.platform === "win32"
          ? { command: "explorer", argv: [path] }
          : { command: "xdg-open", argv: [path] };
    try {
      const child = spawn(plan.command, plan.argv, { detached: true, stdio: "ignore", windowsHide: true });
      /* An unhandled 'error' event would take the whole Host down. */
      child.on("error", () => {});
      child.unref();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Every folder a finished file may live in: the shared download folder, the
   * configured one, and each conversation's own folder. `open-file` is reachable
   * from the page, so the guard is a whitelist of folders this plugin itself
   * writes to — never "any path the page names".
   */
  function allowedRoots() {
    const roots = new Set();
    const add = (value) => {
      const path = text(value);
      if (path !== "") roots.add(resolve(path));
    };
    add(resolveDownloadDir(config.downloadDir));
    add(resolveDownloadDir(""));
    add(join(stateDirectory(), "downloads"));
    for (const run of journal.list(200)) {
      add(run.dir);
      if (text(run.workspace) !== "") add(join(resolve(text(run.workspace)), ".xyq"));
    }
    return [...roots];
  }

  /** Open one folder the plugin owns, creating it first so the window has a target. */
  function openDownloadDirectory(requested) {
    const wanted = text(requested);
    let directory;
    if (wanted === "") {
      directory = resolveDownloadDir(config.downloadDir);
    } else {
      /* Only a folder this plugin would have written to: the route is browser-side. */
      const absolute = resolve(wanted);
      const allowed = allowedRoots().some((root) => {
        const rel = relative(root, absolute);
        return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
      });
      if (!allowed) {
        return { ok: false, opened: false, path: absolute, error: "只能打开小云雀自己的目录。" };
      }
      directory = absolute;
    }
    const created = ensureDirectory(directory) ?? directory;
    const opened = reveal(created);
    return {
      ok: opened,
      opened,
      path: created,
      error: opened ? null : `无法打开 ${created}：这台机器上没有找到可用的文件管理器。`,
    };
  }

  /**
   * Open one finished file. Only paths inside a folder this plugin writes to are
   * accepted: the action route is reachable from the page, and a general
   * "open any path" primitive is not something a status panel needs.
   */
  function openResultFile(rawPath) {
    const wanted = text(rawPath);
    if (wanted === "") return { ok: false, opened: false, path: "", error: "缺少要打开的文件路径。" };
    const absolute = resolve(wanted);
    const inside = allowedRoots().some((root) => {
      const rel = relative(root, absolute);
      return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
    });
    if (!inside) return { ok: false, opened: false, path: absolute, error: "只能打开小云雀生成的产物文件。" };
    let regular = false;
    try {
      regular = existsSync(absolute) && statSync(absolute).isFile();
    } catch {
      regular = false;
    }
    if (!regular) return { ok: false, opened: false, path: absolute, error: "文件还不存在，可能已经移动或删除。" };
    const opened = reveal(absolute);
    return { ok: opened, opened, path: absolute, error: opened ? null : "这台机器上没有找到可用的文件管理器。" };
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
        /*
         * Two different answers, because they mean different things now: a run
         * submitted from a conversation lands in that conversation's folder beside
         * the work, while `downloadDir` is only the shared folder that old runs and
         * agent-less callers fall back to.
         */
        downloadDir: resolveDownloadDir(config.downloadDir),
        taskDirRule: "<workspace>/.xyq/<session id>",
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
    openDownloadDirectory,
    openResultFile,
    hasCli: () => launch().command !== null,
    journal,
  };
}

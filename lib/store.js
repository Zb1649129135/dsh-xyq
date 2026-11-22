/**
 * Local state: paths, the run journal, and small file helpers.
 *
 * The journal is what lets the panel show "what did I generate" after a
 * restart: the CLI reports runs by id only, so the plugin remembers the ids it
 * submitted and the query-result call fills in the rest.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { dshHome } from "./cli.js";

/** How many runs the journal keeps. */
const JOURNAL_LIMIT = 60;

/** `<DSH home>/xyq` — everything this plugin writes lives below it. */
export function stateDirectory() {
  return join(dshHome(), "xyq");
}

/** Resolve the download directory: configured value, else the state directory. */
export function resolveDownloadDir(configured) {
  const value = typeof configured === "string" ? configured.trim() : "";
  if (value === "") return join(stateDirectory(), "downloads");
  return resolve(value);
}

/**
 * A short, filesystem-safe stem for one run.
 *
 * The CLI mints ids like `skill_f6a39b92-29f2-41bc-bcc4-2fbcf2655e89`. The whole
 * id is 41 characters of noise in a path; the first uuid group is enough to tell
 * two runs apart by eye and still unique in practice.
 */
export function shortRunId(...ids) {
  for (const value of ids) {
    const candidate = typeof value === "string" ? value.trim() : "";
    if (candidate === "") continue;
    /* `skill_f6a39b92-…` → `f6a39b92`; a bare id keeps its first segment. */
    const stripped = candidate.replace(/^[A-Za-z]+[_-](?=[0-9a-f]{8})/, "");
    const safe = (stripped.split("-")[0] ?? "").replace(/[^A-Za-z0-9]/g, "");
    if (safe !== "") return safe.slice(0, 16).toLowerCase();
  }
  return "";
}

/** `<workspace>/.xyq/<short id>` — one folder per run, next to the work it serves. */
export function taskDirectory(workspace, id) {
  return join(resolve(workspace), ".xyq", id);
}

/**
 * Where one run's media goes.
 *
 * Precedence: an explicit override, then the directory recorded when the run was
 * submitted, then the workspace of whoever is asking now, then the shared
 * fallback. Returns "" when nothing applies, which lets a caller record "not
 * decided" rather than guessing a path at submit time.
 */
export function resolveRunDir(options) {
  const value = (candidate) => (typeof candidate === "string" ? candidate.trim() : "");

  const explicit = value(options?.dir);
  if (explicit !== "") return resolve(explicit);

  const recorded = value(options?.recorded);
  if (recorded !== "") return resolve(recorded);

  const workspace = value(options?.workspace);
  const id = shortRunId(options?.runId, options?.threadId);
  if (workspace !== "" && id !== "") return taskDirectory(workspace, id);

  const fallback = value(options?.fallback);
  return fallback === "" ? "" : resolve(fallback);
}

/** Read JSON from disk, returning `fallback` for a missing or broken file. */
export function readJsonFile(path, fallback) {
  try {
    if (!existsSync(path)) return fallback;
    const text = readFileSync(path, "utf8");
    if (text.trim() === "") return fallback;
    const parsed = JSON.parse(text);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
}

/** Write JSON atomically (temp file + rename). Returns true on success. */
export function writeJsonFile(path, value) {
  try {
    const directory = dirname(path);
    if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    renameSync(temp, path);
    return true;
  } catch {
    return false;
  }
}

/** Ensure a directory exists; returns it, or null when it cannot be created. */
export function ensureDirectory(path) {
  try {
    if (!existsSync(path)) mkdirSync(path, { recursive: true });
    return path;
  } catch {
    return null;
  }
}

/** Normalise one journal record, dropping anything unusable. */
function normaliseRun(record) {
  if (record === null || typeof record !== "object") return null;
  const runId = typeof record.runId === "string" ? record.runId.trim() : "";
  const threadId = typeof record.threadId === "string" ? record.threadId.trim() : "";
  if (runId === "" && threadId === "") return null;
  return {
    runId,
    threadId,
    kind: record.kind === "video" ? "video" : "image",
    prompt: typeof record.prompt === "string" ? record.prompt.slice(0, 400) : "",
    model: typeof record.model === "string" ? record.model : "",
    createdAt: Number.isFinite(record.createdAt) ? record.createdAt : Date.now(),
    webThreadLink: typeof record.webThreadLink === "string" ? record.webThreadLink : "",
    status: typeof record.status === "string" ? record.status : "",
    note: typeof record.note === "string" ? record.note : "",
    /*
     * The workspace the run was submitted from, and the folder its media goes to.
     * Runs recorded before this field existed keep "" — they are not migrated, so
     * an old run keeps landing in the shared folder it always used.
     */
    workspace: typeof record.workspace === "string" ? record.workspace : "",
    dir: typeof record.dir === "string" ? record.dir : "",
  };
}

/**
 * The run journal. Reads on construction, writes on every mutation; a failed
 * write only costs persistence, never the in-memory list.
 *
 * `list` re-reads the file when its stamp changed. A DSH reload can leave an
 * older fiber's route handler in place while the tools run in a newer one, so the
 * in-memory copy alone would show one caller a journal that another already
 * advanced. The file is the shared truth and it is tiny.
 */
export class RunJournal {
  #file;
  #runs;
  #stamp;

  constructor(directory) {
    this.#file = join(directory, "runs.json");
    this.#runs = this.#read();
    this.#stamp = this.#fileStamp();
  }

  #fileStamp() {
    try {
      const stat = statSync(this.#file);
      return `${stat.mtimeMs}:${stat.size}`;
    } catch {
      return "";
    }
  }

  #read() {
    const stored = readJsonFile(this.#file, null);
    const list = Array.isArray(stored?.runs) ? stored.runs : [];
    return list.map(normaliseRun).filter((item) => item !== null);
  }

  /** Pick up a write made by another instance, when one happened. */
  #sync() {
    const stamp = this.#fileStamp();
    if (stamp === this.#stamp) return;
    this.#stamp = stamp;
    this.#runs = this.#read();
  }

  /** Newest first. */
  list(limit = JOURNAL_LIMIT) {
    this.#sync();
    return this.#runs.slice(0, Math.max(1, limit));
  }

  /** Record a submitted run; newest first, deduplicated by run id. */
  add(record) {
    const normalised = normaliseRun(record);
    if (normalised === null) return null;
    this.#runs = [
      normalised,
      ...this.#runs.filter(
        (item) => !(item.runId === normalised.runId && item.runId !== "") && !(item.threadId === normalised.threadId && item.threadId !== ""),
      ),
    ].slice(0, JOURNAL_LIMIT);
    this.#persist();
    return normalised;
  }

  /** Merge a query-result outcome into an existing run. */
  patch(runId, threadId, changes) {
    this.#sync();
    let touched = null;
    this.#runs = this.#runs.map((item) => {
      const match = (runId !== "" && item.runId === runId) || (threadId !== "" && item.threadId === threadId);
      if (!match) return item;
      touched = { ...item, ...changes };
      return touched;
    });
    if (touched !== null) this.#persist();
    return touched;
  }

  /** Drop one run. */
  remove(runId, threadId) {
    const before = this.#runs.length;
    this.#runs = this.#runs.filter(
      (item) => !((runId !== "" && item.runId === runId) || (threadId !== "" && item.threadId === threadId)),
    );
    if (this.#runs.length !== before) this.#persist();
    return before !== this.#runs.length;
  }

  #persist() {
    writeJsonFile(this.#file, { version: 1, runs: this.#runs });
    this.#stamp = this.#fileStamp();
  }
}

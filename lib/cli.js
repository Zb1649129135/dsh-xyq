/**
 * Xiaoyunque CLI discovery and execution.
 *
 * Every call shells out to the `pippit-tool-cli` binary installed by
 * @pippit-dev/cli. Nothing here imports a DSH package: the Host half of a
 * third-party bundle may only use Node built-ins.
 */

import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";

/** npm package that ships the native binary. */
const CLI_PACKAGE = "@pippit-dev/cli";
/** Native executable name; the npm wrapper drops the extension on POSIX. */
const CLI_EXE = process.platform === "win32" ? "pippit-tool-cli.exe" : "pippit-tool-cli";
/** Guard against a runaway child filling memory. */
const MAX_CAPTURE = 8 * 1024 * 1024;

/** The DSH home directory, matching every other plugin's resolution order. */
export function dshHome() {
  const fromEnv = process.env.DSH_HOME;
  if (typeof fromEnv === "string" && fromEnv.trim() !== "") return fromEnv.trim();
  return join(homedir(), ".dsh");
}

/** True when `candidate` is an existing regular file. */
function isFile(candidate) {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/** Collect unique, non-empty candidate paths. */
function collector() {
  const list = [];
  return {
    add(value) {
      if (typeof value !== "string") return;
      const trimmed = value.trim();
      if (trimmed === "" || list.includes(trimmed)) return;
      list.push(trimmed);
    },
    list,
  };
}

/**
 * Places a `@pippit-dev/cli` package (or its launcher) may live, most specific
 * first: the configured path, then every PATH entry, then the Node install the
 * Host itself runs on, then the npm global prefixes.
 */
function candidateRoots(cliPath) {
  const { add, list } = collector();
  if (typeof cliPath === "string" && cliPath.trim() !== "") {
    add(cliPath);
    add(join(cliPath, "node_modules", CLI_PACKAGE));
    add(join(cliPath, "..", "node_modules", CLI_PACKAGE));
  }
  for (const entry of String(process.env.PATH ?? "").split(delimiter)) {
    if (entry.trim() === "") continue;
    add(join(entry, "node_modules", CLI_PACKAGE));
    add(join(entry, "..", "lib", "node_modules", CLI_PACKAGE));
  }
  const nodeDir = dirname(process.execPath);
  add(join(nodeDir, "node_modules", CLI_PACKAGE));
  add(join(nodeDir, "..", "lib", "node_modules", CLI_PACKAGE));
  add(join(nodeDir, "..", "node_modules", CLI_PACKAGE));
  const appData = process.env.APPDATA;
  if (typeof appData === "string" && appData.trim() !== "") {
    add(join(appData, "npm", "node_modules", CLI_PACKAGE));
  }
  add(join(homedir(), "AppData", "Roaming", "npm", "node_modules", CLI_PACKAGE));
  add(join(homedir(), ".npm-global", "lib", "node_modules", CLI_PACKAGE));
  return list;
}

/**
 * Resolve how to invoke the CLI.
 *
 * Priority: the native binary (avoids a Node bootstrap per call), then the npm
 * launcher script run through this process's own Node, then an executable the
 * caller pointed at directly.
 *
 * @returns {{ command: string|null, prefixArgs: string[], root: string|null, tried: string[] }}
 */
export function resolveLaunch(cliPath) {
  const configured = typeof cliPath === "string" ? cliPath.trim() : "";
  if (configured !== "") {
    if (/\.js$/i.test(configured) && isFile(configured)) {
      return { command: process.execPath, prefixArgs: [configured], root: dirname(configured), tried: [configured] };
    }
    if (/\.(cmd|bat)$/i.test(configured)) {
      const runner = join(dirname(configured), "node_modules", CLI_PACKAGE, "scripts", "run.js");
      if (isFile(runner)) {
        return { command: process.execPath, prefixArgs: [runner], root: dirname(runner), tried: [configured, runner] };
      }
    }
    if (isFile(configured)) {
      return { command: configured, prefixArgs: [], root: dirname(configured), tried: [configured] };
    }
  }

  const tried = [];
  for (const root of candidateRoots(configured)) {
    tried.push(root);
    const exe = join(root, "bin", CLI_EXE);
    if (isFile(exe)) return { command: exe, prefixArgs: [], root, tried };
    const runner = join(root, "scripts", "run.js");
    if (isFile(runner)) {
      return { command: process.execPath, prefixArgs: [runner], root, tried };
    }
    if (isFile(join(root, CLI_EXE))) {
      return { command: join(root, CLI_EXE), prefixArgs: [], root, tried };
    }
    const sibling = join(root, "..", "scripts", "run.js");
    if (isFile(sibling)) {
      return { command: process.execPath, prefixArgs: [sibling], root: dirname(sibling), tried };
    }
  }
  return { command: null, prefixArgs: [], root: null, tried };
}

/** Environment every child gets: quiet, machine-readable, no update prompts. */
function childEnv(extra) {
  const base = {
    ...process.env,
    PIPPIT_CLI_UPDATE_CHECKED: "1",
    PIPPIT_CLI_DISABLE_UPDATE_CHECK: "1",
    NO_COLOR: "1",
    FORCE_COLOR: "0",
  };
  delete base.PIPPIT_CLI_CANVAS_TRANSPORT;
  delete base.PIPPIT_CLI_CANVAS_SEMANTIC_COMMAND;
  return extra === undefined ? base : { ...base, ...extra };
}

/** Parse the CLI's JSON stdout, tolerating a trailing notice line. */
export function parseJson(text) {
  const raw = typeof text === "string" ? text.trim() : "";
  if (raw === "") return null;
  try {
    return JSON.parse(raw);
  } catch {
    /* fall through to the line scan */
  }
  const lines = raw.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (line === "" || (line[0] !== "{" && line[0] !== "[")) continue;
    try {
      return JSON.parse(line);
    } catch {
      /* keep scanning */
    }
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

/** Last meaningful stderr line, cleaned of log prefixes. */
export function errorText(stderr, code) {
  const lines = String(stderr ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (lines.length > 0) {
    const last = lines[lines.length - 1];
    return last.replace(/^(?:Error|error|failed|失败)[:：]\s*/, "");
  }
  return `pippit-tool-cli 退出码 ${String(code)}`;
}

/**
 * Run the CLI once.
 *
 * Never rejects: a missing binary, a timeout, and a non-zero exit all come back
 * as a result object so callers can surface the message instead of crashing.
 *
 * @returns {Promise<{ ok: boolean, code: number|null, stdout: string, stderr: string,
 *   json: unknown, error: string|null, timedOut: boolean, durationMs: number }>}
 */
export function runCli(launch, args, options = {}) {
  const { cwd, timeoutMs = 120000, env } = options;
  const started = Date.now();
  const argv = [...(launch.prefixArgs ?? []), ...args];

  return new Promise((resolvePromise) => {
    if (launch.command === null || launch.command === undefined) {
      resolvePromise({
        ok: false,
        code: null,
        stdout: "",
        stderr: "",
        json: null,
        error: "未找到 pippit-tool-cli：请安装 @pippit-dev/cli，或在插件配置里指定 cliPath。",
        timedOut: false,
        durationMs: 0,
      });
      return;
    }

    let settled = false;
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ ...result, timedOut, durationMs: Date.now() - started });
    };

    let child;
    try {
      child = spawn(launch.command, argv, {
        cwd: typeof cwd === "string" && cwd.trim() !== "" ? cwd : undefined,
        env: childEnv(env),
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolvePromise({
        ok: false,
        code: null,
        stdout: "",
        stderr: "",
        json: null,
        error: `无法启动 pippit-tool-cli：${String(error?.message ?? error)}`,
        timedOut: false,
        durationMs: Date.now() - started,
      });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        /* the process may already be gone */
      }
    }, Math.max(1000, timeoutMs));

    child.stdout?.on("data", (chunk) => {
      if (stdout.length < MAX_CAPTURE) stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      if (stderr.length < MAX_CAPTURE) stderr += String(chunk);
    });
    child.on("error", (error) => {
      finish({
        ok: false,
        code: null,
        stdout,
        stderr,
        json: null,
        error: `无法启动 pippit-tool-cli：${String(error?.message ?? error)}`,
      });
    });
    child.on("close", (code) => {
      const json = parseJson(stdout);
      finish({
        ok: code === 0,
        code,
        stdout,
        stderr,
        json,
        error: code === 0 ? null : errorText(stderr, code),
      });
    });
  });
}

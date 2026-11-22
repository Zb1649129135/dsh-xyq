/**
 * Render smoke test for the client bundle.
 *
 * The bundle needs `window.__ModuleLoader__` and `react`, neither of which
 * exists outside the DSH page. This harness stands in for both: a recorder
 * `createElement` plus a hook implementation that runs effects synchronously, so
 * a render-time mistake (an undefined local, a bad prop access) surfaces here
 * instead of as a blank settings page.
 *
 * Run with `node scripts/client-render.mjs`.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "lib", "client.js"), "utf8");

/* ---------------------------------------------------------------- *
 * a very small React
 * ---------------------------------------------------------------- */

/** Element records; `type` is either a string tag or a component function. */
function createElement(type, props, ...children) {
  return { type, props: props ?? {}, children: children.flat() };
}

/** Hook state, replayed from the top on every render. */
const hooks = [];
let cursor = 0;
let pendingEffects = [];

function useState(initial) {
  const index = cursor++;
  if (!(index in hooks)) hooks[index] = { value: typeof initial === "function" ? initial() : initial };
  const slot = hooks[index];
  return [slot.value, (next) => {
    slot.value = typeof next === "function" ? next(slot.value) : next;
  }];
}

function useRef(initial) {
  const index = cursor++;
  if (!(index in hooks)) hooks[index] = { current: initial };
  return hooks[index];
}

function useCallback(fn) {
  cursor += 1;
  return fn;
}

function useEffect(fn) {
  cursor += 1;
  pendingEffects.push(fn);
}

const React = { createElement, useState, useRef, useCallback, useEffect };

/* ---------------------------------------------------------------- *
 * the page stand-in
 * ---------------------------------------------------------------- */

const elements = new Map();

function makeElement(id) {
  const element = { id, textContent: "", children: [], appendChild(child) { this.children.push(child); } };
  elements.set(id, element);
  return element;
}

const document = {
  baseURI: "http://127.0.0.1:54806/",
  head: { appendChild(element) { elements.set(element.id, element); } },
  getElementById(id) {
    return elements.get(id) ?? null;
  },
  createElement(tag) {
    return { tag, id: "", textContent: "" };
  },
  body: {},
};

/** Requests the page makes; collected so the test can assert on them. */
const requests = [];
/** Per-action replies for POST, so a scenario can drive one path (e.g. `query`). */
const postReplies = new Map();
function fetch(url, init) {
  requests.push({ url, init });
  let body;
  if (init && init.method === "POST") {
    const action = (() => {
      try {
        return JSON.parse(init.body).action;
      } catch {
        return "";
      }
    })();
    body = postReplies.get(action) ?? { ok: true, state: null, models: [], result: null };
  } else {
    body = {
      cli: { found: true, command: "D:\\app\\nvm\\nodejs\\node_modules\\@pippit-dev\\cli\\bin\\pippit-tool-cli.exe", version: "1.0.57", tried: [] },
      auth: { loggedIn: true, uid: "12345", expiresAt: "2026-12-01T00:00:00Z", error: null },
      credit: { totalRemain: "1200", logId: "", error: null },
      login: { running: false },
      runs: [
        {
          runId: "r1",
          threadId: "t1",
          kind: "image",
          prompt: "一只在雨里走路的小鸟",
          status: "succeeded",
          webThreadLink: "https://xyq.jianying.com/thread/t1",
          createdAt: Date.now(),
        },
      ],
      config: {
        downloadDir: "C:\\Users\\Administrator\\.dsh\\xyq\\downloads",
        stateDir: "C:\\Users\\Administrator\\.dsh\\xyq",
        teamId: "",
        cwd: "",
      },
    };
  }
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  });
}

const window = {
  __ModuleLoader__: {
    load(definition) {
      window.__definition = definition;
    },
  },
  addEventListener() {},
  removeEventListener() {},
};

const navigator = { language: "zh-CN" };

/* ---------------------------------------------------------------- *
 * run the bundle
 * ---------------------------------------------------------------- */

const sandbox = { window, document, navigator, fetch, console, setInterval: () => 0, clearInterval: () => {}, URL, JSON, setTimeout: () => 0, clearTimeout: () => {}, Object, Array, String, Math, Number, Date };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: "client.js" });

const definition = window.__definition;
if (!definition || typeof definition.factory !== "function") {
  console.log("!! the bundle did not register a factory");
  process.exit(1);
}

const registered = [];
const moduleExports = definition.factory((name) => {
  if (name === "react") return React;
  throw new Error(`unexpected require("${name}")`);
});

const ctx = {
  slots: {
    inject(name, callback) {
      callback();
      return () => {};
    },
    register(options, component) {
      registered.push({ options, component });
      return () => {};
    },
  },
  get() {
    return null;
  },
};

console.log("bundle");
console.log("  id:", definition.id);
console.log("  exports:", Object.keys(moduleExports).join(", "));
moduleExports.apply(ctx);
console.log("  registrations:", registered.map((item) => `${item.options.name}#${item.options.id ?? item.options.key}`).join(", "));
console.log("  styles:", elements.has("dsh-xyq-styles") ? `${elements.get("dsh-xyq-styles").textContent.length} bytes` : "MISSING");

/* ---------------------------------------------------------------- *
 * render every registered component
 * ---------------------------------------------------------------- */

function render(component, props) {
  cursor = 0;
  pendingEffects = [];
  const tree = component(props ?? {});
  return { tree, effects: pendingEffects.slice() };
}

/** Count and exercise every node, including nested components. */
function walk(node, depth = 0) {
  if (node === null || node === undefined || node === false || node === true) return 0;
  if (Array.isArray(node)) return node.reduce((sum, item) => sum + walk(item, depth), 0);
  if (typeof node !== "object") return 1;
  if (typeof node.type === "function") {
    const nested = render(node.type, node.props ?? {});
    let count = walk(nested.tree, depth + 1);
    for (const effect of nested.effects) runEffect(effect);
    return count;
  }
  let count = 1;
  for (const child of node.children ?? []) count += walk(child, depth);
  for (const child of node.props?.children === undefined ? [] : [].concat(node.props.children)) count += walk(child, depth);
  return count;
}

/** Collect effect cleanups so the harness leaves nothing running. */
const cleanups = [];
function runEffect(effect) {
  try {
    const cleanup = effect();
    if (typeof cleanup === "function") cleanups.push(cleanup);
  } catch (error) {
    failures += 1;
    console.log(`  !! an effect threw: ${String(error && error.message ? error.message : error)}`);
  }
}

let failures = 0;
const rendered = [];
for (const entry of registered) {
  const label = `${entry.options.name}#${entry.options.id ?? ""}`;
  try {
    const isComposer = String(entry.options.name).indexOf("composer") >= 0;
    const mounted = render(entry.component, isComposer ? { sessionId: "s1" } : { close() {} });
    const first = walk(mounted.tree);
    for (const effect of mounted.effects) runEffect(effect);
    rendered.push({ entry, label, isComposer, first });
    console.log(`  mounted ${label}: ${first} node(s) (loading state)`);
  } catch (error) {
    failures += 1;
    console.log(`  !! ${label} threw: ${String(error && error.stack ? error.stack.split("\n")[0] : error)}`);
  }
}

/* ---------------------------------------------------------------- *
 * let the fetches settle, then re-render with the real state
 * ---------------------------------------------------------------- */

await new Promise((resolve) => setTimeout(resolve, 10));

for (const item of rendered) {
  try {
    const mounted = render(item.entry.component, item.isComposer ? { sessionId: "s1" } : { close() {} });
    const nodes = walk(mounted.tree);
    // Find the text the page produced so a wrong branch is visible.
    const texts = [];
    const collect = (node) => {
      if (node === null || node === undefined || node === false) return;
      if (Array.isArray(node)) return node.forEach(collect);
      if (typeof node !== "object") {
        const value = String(node).trim();
        if (value !== "" && value.length < 60) texts.push(value);
        return;
      }
      if (typeof node.type === "function") return;
      (node.children ?? []).forEach(collect);
    };
    collect(mounted.tree);
    console.log(`  re-rendered ${item.label}: ${nodes} node(s)`);
    if (!item.isComposer) console.log(`    text: ${texts.slice(0, 14).join(" · ")}`);
    else console.log(`    text: ${texts.join(" · ")}`);
  } catch (error) {
    failures += 1;
    console.log(`  !! ${item.label} threw on re-render: ${String(error && error.stack ? error.stack.split("\n")[0] : error)}`);
  }
}

/* ---------------------------------------------------------------- *
 * scenario: press Check and read the result card
 * ---------------------------------------------------------------- */

/**
 * The empty/loaded render above cannot reach the Check path, which is the one
 * place the page reports progress and hands back files. This drives it: click the
 * run's button, let the stubbed `query` reply land, then read the new text.
 */
function buttonsIn(tree) {
  const found = [];
  const visit = (node) => {
    if (node === null || node === undefined || node === false) return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (typeof node !== "object") return;
    /* `Button` is a component, so the real <button> is one level below it. The
       harness keeps children out of props, so hand them over the way React does. */
    if (typeof node.type === "function") {
      return visit(node.type({ ...(node.props ?? {}), children: node.children ?? [] }));
    }
    if (node.type === "button") {
      const label = [];
      const collect = (child) => {
        if (child === null || child === undefined || child === false) return;
        if (Array.isArray(child)) return child.forEach(collect);
        if (typeof child === "object") return (child.children ?? []).forEach(collect);
        label.push(String(child));
      };
      collect(node.children ?? []);
      found.push({ label: label.join(""), node });
    }
    (node.children ?? []).forEach(visit);
  };
  visit(tree);
  return found;
}

const settingsEntry = registered.find((item) => item.options.name === "settings.section");
if (settingsEntry === undefined) {
  failures += 1;
  console.log("  !! the settings seat was not registered, the Check scenario cannot run");
} else {
  postReplies.set("query", {
    ok: true,
    result: {
      status: "succeeded",
      completed: true,
      errorMessage: null,
      images: [{ url: "https://example.invalid/a.png", path: "C:\\Users\\Administrator\\.dsh\\xyq\\downloads\\a.png" }],
      videos: [
        { url: "https://example.invalid/b.mp4", path: "C:\\Users\\Administrator\\.dsh\\xyq\\downloads\\b.mp4", draft: true },
      ],
    },
    /* The Host decides the landing folder; the page only echoes it. */
    downloadDir: "D:\\work\\proj\\.xyq\\4a1b2c3d",
    state: null,
  });
  const scenario = render(settingsEntry.component, { close() {} });
  walk(scenario.tree);
  for (const effect of scenario.effects) runEffect(effect);
  const check = buttonsIn(scenario.tree).find((item) => item.label === "查询" || item.label === "Check");
  if (check === undefined) {
    failures += 1;
    console.log("  !! no Check button on the run row");
  } else {
    check.node.props.onClick();
    const afterClick = render(settingsEntry.component, { close() {} });
    const pending = [];
    const collect = (node) => {
      if (node === null || node === undefined || node === false) return;
      if (Array.isArray(node)) return node.forEach(collect);
      if (typeof node !== "object") {
        const value = String(node).trim();
        if (value !== "") pending.push(value);
        return;
      }
      if (typeof node.type === "function") return;
      (node.children ?? []).forEach(collect);
    };
    collect(afterClick.tree);
    console.log(`  check in flight: ${pending.filter((line) => line.length < 60).slice(-3).join(" · ")}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const settled = render(settingsEntry.component, { close() {} });
    walk(settled.tree);
    const texts = [];
    const gather = (node, depth = 0) => {
      if (node === null || node === undefined || node === false) return;
      if (Array.isArray(node)) return node.forEach((child) => gather(child, depth));
      if (typeof node !== "object") {
        const value = String(node).trim();
        if (value !== "") texts.push(value);
        return;
      }
      /* `Row` and `Button` are components: their labels and values only exist
         after the call, which is also how the real renderer reaches them. */
      if (typeof node.type === "function" && depth < 8) {
        return gather(node.type({ ...(node.props ?? {}), children: node.children ?? [] }), depth + 1);
      }
      (node.children ?? []).forEach((child) => gather(child, depth));
    };
    gather(settled.tree);
    console.log(`  after check: ${texts.slice(0, 18).join(" · ")}`);
    const card = texts.some((line) => line.indexOf("a.png") >= 0) && texts.some((line) => line.indexOf("b.mp4") >= 0);
    const badge = texts.some((line) => line === "草稿" || line === "draft");
    /* The landing folder comes from the reply, so a page that guessed it from
       config would show the shared folder here instead. */
    const landed = texts.some((line) => line.indexOf(".xyq\\4a1b2c3d") >= 0 || line.indexOf(".xyq/4a1b2c3d") >= 0);
    if (!card) {
      failures += 1;
      console.log("  !! the result card did not list the downloaded files");
    }
    if (!badge) {
      failures += 1;
      console.log("  !! the draft video has no badge");
    }
    if (!landed) {
      failures += 1;
      console.log("  !! the result card did not show the conversation's own folder");
    }
  }
}

for (const cleanup of cleanups) {
  try {
    cleanup();
  } catch {
    /* the harness is done with it */
  }
}

console.log("requests:", requests.length);
console.log("  urls:", requests.map((item) => `${item.init && item.init.method ? item.init.method : "GET"} ${item.url}`).join(" | ") || "(none)");
console.log(failures === 0 ? "PASS" : `FAIL (${failures})`);


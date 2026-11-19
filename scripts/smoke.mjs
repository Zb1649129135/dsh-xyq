/**
 * Local smoke test: exercises the Host half without DSH.
 *
 * Run with `node scripts/smoke.mjs` from the package root. It prints one line
 * per check and never fails the shell, so it is safe to run against a machine
 * where the CLI is missing or the account is signed out.
 */

import { resolveLaunch, runCli, parseJson, errorText, dshHome } from "../lib/cli.js";
import { RunJournal, resolveDownloadDir, stateDirectory } from "../lib/store.js";
import { createOps, normalizeConfig } from "../lib/ops.js";

const ok = (label, value) => console.log(`  ok  ${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const bad = (label, value) => console.log(`  !!  ${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);

console.log("cli");
const plan = resolveLaunch("");
ok("command", plan.command ?? "(none)");
ok("root", plan.root ?? "(none)");
ok("tried", plan.tried.length);
ok("dshHome", dshHome());

console.log("parse");
ok("plain", parseJson('{"a":1}'));
ok("trailing line", parseJson('{"a":1}\n检查更新失败'));
ok("garbage", parseJson("not json"));
ok("errorText", errorText("Error: boom", 1));

console.log("store");
ok("stateDirectory", stateDirectory());
ok("resolveDownloadDir('')", resolveDownloadDir(""));
const journal = new RunJournal(stateDirectory());
ok("journal size", journal.list().length);

console.log("config");
ok("normalizeConfig", normalizeConfig({ stateTtlMs: 1, teamId: " 12 " }));

console.log("ops");
const ops = createOps({ config: normalizeConfig({}), journal, warn: (m) => console.log(`  warn ${m}`) });
ok("hasCli", ops.hasCli());
const status = await ops.readStatus();
ok("status", status);
const snapshot = await ops.snapshot({ force: true });
ok("snapshot.cli", snapshot.cli);
ok("snapshot.auth", snapshot.auth);
ok("snapshot.credit", snapshot.credit);
const version = await ops.launch().command;
if (version !== null) {
  const raw = await runCli(plan, ["--version"], { timeoutMs: 20000 });
  ok("--version", raw.stdout.trim());
  ok("durationMs", raw.durationMs);
} else {
  bad("--version", "no CLI resolved");
}

/*
 * The two shapes the CLI gets wrong in ways that hide behind a green run:
 * image models carry no `key`, and `--ratio` wants an integer code while every
 * listing speaks in labels. Both used to pass silently and return a wrong answer.
 */
console.log("catalog");
const images = await ops.readModels("image", true);
if (images.ok && Array.isArray(images.models) && images.models.length > 0) {
  ok("image models", images.models.length);
  const nameless = images.models.filter((model) => model.key === "");
  nameless.length === 0 ? ok("every image model has a key", nameless.length) : bad("image models without a key", nameless.map((model) => model.name));
  const first = images.models[0];
  const code = await ops.imageRatioCode(first.name, "16:9");
  code === "2" ? ok("ratio 16:9 folds to the code 16:9 maps to", code) : bad("ratio 16:9", code);
  const literal = await ops.imageRatioCode(first.name, "6");
  literal === "6" ? ok("a numeric ratio passes through", literal) : bad("numeric ratio", literal);
  const described = await ops.describeModel(first.name, "image");
  const report = described.summary === null ? "(none)" : ops.modelReport(described.summary);
  ok("description stays small", `${report.length} chars`);
  report.length < 600 ? ok("description fits in a reply", report.length) : bad("description is too long", report.length);
} else {
  bad("image models", images.error ?? "signed out, skipped");
}

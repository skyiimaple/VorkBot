#!/usr/bin/env node
/**
 * Grok ↔ Vork UI/操作一致性静态检查。
 *
 * 用法：
 *   pnpm ui:check
 *   pnpm --filter @vork/desktop ui:parity
 *   node scripts/ui-parity/check.mjs
 *   node scripts/ui-parity/check.mjs --json
 *   node scripts/ui-parity/check.mjs --extract   # 从 Grok 解包目录刷新 token 快照到 stdout
 *
 * 环境变量：
 *   GROK_ASAR          默认 /Applications/Grok Bot.app/Contents/Resources/app.asar
 *   GROK_EXTRACT_DIR   默认 /tmp/grok-bot-asar（已解包优先；否则尝试 npx asar extract）
 *   VORK_ROOT          仓库根（默认脚本上两级）
 *
 * 退出码：
 *   0  无 fail 级失败（warn / manual 不影响）
 *   1  存在 fail 级失败
 *   2  Grok 解包不可用且有依赖 Grok 的检查
 *   64 用法错误
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXIT = Object.freeze({ OK: 0, FAIL: 1, GROK: 2, USAGE: 64 });

const args = new Set(process.argv.slice(2));
if (args.has("--help") || args.has("-h")) {
  console.log(`用法: node scripts/ui-parity/check.mjs [--json] [--extract] [--skip-grok]

对照 Grok Bot asar 与 Vork desktop 源码，输出通过 / 失败 / 需人工项。
详见 scripts/ui-parity/checklist.json`);
  process.exit(EXIT.OK);
}

const wantJson = args.has("--json");
const wantExtract = args.has("--extract");
const skipGrok = args.has("--skip-grok");

const root = process.env.VORK_ROOT
  ? path.resolve(process.env.VORK_ROOT)
  : path.resolve(__dirname, "../..");
const checklistPath = path.join(__dirname, "checklist.json");
const desktopSrc = path.join(root, "apps/desktop/src/renderer/src");
const grokAsar =
  process.env.GROK_ASAR ?? "/Applications/Grok Bot.app/Contents/Resources/app.asar";
const grokExtract =
  process.env.GROK_EXTRACT_DIR ?? "/tmp/grok-bot-asar";

/** @typedef {'pass'|'fail'|'warn'|'manual'|'skip'} Status */

/**
 * @param {string} dir
 * @returns {string[]}
 */
function listFilesRecursive(dir) {
  /** @type {string[]} */
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur) break;
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === "node_modules" || ent.name === ".git") continue;
        stack.push(full);
      } else if (ent.isFile()) {
        out.push(full);
      }
    }
  }
  return out;
}

/**
 * @param {string} extractDir
 * @returns {string}
 */
function loadGrokCorpus(extractDir) {
  const assets = path.join(extractDir, "dist/renderer/assets");
  const files = listFilesRecursive(assets).filter((f) => {
    const base = path.basename(f);
    if (!(base.endsWith(".js") || base.endsWith(".css"))) return false;
    // 跳过超大语法高亮 / mermaid 等，避免无意义扫描
    try {
      return fs.statSync(f).size <= 6_000_000;
    } catch {
      return false;
    }
  });
  /** Prefer index css + agents/shared/chat/core/index bundles */
  const preferred = files.filter((f) => {
    const b = path.basename(f);
    return (
      b.startsWith("index-") ||
      b.includes("chunk-agents") ||
      b.includes("chunk-shared") ||
      b.includes("chunk-chat") ||
      b.includes("chunk-core") ||
      b.endsWith(".css")
    );
  });
  const use = preferred.length > 0 ? preferred : files;
  return use.map((f) => fs.readFileSync(f, "utf8")).join("\n");
}

/**
 * @returns {{ ok: boolean, dir: string, reason?: string }}
 */
function ensureGrokExtract() {
  const marker = path.join(grokExtract, "dist/renderer/assets");
  if (fs.existsSync(marker)) {
    return { ok: true, dir: grokExtract };
  }
  if (!fs.existsSync(grokAsar)) {
    return { ok: false, dir: grokExtract, reason: `找不到 asar: ${grokAsar}` };
  }
  fs.mkdirSync(grokExtract, { recursive: true });
  const r = spawnSync(
    "npx",
    ["--yes", "asar", "extract", grokAsar, grokExtract],
    { encoding: "utf8", cwd: root }
  );
  if (r.status !== 0 || !fs.existsSync(marker)) {
    return {
      ok: false,
      dir: grokExtract,
      reason: `asar extract 失败: ${r.stderr || r.stdout || "unknown"}`
    };
  }
  return { ok: true, dir: grokExtract };
}

/**
 * @param {string[]} relFiles
 * @returns {string}
 */
function loadVorkCorpus(relFiles) {
  return relFiles
    .map((rel) => {
      const full = path.join(desktopSrc, rel);
      if (!fs.existsSync(full)) return `/* MISSING:${rel} */`;
      return fs.readFileSync(full, "utf8");
    })
    .join("\n");
}

/**
 * @param {string} text
 * @param {{ includes?: string[], includesAny?: string[], includesAll?: string[], forbidden?: string[] }} spec
 * @returns {{ ok: boolean, missing: string[], forbiddenHits: string[] }}
 */
function matchSpec(text, spec) {
  /** @type {string[]} */
  const missing = [];
  /** @type {string[]} */
  const forbiddenHits = [];

  const needAll = [...(spec.includes ?? []), ...(spec.includesAll ?? [])];
  for (const s of needAll) {
    if (!text.includes(s)) missing.push(s);
  }
  if (spec.includesAny?.length) {
    if (!spec.includesAny.some((s) => text.includes(s))) {
      missing.push(`anyOf(${spec.includesAny.join(" | ")})`);
    }
  }
  for (const s of spec.forbidden ?? []) {
    if (text.includes(s)) forbiddenHits.push(s);
  }
  return { ok: missing.length === 0 && forbiddenHits.length === 0, missing, forbiddenHits };
}

/**
 * @param {string} corpus
 */
function extractSnapshot(corpus) {
  const tokens = [
    "--cursor-accent:#599CE7",
    "--sand-bg-base:#fcfcfc",
    "--sand-bg-subtle:#f7f7f7",
    "--sand-text-primary:#141414",
    "#14141426",
    "--scrollbar-size:6px",
    "未分组",
    "重命名 Bot",
    "置顶",
    "取消置顶",
    "静音",
    "取消静音",
    "标为未读",
    "标为已读",
    "移至",
    "移至新分组",
    "从侧边栏隐藏",
    "分组操作",
    "重命名分组",
    "新建分组",
    "系统设置",
    "nearBottomThresholdPx"
  ];
  /** @type {Record<string, boolean>} */
  const found = {};
  for (const t of tokens) found[t] = corpus.includes(t);
  return found;
}

function main() {
  const checklist = JSON.parse(fs.readFileSync(checklistPath, "utf8"));

  let grokCorpus = "";
  let grokOk = false;
  /** @type {string | undefined} */
  let grokReason;
  if (!skipGrok) {
    const ensured = ensureGrokExtract();
    grokOk = ensured.ok;
    grokReason = ensured.reason;
    if (ensured.ok) grokCorpus = loadGrokCorpus(ensured.dir);
  } else {
    grokReason = "已 --skip-grok";
  }

  if (wantExtract) {
    if (!grokOk) {
      console.error(`无法提取 Grok 语料: ${grokReason}`);
      process.exit(EXIT.GROK);
    }
    console.log(JSON.stringify(extractSnapshot(grokCorpus), null, 2));
    process.exit(EXIT.OK);
  }

  /** @type {Array<{ id: string, category: string, title: string, status: Status, detail?: string, severity: string }>} */
  const results = [];
  let grokDependentSkipped = false;

  for (const check of checklist.checks) {
    const severity = check.severity ?? "fail";

    if (severity === "manual" || (!check.vork && !check.grok)) {
      results.push({
        id: check.id,
        category: check.category,
        title: check.title,
        status: "manual",
        severity,
        detail: "需人工 / 运行时核实"
      });
      continue;
    }

    /** @type {string[]} */
    const details = [];
    let status = /** @type {Status} */ ("pass");

    if (check.grok) {
      if (!grokOk) {
        status = "skip";
        grokDependentSkipped = true;
        details.push(`Grok 不可用: ${grokReason}`);
      } else {
        const g = matchSpec(grokCorpus, check.grok);
        if (!g.ok) {
          status = severity === "warn" ? "warn" : "fail";
          if (g.missing.length) details.push(`Grok 缺: ${g.missing.join(", ")}`);
          if (g.forbiddenHits.length) details.push(`Grok 禁出现: ${g.forbiddenHits.join(", ")}`);
        }
      }
    }

    if (check.vork && status !== "skip") {
      const files = check.vork.files ?? [];
      const corpus = loadVorkCorpus(files);
      const missingFiles = files.filter((f) => !fs.existsSync(path.join(desktopSrc, f)));
      if (missingFiles.length) {
        status = severity === "warn" ? "warn" : "fail";
        details.push(`Vork 缺文件: ${missingFiles.join(", ")}`);
      } else {
        const v = matchSpec(corpus, check.vork);
        if (!v.ok) {
          status = severity === "warn" ? "warn" : "fail";
          if (v.missing.length) details.push(`Vork 缺: ${v.missing.join(", ")}`);
          if (v.forbiddenHits.length) details.push(`Vork 仍含旧文案: ${v.forbiddenHits.join(", ")}`);
        }
      }
    }

    results.push({
      id: check.id,
      category: check.category,
      title: check.title,
      status,
      severity,
      detail: details.join("; ") || undefined
    });
  }

  const passed = results.filter((r) => r.status === "pass");
  const failed = results.filter((r) => r.status === "fail");
  const warned = results.filter((r) => r.status === "warn");
  const manual = results.filter((r) => r.status === "manual");
  const skipped = results.filter((r) => r.status === "skip");

  const summary = {
    grok: grokOk ? { ok: true, extract: grokExtract } : { ok: false, reason: grokReason },
    counts: {
      pass: passed.length,
      fail: failed.length,
      warn: warned.length,
      manual: manual.length,
      skip: skipped.length,
      total: results.length
    },
    results
  };

  if (wantJson) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log("Grok ↔ Vork UI 一致性检查");
    console.log(
      grokOk
        ? `Grok 语料: ${grokExtract}`
        : `Grok 语料: 不可用（${grokReason}）`
    );
    console.log(`Vork 源码: ${desktopSrc}`);
    console.log("");

    const byStatus = /** @type {Record<string, typeof results>} */ ({
      fail: failed,
      warn: warned,
      skip: skipped,
      manual: manual,
      pass: passed
    });
    const labels = {
      fail: "失败",
      warn: "警告",
      skip: "跳过",
      manual: "需人工",
      pass: "通过"
    };
    for (const key of /** @type {const} */ (["fail", "warn", "skip", "manual", "pass"])) {
      const list = byStatus[key];
      if (!list.length) continue;
      console.log(`## ${labels[key]} (${list.length})`);
      for (const item of list) {
        const extra = item.detail ? ` — ${item.detail}` : "";
        console.log(`- [${item.category}] ${item.id}: ${item.title}${extra}`);
      }
      console.log("");
    }
    console.log(
      `合计: ${summary.counts.pass} 通过 / ${summary.counts.fail} 失败 / ${summary.counts.warn} 警告 / ${summary.counts.manual} 需人工 / ${summary.counts.skip} 跳过`
    );
  }

  if (failed.length > 0) process.exit(EXIT.FAIL);
  if (grokDependentSkipped && !skipGrok) process.exit(EXIT.GROK);
  process.exit(EXIT.OK);
}

main();

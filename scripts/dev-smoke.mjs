/**
 * 轻量 API 冒烟：health → 建 Bot → 发消息 → 等到助手回复。
 * 兼容 FakeModel 与真模型：只断言出现非空 assistant 消息，不校验固定文案。
 * 前置：`docker compose up -d --build` 且建议先 `pnpm healthcheck`。
 *
 * 用法：
 *   pnpm smoke
 *   pnpm smoke -- --file-demo          # 额外发 [file-demo]（需 Computer 就绪）
 *   pnpm smoke -- --sse                # 额外用 SSE 校验任务事件序列
 *   pnpm smoke -- --timeout=60000      # 等待助手/SSE 的超时（毫秒，默认 30000）
 *   node scripts/dev-smoke.mjs --help
 *
 * 退出码：
 *   0  成功
 *   1  断言/业务失败（API 错误、缺字段、SSE 不完整等）
 *   2  前置未就绪（API 不可达 / health 失败）
 *   3  超时（等待助手回复或 SSE）
 *   64 用法错误（未知参数）
 */

const API = process.env.VORK_API_BASE_URL ?? "http://127.0.0.1:3000";
const POLL_MS = 500;
const DEFAULT_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;

const EXIT = Object.freeze({
  OK: 0,
  FAIL: 1,
  PREFLIGHT: 2,
  TIMEOUT: 3,
  USAGE: 64
});

class SmokeError extends Error {
  /**
   * @param {string} message
   * @param {number} exitCode
   */
  constructor(message, exitCode = EXIT.FAIL) {
    super(message);
    this.name = "SmokeError";
    this.exitCode = exitCode;
  }
}

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{ fileDemo: boolean, sse: boolean, timeoutMs: number, help: boolean }} */
  const opts = {
    fileDemo: false,
    sse: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    // pnpm/npm 有时会把分隔用的 `--` 原样传给脚本
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") {
      opts.help = true;
      continue;
    }
    if (arg === "--file-demo") {
      opts.fileDemo = true;
      continue;
    }
    if (arg === "--sse") {
      opts.sse = true;
      continue;
    }
    if (arg === "--timeout" || arg.startsWith("--timeout=")) {
      const raw = arg.includes("=") ? arg.slice("--timeout=".length) : argv[++i];
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0) {
        throw new SmokeError(`无效 --timeout: ${raw ?? "(missing)"}`, EXIT.USAGE);
      }
      opts.timeoutMs = value;
      continue;
    }
    throw new SmokeError(`未知参数: ${arg}（见 --help）`, EXIT.USAGE);
  }

  return opts;
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/dev-smoke.mjs [options]

Options:
  --file-demo          额外跑 [file-demo] 文件工具剧本
  --sse                额外校验任务 SSE（message.delta → task.completed）
  --timeout <ms>       等待助手回复 / SSE 的超时（默认 ${DEFAULT_TIMEOUT_MS}）
  -h, --help           显示帮助

Exit codes: 0 ok | 1 fail | 2 preflight | 3 timeout | 64 usage
Env: VORK_API_BASE_URL (default ${API})
`);
}

/**
 * @param {string} path
 * @param {{ method?: string, body?: unknown }} [init]
 */
async function api(path, { method = "GET", body } = {}) {
  let response;
  try {
    response = await fetch(new URL(path, API), {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new SmokeError(`API 不可达 ${method} ${path}: ${reason}`, EXIT.PREFLIGHT);
  }

  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    throw new SmokeError(`${method} ${path} → ${response.status}: ${text.slice(0, 200)}`, EXIT.FAIL);
  }
  if (!response.ok) {
    throw new SmokeError(`${method} ${path} → ${response.status}: ${JSON.stringify(json)}`, EXIT.FAIL);
  }
  return json;
}

async function preflightHealth() {
  const body = await api("/v1/bots");
  if (!Array.isArray(body?.bots)) {
    throw new SmokeError("health 失败：GET /v1/bots 未返回 bots 数组", EXIT.PREFLIGHT);
  }
  process.stdout.write(`health ok: API ${API} (bots=${body.bots.length})\n`);
}

/**
 * @param {string} conversationId
 * @param {{ afterMessageId?: string, minAssistantCount?: number, timeoutMs: number, label: string, taskId?: string }} opts
 */
async function waitForAssistant(conversationId, opts) {
  const { afterMessageId, minAssistantCount = 1, timeoutMs, label, taskId } = opts;
  const deadline = Date.now() + timeoutMs;
  /** @type {SmokeError | null} */
  let taskFailure = null;
  const stopMonitor = new AbortController();

  if (taskId) {
    void readSseUntilTerminal(taskId, timeoutMs, stopMonitor.signal)
      .then((result) => {
        const { types, terminalPayload } = result;
        const terminal = [...types].reverse().find((t) =>
          t === "task.completed" || t === "task.failed" || t === "task.cancelled"
        );
        if (terminal === "task.failed" || terminal === "task.cancelled") {
          const code =
            terminalPayload && typeof terminalPayload === "object" && "errorCode" in terminalPayload
              ? String(/** @type {{ errorCode?: unknown }} */ (terminalPayload).errorCode ?? "")
              : "";
          const detail = code ? ` errorCode=${code}` : "";
          taskFailure = new SmokeError(
            `任务 ${taskId} 终态 ${terminal}${detail}（${label}），无助手回复`,
            EXIT.FAIL
          );
        }
      })
      .catch((error) => {
        if (stopMonitor.signal.aborted) return;
        if (error instanceof SmokeError && error.exitCode === EXIT.TIMEOUT) return;
        taskFailure =
          error instanceof SmokeError
            ? error
            : new SmokeError(error instanceof Error ? error.message : String(error), EXIT.FAIL);
      });
  }

  try {
    while (Date.now() < deadline) {
      if (taskFailure) throw taskFailure;

      const { messages } = await api(`/v1/conversations/${encodeURIComponent(conversationId)}/messages`);
      const list = messages ?? [];
      const assistants = list.filter((m) => {
        if (m.authorType !== "assistant") return false;
        if (typeof m.content !== "string" || m.content.trim().length === 0) return false;
        if (afterMessageId) {
          const afterIndex = list.findIndex((x) => x.id === afterMessageId);
          const selfIndex = list.findIndex((x) => x.id === m.id);
          if (afterIndex === -1 || selfIndex <= afterIndex) return false;
        }
        return true;
      });

      if (assistants.length >= minAssistantCount) {
        return assistants[assistants.length - 1];
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }

    if (taskFailure) throw taskFailure;
    throw new SmokeError(`超时未等到助手回复（${label}，${timeoutMs}ms）`, EXIT.TIMEOUT);
  } finally {
    stopMonitor.abort();
  }
}

/**
 * @param {string} taskId
 * @param {number} timeoutMs
 * @param {AbortSignal} [externalSignal]
 * @returns {Promise<{ types: string[], terminalPayload: unknown }>}
 */
async function readSseUntilTerminal(taskId, timeoutMs, externalSignal) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
  if (externalSignal?.aborted) controller.abort();

  try {
    let response;
    try {
      response = await fetch(new URL(`/v1/tasks/${encodeURIComponent(taskId)}/events?after=0`, API), {
        headers: { accept: "text/event-stream" },
        signal: controller.signal
      });
    } catch (error) {
      if (externalSignal?.aborted) {
        return { types: [], terminalPayload: undefined };
      }
      if (error?.name === "AbortError") {
        throw new SmokeError(`SSE 超时（${timeoutMs}ms）`, EXIT.TIMEOUT);
      }
      const reason = error instanceof Error ? error.message : String(error);
      throw new SmokeError(`SSE 连接失败: ${reason}`, EXIT.FAIL);
    }

    if (!response.ok || !response.body) {
      throw new SmokeError(`SSE 打开失败 → ${response.status}`, EXIT.FAIL);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const types = [];
    /** @type {unknown} */
    let terminalPayload;

    while (true) {
      let chunk;
      try {
        chunk = await reader.read();
      } catch (error) {
        if (externalSignal?.aborted) return { types, terminalPayload };
        if (error?.name === "AbortError") {
          throw new SmokeError(`SSE 超时（${timeoutMs}ms），已见: ${types.join(",") || "(none)"}`, EXIT.TIMEOUT);
        }
        throw error;
      }
      const { done, value } = chunk;
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
        if (!frame || frame.startsWith(":")) continue;
        const lines = frame.split("\n");
        const eventLine = lines.find((line) => line.startsWith("event:"));
        if (!eventLine) continue;
        const type = eventLine.slice("event:".length).trim();
        types.push(type);
        const dataLine = lines.find((line) => line.startsWith("data:"));
        let payload;
        if (dataLine) {
          try {
            payload = JSON.parse(dataLine.slice("data:".length).trim());
          } catch {
            payload = undefined;
          }
        }
        if (type === "task.completed" || type === "task.failed" || type === "task.cancelled") {
          terminalPayload = payload?.payload ?? payload;
          clearTimeout(timeout);
          controller.abort();
          return { types, terminalPayload };
        }
      }
    }

    throw new SmokeError(`SSE 流结束但未到终态: ${types.join(",") || "(none)"}`, EXIT.FAIL);
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}

/**
 * @param {{ fileDemo: boolean, sse: boolean, timeoutMs: number }} opts
 */
async function runSmoke(opts) {
  await preflightHealth();

  const created = await api("/v1/bots", {
    method: "POST",
    body: { name: `smoke-${Date.now()}`, persona: "本地冒烟用 Bot" }
  });
  const conversationId = created.conversation?.id;
  if (!conversationId) throw new SmokeError("创建 Bot 未返回 conversation.id", EXIT.FAIL);

  const queued = await api(`/v1/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: "POST",
    body: { content: "你好" }
  });
  const userMessageId = queued.message?.id;
  if (!queued.task?.id) throw new SmokeError("发消息未返回 task", EXIT.FAIL);
  if (!userMessageId) throw new SmokeError("发消息未返回 message.id", EXIT.FAIL);

  if (opts.sse) {
    const { types } = await readSseUntilTerminal(queued.task.id, opts.timeoutMs);
    if (!types.includes("message.delta") || !types.includes("task.completed")) {
      throw new SmokeError(`SSE 事件序列不完整: ${types.join(",")}`, EXIT.FAIL);
    }
    process.stdout.write(`sse ok: ${types.join(" → ")}\n`);
  }

  const chat = await waitForAssistant(conversationId, {
    afterMessageId: userMessageId,
    minAssistantCount: 1,
    timeoutMs: opts.timeoutMs,
    label: "普通聊天",
    taskId: queued.task.id
  });
  const preview = chat.content.replaceAll("\n", " ").slice(0, 80);
  process.stdout.write(`chat ok: assistant reply (${chat.content.length} chars): ${preview}\n`);

  if (opts.fileDemo) {
    const fileQueued = await api(`/v1/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: "POST",
      body: { content: "[file-demo] 请写文件" }
    });
    const fileUserId = fileQueued.message?.id;
    if (!fileQueued.task?.id) throw new SmokeError("[file-demo] 未返回 task", EXIT.FAIL);
    if (!fileUserId) throw new SmokeError("[file-demo] 未返回 message.id", EXIT.FAIL);

    const fileReply = await waitForAssistant(conversationId, {
      afterMessageId: fileUserId,
      minAssistantCount: 1,
      timeoutMs: opts.timeoutMs,
      label: "[file-demo]",
      taskId: fileQueued.task.id
    });
    process.stdout.write(`file-demo ok: ${fileReply.content.replaceAll("\n", " ").slice(0, 120)}\n`);
  }

  process.stdout.write(`Vork smoke passed (conversation=${conversationId}).\n`);
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof SmokeError) {
      process.stderr.write(`Vork smoke failed: ${error.message}\n`);
      process.exitCode = error.exitCode;
      return;
    }
    throw error;
  }

  if (opts.help) {
    printHelp();
    process.exitCode = EXIT.OK;
    return;
  }

  try {
    await runSmoke(opts);
    process.exitCode = EXIT.OK;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const exitCode = error instanceof SmokeError ? error.exitCode : EXIT.FAIL;
    process.stderr.write(`Vork smoke failed: ${message}\n`);
    process.exitCode = exitCode;
  }
}

await main();

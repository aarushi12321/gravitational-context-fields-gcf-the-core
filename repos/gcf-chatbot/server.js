import { createServer } from "node:http";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const root = normalize(join(import.meta.dirname, "..", ".."));
loadDotEnv(join(root, ".env"));
loadDotEnv(join(import.meta.dirname, ".env"));

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 4176);
const openaiModel = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const fallbackModels = (
  process.env.OPENAI_FALLBACK_MODELS || "gpt-4.1,gpt-4o-mini,gpt-4o"
)
  .split(",")
  .map((model) => model.trim())
  .filter(Boolean);
const seedConcurrency = Number(process.env.OPENAI_SEED_CONCURRENCY || 6);
const refillConcurrency = Number(process.env.OPENAI_REFILL_CONCURRENCY || 4);
const debugLogLimit = Number(process.env.GCF_DEBUG_LOG_LIMIT || 400);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const debugLog = [];
let requestCounter = 0;

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  logDebug("info", "http.request", { method: request.method, path: url.pathname });

  if (url.pathname.startsWith("/api/")) {
    await handleApi(request, response, url);
    return;
  }

  const pathname =
    url.pathname === "/" ? "/repos/gcf-chatbot/index.html" : url.pathname;
  const file = normalize(join(root, pathname));

  if (!file.startsWith(root) || !existsSync(file)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  const ext = extname(file);
  response.writeHead(200, {
    "content-type": types[ext] || "text/plain; charset=utf-8",
    "cache-control": ext === ".html" || ext === ".js" || ext === ".css" ? "no-store" : "public, max-age=3600",
  });
  createReadStream(file).pipe(response);
});

async function handleApi(request, response, url) {
  const requestId = ++requestCounter;
  const startedAt = Date.now();

  if (url.pathname === "/api/status") {
    logDebug("info", "api.status", {
      requestId,
      configured: Boolean(process.env.OPENAI_API_KEY),
      model: openaiModel,
    });
    sendJson(response, 200, {
      configured: Boolean(process.env.OPENAI_API_KEY),
      model: openaiModel,
      fallbackModels,
      seedConcurrency,
      refillConcurrency,
      timeoutMs: Number(process.env.OPENAI_TIMEOUT_MS || 45000),
    });
    return;
  }

  if (url.pathname === "/api/beacon") {
    logDebug("info", "client.beacon", {
      requestId,
      kind: url.searchParams.get("kind") || "unknown",
      message: url.searchParams.get("message") || "",
      href: url.searchParams.get("href") || "",
    });
    sendJson(response, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/debug/recent") {
    const limit = Math.min(
      1000,
      Math.max(10, Number(url.searchParams.get("limit") || 200)),
    );
    logDebug("info", "api.debug.recent", { requestId, limit });
    sendJson(response, 200, {
      now: new Date().toISOString(),
      entries: debugLog.slice(-limit),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/client-log") {
    try {
      const body = await readJson(request);
      logDebug(String(body?.level || "info"), "client.log", {
        requestId,
        kind: body?.kind,
        message: body?.message,
        stack: body?.stack,
        href: body?.href,
        ua: body?.ua,
      });
      sendJson(response, 200, { ok: true });
    } catch (error) {
      logDebug("warn", "client.log_error", { requestId, message: error.message || String(error) });
      sendJson(response, 400, { ok: false, error: "Invalid client log payload." });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/client-log") {
    try {
      const body = await readJson(request);
      logDebug(String(body?.level || "info"), "client.log", {
        requestId,
        kind: body?.kind,
        message: body?.message,
        stack: body?.stack,
        href: body?.href,
        ua: body?.ua,
      });
      sendJson(response, 200, { ok: true });
    } catch (error) {
      logDebug("warn", "client.log_error", {
        requestId,
        message: error.message || String(error),
      });
      sendJson(response, 400, { ok: false, error: "Invalid client log payload." });
    }
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    logDebug("warn", "api.missing_key", {
      requestId,
      path: url.pathname,
      ms: Date.now() - startedAt,
    });
    sendJson(response, 503, {
      error:
        "OPENAI_API_KEY is not configured. Start the server with an API key to use live LLM memory.",
    });
    return;
  }

  try {
    logDebug("info", "api.request", {
      requestId,
      method: request.method,
      path: url.pathname,
      search: url.search,
    });

    if (request.method === "POST" && url.pathname === "/api/seed-chunks") {
      const body = await readJson(request);
      logDebug("info", "seed.begin", {
        requestId,
        count: body?.count,
        offset: body?.offset,
      });
      const result = await generateSeedChunks(
        body?.count || 96,
        body?.offset || 0,
      );
      logDebug("info", "seed.done", {
        requestId,
        chunks: result.chunks?.length || 0,
        model: result.model,
        errors: result.errors?.length || 0,
        ms: Date.now() - startedAt,
      });
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/answer") {
      const body = await readJson(request);
      logDebug("info", "answer.begin", {
        requestId,
        bestGravity: body?.bestGravity,
        refilled: body?.refilled,
        chunks: Array.isArray(body?.chunks) ? body.chunks.length : 0,
      });
      const result = await generateAnswer(body);
      logDebug("info", "answer.done", {
        requestId,
        model: result.model,
        ms: Date.now() - startedAt,
      });
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/refill") {
      const body = await readJson(request);
      logDebug("info", "refill.begin", {
        requestId,
        count: body?.count,
        bestGravity: body?.bestGravity,
      });
      const result = await generateRefillChunks(body);
      logDebug("info", "refill.done", {
        requestId,
        chunks: result.chunks?.length || 0,
        model: result.model,
        errors: result.errors?.length || 0,
        ms: Date.now() - startedAt,
      });
      sendJson(response, 200, result);
      return;
    }

    sendJson(response, 404, { error: "Unknown API route." });
  } catch (error) {
    logDebug("error", "api.error", {
      requestId,
      path: url.pathname,
      message: error.message || String(error),
      ms: Date.now() - startedAt,
    });
    sendJson(response, 500, { error: error.message || "API request failed." });
  }
}

async function generateSeedChunks(count, startOffset = 0) {
  const safeCount = Math.min(100, Math.max(1, Number(count) || 16));
  const batchSize = Number(process.env.OPENAI_SEED_BATCH_SIZE || 8);
  const jobs = [];

  for (let offset = 0; offset < safeCount; offset += batchSize) {
    const batchCount = Math.min(batchSize, safeCount - offset);
    const absoluteOffset = Number(startOffset) + offset;
    jobs.push(() =>
      generateChunkBatch({
        batchCount,
        offset: absoluteOffset,
        idPrefix: "C",
        instructions:
          "You create compact knowledge memory chunks for an LLM external memory system. Return valid JSON only.",
        input: `Generate ${batchCount} diverse knowledge chunks across systems, networking, machine learning, databases, history, biology, cooking, writing, mathematics, security, and product design.

Return a JSON array. Each item must have:
- id: C0001 style, sequential, starting at C${String(absoluteOffset + 1).padStart(4, "0")}
- cluster: short lowercase slug
- keywords: 5 to 8 short terms
- content: 1 or 2 factual sentences, useful as retrievable context
- tokens: estimated token count between 45 and 180

Do not include markdown.`,
        maxOutputTokens: 900,
      }),
    );
  }

  return combineBatchResults(
    await runLimited(jobs, seedConcurrency),
    safeCount,
  );
}

async function generateRefillChunks({
  query = "",
  bestGravity = 0,
  existingIds = [],
  count = 12,
} = {}) {
  const safeCount = Math.min(24, Math.max(1, Number(count) || 12));
  const batchSize = Number(process.env.OPENAI_REFILL_BATCH_SIZE || 3);
  const jobs = [];

  for (let offset = 0; offset < safeCount; offset += batchSize) {
    const batchCount = Math.min(batchSize, safeCount - offset);
    jobs.push(() =>
      generateChunkBatch({
        batchCount,
        offset,
        idPrefix: "N",
        instructions:
          "You generate replacement memory chunks when the current memory field is under-confident. Return valid JSON only.",
        input: `The current best chunk gravity is ${Number(bestGravity).toFixed(2)}, below the 0.75 confidence threshold.
User query: ${query}
Existing IDs to avoid: ${existingIds.slice(0, 120).join(", ")}

Generate ${batchCount} new knowledge chunks likely to help answer this query.
Return only a valid JSON array with id, cluster, keywords, content, tokens. Use id values beginning with N, like N0001. No markdown. No commentary.`,
        maxOutputTokens: 600,
      }),
    );
  }

  return combineBatchResults(
    await runLimited(jobs, refillConcurrency),
    safeCount,
  );
}

async function generateChunkBatch({
  batchCount,
  offset,
  idPrefix,
  instructions,
  input,
  maxOutputTokens,
}) {
  const result = await callOpenAI({ instructions, input, maxOutputTokens });
  return {
    chunks: normalizeSeedJson(result.text, batchCount, idPrefix, offset),
    model: result.model,
  };
}

async function runLimited(jobs, concurrency) {
  const results = [];
  let next = 0;
  const workerCount = Math.min(Math.max(1, concurrency), jobs.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (next < jobs.length) {
        const index = next++;
        try {
          results[index] = { status: "fulfilled", value: await jobs[index]() };
        } catch (error) {
          results[index] = { status: "rejected", reason: error };
        }
      }
    }),
  );

  return results;
}

function combineBatchResults(results, expectedCount) {
  const chunks = [];
  let model = openaiModel;
  const errors = [];

  for (const result of results) {
    if (result.status === "fulfilled") {
      chunks.push(...result.value.chunks);
      model = result.value.model || model;
    } else {
      errors.push(result.reason?.message || "batch failed");
    }
  }

  if (!chunks.length) {
    throw new Error(`All parallel chunk batches failed: ${errors.join(" | ")}`);
  }

  return {
    chunks: dedupeChunks(chunks).slice(0, expectedCount),
    model,
    errors,
  };
}

function dedupeChunks(chunks) {
  const seen = new Set();
  return chunks.filter((chunk, index) => {
    const id = chunk.id || `C${String(index + 1).padStart(4, "0")}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

async function generateAnswer({
  query = "",
  promptContext = "",
  chunks = [],
  bestGravity = 0,
  refilled = false,
} = {}) {
  const chunkSummary = chunks
    .map(
      (chunk) =>
        `${chunk.id} gravity=${Number(chunk.gravity).toFixed(2)} tier=L${chunk.tier}: ${chunk.content}`,
    )
    .join("\n");
  const result = await callOpenAI({
    instructions:
      "You are the base LLM behind a Gravitational Context Field memory layer. For every user prompt, the app supplies dynamic memory from L1/L2/L3 tiers. Use that memory as external context, but still answer as the base model. Cite memory chunks when you use them, like [C0042]. If memory is insufficient, say what is missing and answer from general reasoning only when appropriate.",
    input: `User query:
${query}

Best gravity: ${Number(bestGravity).toFixed(2)}
Memory refilled before answer: ${Boolean(refilled)}

Dynamic GCF memory context assembled from L1/L2/L3:
${promptContext}

Chunk summaries:
${chunkSummary}`,
  });
  return { answer: result.text.trim(), model: result.model };
}

async function callOpenAI(payload) {
  const models = Array.from(new Set([openaiModel, ...fallbackModels]));
  const errors = [];

  for (const model of models) {
    try {
      logDebug("info", "openai.try", { model });
      return {
        text: await callOpenAIModel(payload, model),
        model,
      };
    } catch (error) {
      errors.push(`${model}: ${error.message}`);
      logDebug("warn", "openai.fail", {
        model,
        message: error.message || String(error),
      });
      if (
        !/model|access|does not have access|not found|unsupported/i.test(
          error.message,
        )
      ) {
        throw error;
      }
    }
  }

  throw new Error(
    `No configured model was available. Tried ${errors.join(" | ")}`,
  );
}

async function callOpenAIModel(payload, model) {
  const controller = new AbortController();
  const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || 45000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  const apiResponse = await fetch(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: payload.instructions },
          { role: "user", content: payload.input },
        ],
        max_tokens: payload.maxOutputTokens || 1400,
      }),
    },
  ).finally(() => clearTimeout(timeout));

  const json = await apiResponse.json();
  if (!apiResponse.ok) {
    logDebug("warn", "openai.http_error", {
      model,
      status: apiResponse.status,
      message: json.error?.message || `OpenAI API error ${apiResponse.status}`,
      ms: Date.now() - startedAt,
    });
    throw new Error(
      json.error?.message || `OpenAI API error ${apiResponse.status}`,
    );
  }
  logDebug("info", "openai.ok", {
    model,
    status: apiResponse.status,
    ms: Date.now() - startedAt,
  });
  return extractResponseText(json);
}

function extractResponseText(response) {
  if (
    response.choices &&
    Array.isArray(response.choices) &&
    response.choices[0]?.message?.content
  ) {
    return response.choices[0].message.content;
  }
  if (response.output_text) return response.output_text;
  const parts = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text)
        parts.push(content.text);
      if (content.text) parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

function normalizeSeedJson(text, expectedCount, idPrefix = "C", offset = 0) {
  const parsed = parseJsonArray(text);
  if (!Array.isArray(parsed))
    throw new Error("LLM seed response was not a JSON array.");
  return parsed
    .slice(0, expectedCount)
    .map((item, index) => ({
      id:
        typeof item.id === "string" && item.id.trim()
          ? item.id.trim()
          : `${idPrefix}${String(offset + index + 1).padStart(4, "0")}`,
      cluster:
        String(item.cluster || "general")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") || "general",
      keywords: Array.isArray(item.keywords)
        ? item.keywords.map(String).slice(0, 8)
        : [],
      content: String(item.content || "").trim(),
      tokens: Math.min(
        220,
        Math.max(30, Number(item.tokens) || estimateTokens(item.content || "")),
      ),
    }))
    .filter((item) => item.content);
}

function parseJsonArray(text) {
  const stripped = String(text)
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const candidate = extractFirstJsonArray(stripped);
  const cleaned = candidate
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/[\u0000-\u001F]+/g, " ");
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    const objects = extractJsonObjects(cleaned)
      .map((objectText) => {
        try {
          return JSON.parse(objectText.replace(/,\s*}/g, "}"));
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    logDebug("warn", "json.recover", {
      message: error.message,
      recovered: objects.length,
      sample: cleaned.slice(0, 220),
    });
    if (objects.length) return objects;
    throw error;
  }
}

function extractFirstJsonArray(text) {
  const start = text.indexOf("[");
  if (start < 0) return text;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "[") depth += 1;
    if (char === "]") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }

  return text.slice(start);
}

function extractJsonObjects(text) {
  const objects = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objects.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return objects;
}

function estimateTokens(text) {
  return Math.ceil(String(text).split(/\s+/).filter(Boolean).length * 1.25);
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

server.listen(port, host, () => {
  console.log(`GCF chatbot running at http://${host}:${port}`);
});

function loadDotEnv(path) {
  if (!existsSync(path)) return;
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
}

function logDebug(level, event, meta = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    meta,
  };
  debugLog.push(entry);
  if (debugLog.length > debugLogLimit) debugLog.shift();
  console.log(
    `[${entry.ts}] ${String(level).toUpperCase()} ${event} ${safeJson(meta)}`,
  );
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return '"<unserializable>"';
  }
}

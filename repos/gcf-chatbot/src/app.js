const TIER_META = {
  1: { name: "L1 Prompt Cache", latency: "0ms", color: "#f59e0b", label: "L1" },
  2: { name: "L2 Warm Store", latency: "5ms", color: "#14b8a6", label: "L2" },
  3: {
    name: "L3 Semantic Index",
    latency: "50ms",
    color: "#3b82f6",
    label: "L3",
  },
  4: {
    name: "L4 Cold Archive",
    latency: "500ms",
    color: "#64748b",
    label: "L4",
  },
};

const state = {
  chunks: [],
  committedChunks: [],
  turns: [],
  events: [],
  selectedId: "C0001",
  lastFieldUpdate: null,
  lastQuery: "",
  previewText: "",
  previewMode: false,
  startTime: performance.now(),
  timer: null,
  outputs: [],
  apiConfigured: false,
  apiModel: "unknown",
  loading: true,
  lastSeedError: "",
  lastStatus: null,
};

const refs = {
  stats: document.querySelector("#stats"),
  fieldAge: document.querySelector("#fieldAge"),
  tierLanes: document.querySelector("#tierLanes"),
  heatmap: document.querySelector("#heatmap"),
  turnPills: document.querySelector("#turnPills"),
  promptContext: document.querySelector("#promptContext"),
  answer: document.querySelector("#answer"),
  queryOutputs: document.querySelector("#queryOutputs"),
  chatForm: document.querySelector("#chatForm"),
  chatInput: document.querySelector("#chatInput"),
  randomTurnBtn: document.querySelector("#randomTurnBtn"),
  inspector: document.querySelector("#chunkInspector"),
  selectedBadge: document.querySelector("#selectedBadge"),
  eventLog: document.querySelector("#eventLog"),
  assemblyState: document.querySelector("#assemblyState"),
  assemblyFlights: document.querySelector("#assemblyFlights"),
  modal: document.querySelector("#chunkModal"),
  modalTitle: document.querySelector("#modalTitle"),
  modalBody: document.querySelector("#modalBody"),
  modalClose: document.querySelector("#modalClose"),
};

init();

async function init() {
  console.log("[GCF] init start", { href: location.href });
  bindEvents();
  addEvent("FIELD-UPDATE", "boot", "checking api");
  render();
  console.log("[GCF] calling loadLlmSeeds");
  await loadLlmSeeds();
  console.log("[GCF] loadLlmSeeds done", { chunks: state.committedChunks.length, configured: state.apiConfigured });
  setInterval(renderStats, 250);
}

function bindEvents() {
  refs.chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = refs.chatInput.value.trim();
    if (!text || state.loading || !state.committedChunks.length) return;
    refs.chatInput.value = "";
    state.previewText = "";
    state.previewMode = false;
    await commitTurn(text);
  });

  refs.chatInput.addEventListener("input", () => {
    clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.previewText = refs.chatInput.value.trim();
      updatePreview();
    }, 200);
  });

  refs.randomTurnBtn.addEventListener("click", async () => {
    if (state.loading || !state.committedChunks.length) return;
    const syntheticTurns = [
      "The kernel scheduler should prefetch hot prompt pages before the query arrives.",
      "TCP congestion and packet latency are pulling networking chunks into working memory.",
      "Transformer attention, embeddings, and retrieval should shape the assembled context.",
      "Fermentation temperature and yeast activity are changing the cooking cluster gravity.",
      "Roman trade archives and naval routes are relevant to the current investigation.",
      "Database query planners expose cache misses, joins, and index scan costs.",
    ];
    const text =
      syntheticTurns[Math.floor(Math.random() * syntheticTurns.length)];
    await commitTurn(text, {
      synthetic: true,
      randomMomentum: 0.35 + Math.random() * 0.65,
    });
  });

  refs.modalClose.addEventListener("click", () => refs.modal.close());
  refs.modal.addEventListener("click", (event) => {
    if (event.target === refs.modal) refs.modal.close();
  });

}

async function loadLlmSeeds() {
  state.loading = true;
  state.lastSeedError = "";
  if (refs.assemblyState) refs.assemblyState.textContent = "requesting LLM seed memory";
  if (refs.answer) refs.answer.textContent = "Loading initial memory from the LLM...";
  render();
  try {
    const status = await apiGet("/api/status");
    state.lastStatus = status;
    state.apiConfigured = status.configured;
    state.apiModel = status.model;
    render();
    if (!status.configured) {
      throw new Error("OPENAI_API_KEY is not configured on the local server.");
    }
    await hydrateSeedBatches(96, 8, 6);
    if (refs.answer) refs.answer.textContent = `LLM seed memory loaded: ${state.committedChunks.length}/96 chunks. Submit a query to assemble context and call the base model.`;
  } catch (error) {
    state.committedChunks = [];
    state.chunks = [];
    state.lastSeedError = error.message || String(error);
    addEvent("FIELD-UPDATE", "API-NEEDED", error.message);
    if (refs.answer) refs.answer.textContent = `${error.message} Start the server with OPENAI_API_KEY to let the LLM seed and answer from memory.`;
    if (refs.promptContext) {
      refs.promptContext.textContent =
        "No fake chunks loaded. Waiting for live LLM seed memory.";
    }
  } finally {
    state.loading = false;
    render();
  }
}

async function hydrateSeedBatches(targetCount, batchSize, concurrency) {
  state.committedChunks = [];
  state.chunks = [];
  state.selectedId = "";
  if (refs.answer) refs.answer.textContent = `Hydrating LLM memory in parallel: 0/${targetCount} chunks loaded...`;
  addEvent(
    "FIELD-UPDATE",
    "LLM-SEED",
    `parallel batches target=${targetCount}`,
  );
  render();

  const jobs = [];
  for (let offset = 0; offset < targetCount; offset += batchSize) {
    const count = Math.min(batchSize, targetCount - offset);
    jobs.push({ offset, count });
  }

  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, jobs.length) },
    async () => {
      while (next < jobs.length) {
        const job = jobs[next++];
        try {
          const {
            chunks,
            model,
            errors = [],
          } = await apiPost("/api/seed-chunks", {
            count: job.count,
            offset: job.offset,
          });
          state.apiModel = model || state.apiModel;
          const normalized = chunks.map((chunk, index) =>
            normalizeApiChunk(
              {
                ...chunk,
                id: `C${String(job.offset + index + 1).padStart(4, "0")}`,
              },
              job.offset + index,
            ),
          );
          state.committedChunks.push(...normalized);
          state.committedChunks.sort((a, b) => a.index - b.index);
          state.chunks = cloneChunks(state.committedChunks);
          state.selectedId ||= state.chunks[0]?.id || "";
          refs.answer.textContent = `Hydrating LLM memory in parallel: ${state.committedChunks.length}/${targetCount} chunks loaded...`;
          addEvent(
            "PAGE-IN",
            `seed-${job.offset + 1}`,
            `+${normalized.length} chunks model=${state.apiModel}`,
          );
          if (errors.length)
            addEvent(
              "FIELD-UPDATE",
              "SEED-WARN",
              `${errors.length} batch warnings`,
            );
          render();
        } catch (error) {
          state.lastSeedError = error.message || String(error);
          addEvent("FIELD-UPDATE", "SEED-ERR", error.message);
          renderEventLog();
        }
      }
    },
  );

  await Promise.all(workers);
  if (!state.committedChunks.length)
    throw new Error("All parallel seed batches failed.");
  state.chunks = cloneChunks(state.committedChunks);
  addEvent(
    "FIELD-UPDATE",
    "LLM-SEED-DONE",
    `loaded=${state.committedChunks.length}/${targetCount}`,
  );
  render();
}

function normalizeApiChunk(chunk, index) {
  const tier = index < 4 ? 1 : index < 16 ? 2 : index < 48 ? 3 : 4;
  const gravity =
    tier === 1
      ? 0.64 + seeded(index) * 0.1
      : tier === 2
        ? 0.38 + seeded(index) * 0.12
        : tier === 3
          ? 0.18 + seeded(index) * 0.08
          : seeded(index) * 0.1;
  const content = String(chunk.content || "").trim();
  const keywords = Array.isArray(chunk.keywords)
    ? chunk.keywords.map(String)
    : extractKeywords(content);
  return {
    id: chunk.id || `C${String(index + 1).padStart(4, "0")}`,
    index,
    cluster: chunk.cluster || "llm-seeded",
    keywords,
    content,
    vector: textVector(
      `${chunk.cluster || ""} ${keywords.join(" ")} ${content}`,
    ),
    gravity,
    tier,
    previousTier: tier,
    tokens: Math.max(30, Number(chunk.tokens) || estimateTokens(content)),
    accessCount: 0,
    lastPromotedAt: null,
    lastChangedAt: null,
    flashUntil: 0,
    gravityHistory: [gravity],
  };
}

function textVector(text) {
  const lower = text.toLowerCase();
  const vector = new Array(16).fill(0);
  const tokens = lower.split(/[^a-z0-9]+/).filter(Boolean);
  for (const token of tokens) {
    const h = hash(token);
    const sign = h % 2 === 0 ? 1 : -1;
    const weight = token.length > 6 ? 1.35 : 1;
    vector[Math.abs(h) % 16] += sign * weight;
    vector[Math.abs(hash(`${token}:semantic`)) % 16] += sign * 0.45;
    vector[Math.abs(hash(`${token}:cluster`)) % 16] += sign * 0.25;
  }
  return normalize(vector);
}

async function commitTurn(text, options = {}) {
  const vector = textVector(text);
  const previousVector = state.turns.at(-1)?.vector || vector;
  const momentum =
    options.randomMomentum ??
    clamp(1 - cosine(vector, previousVector) + conceptBoost(text), 0.18, 1);
  const turn = {
    id: state.turns.length + 1,
    text,
    vector,
    momentum,
    time: performance.now(),
  };
  state.turns.push(turn);
  state.lastQuery = text;

  const updates = updateChunks(state.committedChunks, vector, momentum, true);
  state.previewMode = false;
  state.lastFieldUpdate = performance.now();

  addEvent(
    "FIELD-UPDATE",
    `turn=${turn.id}`,
    `momentum=${momentum.toFixed(2)}`,
  );
  for (const update of updates) {
    const direction = update.from > update.to ? "PROMOTE" : "DEMOTE";
    addEvent(
      direction,
      update.chunk.id,
      `L${update.from}->L${update.to} gravity=${update.chunk.gravity.toFixed(2)}`,
    );
  }

  await assemblePrompt(text, vector, momentum);
  state.chunks = cloneChunks(state.committedChunks);
  render();
}

function updatePreview() {
  if (!state.previewText) {
    state.previewMode = false;
    state.chunks = cloneChunks(state.committedChunks);
    render();
    return;
  }
  const vector = textVector(state.previewText);
  const previousVector = state.turns.at(-1)?.vector || vector;
  const momentum = clamp(
    1 - cosine(vector, previousVector) + conceptBoost(state.previewText),
    0.12,
    1,
  );
  state.chunks = cloneChunks(state.committedChunks);
  updateChunks(state.chunks, vector, momentum, false);
  state.previewMode = true;
  state.lastFieldUpdate = performance.now();
  if (refs.assemblyState) refs.assemblyState.textContent = `typing warp momentum=${momentum.toFixed(2)}`;
  render();
}

function updateChunks(chunks, turnVector, momentum, commit) {
  const updates = [];
  const now = performance.now();
  for (const chunk of chunks) {
    const previousTier = chunk.tier;
    const pull = Math.max(0, cosine(turnVector, chunk.vector));
    chunk.gravity = clamp(chunk.gravity * 0.85 + pull * momentum, 0, 1);
    chunk.previousTier = previousTier;
    chunk.tier = tierForGravity(chunk.gravity);
    chunk.gravityHistory = [...chunk.gravityHistory.slice(-7), chunk.gravity];

    if (commit) {
      chunk.accessCount += pull > 0.25 ? 1 : 0;
      if (chunk.tier !== previousTier) {
        chunk.lastChangedAt = now;
        if (chunk.tier < previousTier) {
          chunk.lastPromotedAt = now;
          chunk.flashUntil = now + 2000;
        }
        updates.push({ chunk, from: previousTier, to: chunk.tier });
      }
    }
  }
  return updates;
}

async function assemblePrompt(query, vector, momentum) {
  let refilled = false;
  let selected = selectMemoryContext();
  const bestGravity = selected[0]?.gravity || 0;

  if (bestGravity < 0.75 && state.apiConfigured) {
    if (refs.assemblyState) {
      refs.assemblyState.textContent = `best gravity ${bestGravity.toFixed(2)} < 0.75, calling LLM refill`;
    }
    addEvent(
      "FIELD-UPDATE",
      "REFILL",
      `best=${bestGravity.toFixed(2)} threshold=0.75`,
    );
    renderEventLog();
    try {
      const refill = await apiPost("/api/refill", {
        query,
        bestGravity,
        existingIds: state.committedChunks.map((chunk) => chunk.id),
        count: 12,
      });
      state.apiModel = refill.model || state.apiModel;
      const offset = state.committedChunks.length;
      const newChunks = refill.chunks.map((chunk, index) =>
        normalizeApiChunk(chunk, offset + index),
      );
      state.committedChunks.push(...newChunks);
      updateChunks(newChunks, vector, momentum, true);
      for (const chunk of newChunks) {
        addEvent(
          "PAGE-IN",
          chunk.id,
          `LLM refill gravity=${chunk.gravity.toFixed(2)}`,
        );
      }
      refilled = true;
      selected = selectMemoryContext();
    } catch (error) {
      addEvent("FIELD-UPDATE", "REFILL-ERR", error.message);
    }
  }

  let used = 0;
  const lines = [];
  for (const [index, chunk] of selected.entries()) {
    if (used + chunk.tokens > 4096 && lines.length > 0) continue;
    used += chunk.tokens;
    chunk.accessCount += 1;
    addEvent(
      "PAGE-IN",
      chunk.id,
      `L${chunk.tier} ${chunk.tokens}tok gravity=${chunk.gravity.toFixed(2)}`,
    );
    const label =
      chunk.tier === 1
        ? "CORE CONTEXT"
        : chunk.tier === 2
          ? "SUPPORTING   "
          : "BACKGROUND   ";
    lines.push(
      `[${label} | gravity=${chunk.gravity.toFixed(2)} | ${chunk.id}] ${chunk.content.slice(0, 110)}...`,
    );
  }
  const promptContext = `GCF MEMORY CONTEXT\n${lines.join("\n")}\n\nQUERY: ${query}`;
  if (refs.promptContext) {
    refs.promptContext.textContent = promptContext;
  }
  const cited = selected.slice(0, 4);
  if (refs.answer) refs.answer.textContent = "Calling LLM for final answer...";
  addEvent(
    "FIELD-UPDATE",
    "CHUNKING",
    "segmenting response into knowledge chunks",
  );
  const llmAnswer = await answerWithLlm(
    query,
    promptContext,
    selected,
    refilled,
  );
  const responseChunk = addResponseMemoryChunk(query, llmAnswer, vector);
  const responseSubChunks = segmentResponseIntoChunks(
    llmAnswer,
    query,
    responseChunk.id,
  );
  addEvent(
    "FIELD-UPDATE",
    "CHUNKING",
    `created ${responseSubChunks.length} response sub-chunks`,
  );
  const answerHtml = renderAnswerHtml(
    llmAnswer,
    cited,
    responseChunk,
    responseSubChunks,
  );
  if (refs.answer) refs.answer.innerHTML = answerHtml;
  state.outputs.unshift({
    query,
    answerHtml,
    answerChunks: cited.map((chunk) => ({
      id: chunk.id,
      cluster: chunk.cluster,
      content: chunk.content,
      gravity: chunk.gravity,
      tier: chunk.tier,
    })),
    responseSubChunks,
    citedIds: cited.map((chunk) => chunk.id),
    at: performance.now(),
  });
  state.outputs = state.outputs.slice(0, 6);
  if (refs.assemblyState) refs.assemblyState.textContent = `assembled ${selected.length} chunks`;
  animateFlights(selected);
}

function segmentResponseIntoChunks(response, query, responseId) {
  addEvent(
    "FIELD-UPDATE",
    "CHUNKING",
    `segmenting ${response.length} chars into knowledge chunks`,
  );
  const chunks = [];

  // Split by sentences or paragraphs
  const sentences = response
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.trim().length > 20);

  // Group sentences into meaningful chunks (100-150 tokens)
  let currentChunk = "";
  let chunkIndex = 0;

  for (const sentence of sentences) {
    const combined = currentChunk ? `${currentChunk} ${sentence}` : sentence;
    const tokens = estimateTokens(combined);

    if (tokens > 120 && currentChunk) {
      // Create chunk with current content
      chunks.push({
        id: `${responseId}-${String(chunkIndex + 1).padStart(2, "0")}`,
        cluster: "response-segment",
        keywords: extractKeywords(currentChunk),
        content: currentChunk.trim(),
        tokens: estimateTokens(currentChunk),
      });
      currentChunk = sentence;
      chunkIndex++;
    } else {
      currentChunk = combined;
    }
  }

  // Add final chunk
  if (currentChunk.trim()) {
    chunks.push({
      id: `${responseId}-${String(chunkIndex + 1).padStart(2, "0")}`,
      cluster: "response-segment",
      keywords: extractKeywords(currentChunk),
      content: currentChunk.trim(),
      tokens: estimateTokens(currentChunk),
    });
  }

  addEvent(
    "FIELD-UPDATE",
    "CHUNKING",
    `generated ${chunks.length} chunks: ${chunks.map((c) => c.id).join(", ")}`,
  );
  return chunks;
}

function addResponseMemoryChunk(query, answer, queryVector) {
  const index = state.committedChunks.length;
  const id = `R${String(state.outputs.length + 1).padStart(4, "0")}`;
  const content = `User asked: ${query} Answer: ${answer}`;
  const vector = textVector(content);
  const pull = Math.max(0, cosine(queryVector, vector));
  const gravity = clamp(0.62 + pull * 0.3, 0, 0.92);
  const tier = tierForGravity(gravity);
  const chunk = {
    id,
    index,
    cluster: "conversation-response",
    keywords: extractKeywords(`${query} ${answer}`),
    content,
    vector,
    gravity,
    tier,
    previousTier: 4,
    tokens: estimateTokens(content),
    accessCount: 1,
    lastPromotedAt: performance.now(),
    lastChangedAt: performance.now(),
    flashUntil: performance.now() + 2000,
    gravityHistory: [gravity],
  };
  state.committedChunks.push(chunk);
  state.chunks = cloneChunks(state.committedChunks);
  addEvent(
    "PAGE-IN",
    id,
    `response memory L${tier} gravity=${gravity.toFixed(2)}`,
  );
  return chunk;
}

function renderAnswerHtml(
  answer,
  cited,
  responseChunk,
  responseSubChunks = [],
) {
  const citations = cited
    .map(
      (chunk) =>
        `<button class="citation" data-chunk-id="${chunk.id}" type="button">${chunk.id}</button>`,
    )
    .join(" ");

  const subChunksHtml =
    responseSubChunks.length > 0
      ? `
    <div class="response-sub-chunks">
      <div class="sub-chunks-label">Response decomposed into ${responseSubChunks.length} knowledge chunks:</div>
      <div class="sub-chunks-grid">
        ${responseSubChunks
          .map(
            (chunk) => `
          <div class="sub-chunk-item" style="border-color: color-mix(in srgb, #14b8a6 30%, var(--line-soft))">
            <div class="sub-chunk-header">
              <span class="sub-chunk-id">${escapeHtml(chunk.id)}</span>
              <span style="color: var(--muted); font-size: 8px">●</span>
              <span style="color: var(--muted); font-size: 9px">${chunk.cluster}</span>
            </div>
            <div class="sub-chunk-content">${escapeHtml(chunk.content)}</div>
          </div>
        `,
          )
          .join("")}
      </div>
    </div>
  `
      : "";

  return `
    <article class="response-card">
      <header>
        <span class="mono">BASE MODEL RESPONSE</span>
        <strong class="mono">${responseChunk.id} stored in L${responseChunk.tier}</strong>
      </header>
      <div class="response-body">${formatAnswerText(answer)}</div>
      ${subChunksHtml}
      <footer>
        <span>Cited chunks:</span>
        ${citations}
        <span class="memory-write">cached response: <button class="citation" data-chunk-id="${responseChunk.id}" type="button">${responseChunk.id}</button></span>
      </footer>
    </article>
  `;
}

function formatAnswerText(answer) {
  return escapeHtml(answer)
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function selectMemoryContext(tokenBudget = 4096) {
  const tierPriority = { 1: 0, 2: 1, 3: 2 };
  const candidates = state.committedChunks
    .filter((chunk) => chunk.tier <= 3)
    .sort(
      (a, b) =>
        tierPriority[a.tier] - tierPriority[b.tier] || b.gravity - a.gravity,
    );

  const selected = [];
  let used = 0;
  for (const chunk of candidates) {
    if (used + chunk.tokens > tokenBudget && selected.length > 0) continue;
    selected.push(chunk);
    used += chunk.tokens;
    if (used >= tokenBudget) break;
  }
  return selected;
}

async function answerWithLlm(query, promptContext, selected, refilled) {
  if (!state.apiConfigured)
    return "API key is not configured, so the live model could not answer.";
  try {
    const result = await apiPost("/api/answer", {
      query,
      promptContext,
      bestGravity: selected[0]?.gravity || 0,
      refilled,
      chunks: selected.map(({ id, tier, gravity, content }) => ({
        id,
        tier,
        gravity,
        content,
      })),
    });
    addEvent(
      "FIELD-UPDATE",
      "LLM-ANSWER",
      `model=${result.model || state.apiModel}`,
    );
    return result.answer;
  } catch (error) {
    addEvent("FIELD-UPDATE", "LLM-ERR", error.message);
    return `The LLM answer call failed: ${error.message}`;
  }
}

function animateFlights(chunks) {
  if (!refs.assemblyFlights) return;
  refs.assemblyFlights.innerHTML = "";
  chunks.slice(0, 5).forEach((chunk, index) => {
    const dot = document.createElement("span");
    dot.className = "flight-dot";
    dot.style.setProperty("--tier-color", TIER_META[chunk.tier].color);
    dot.style.setProperty("--delay", `${index * 90}ms`);
    dot.textContent = chunk.id;
    refs.assemblyFlights.appendChild(dot);
  });
  setTimeout(() => {
    refs.assemblyFlights.innerHTML = "";
  }, 1500);
}

function render() {
  renderStats();
  renderMemoryMap();
  renderHeatmap();
  renderTurnPills();
  renderQueryOutputs();
  renderInspector();
  renderEventLog();
  bindCitationButtons();
}

function renderStats() {
  const counts = countsByTier(state.chunks);
  const l1Tokens = state.chunks
    .filter((chunk) => chunk.tier === 1)
    .reduce((sum, chunk) => sum + chunk.tokens, 0);
  const age = formatAge(state.lastFieldUpdate);
  refs.stats.innerHTML = `
    <span><b>L1:</b> ${counts[1]} chunks</span>
    <span><b>L2:</b> ${counts[2]}</span>
    <span><b>L3:</b> ${counts[3]}</span>
    <span><b>L4:</b> ${counts[4]}</span>
    <span><b>Field update:</b> ${age}</span>
    <span><b>L1 budget:</b> ${l1Tokens.toLocaleString()}/4,096 tok</span>
    <span><b>Model:</b> ${state.apiConfigured ? state.apiModel : "not configured"}</span>
  `;
  refs.fieldAge.textContent = `field update: ${age}`;
}

function renderMemoryMap() {
  const counts = countsByTier(state.chunks);
  refs.tierLanes.innerHTML = "";
  for (const tier of [1, 2, 3, 4]) {
    const meta = TIER_META[tier];
    const lane = document.createElement("section");
    lane.className = `tier-lane tier-${tier}`;
    lane.style.setProperty("--tier-color", meta.color);
    lane.innerHTML = `
      <header class="tier-head">
        <div>
          <strong>${meta.label}</strong>
          <span>${meta.name}</span>
        </div>
        <div class="tier-metrics mono">
          <span>${meta.latency}</span>
          <span>${counts[tier]} chunks</span>
        </div>
      </header>
      <div class="chunk-list"></div>
    `;
    const list = lane.querySelector(".chunk-list");
    state.chunks
      .filter((chunk) => chunk.tier === tier)
      .sort((a, b) => b.gravity - a.gravity)
      .forEach((chunk) => list.appendChild(renderChunkCard(chunk)));
    refs.tierLanes.appendChild(lane);
  }
}

function renderChunkCard(chunk) {
  const card = document.createElement("button");
  const now = performance.now();
  card.type = "button";
  card.className = `chunk-card ${chunk.id === state.selectedId ? "selected" : ""} ${chunk.flashUntil > now ? "flash" : ""}`;
  card.style.setProperty("--tier-color", TIER_META[chunk.tier].color);
  card.style.setProperty("--gravity", `${Math.round(chunk.gravity * 100)}%`);
  card.addEventListener("click", () => {
    selectChunk(chunk.id);
    openChunkModal(chunk.id);
  });
  card.innerHTML = `
    <div class="chunk-line">
      <span class="mono chunk-id">${chunk.id}</span>
      <span class="token-badge mono">${chunk.tokens} tok</span>
    </div>
    <div class="gravity-track"><span></span></div>
  `;
  return card;
}

function renderHeatmap() {
  refs.heatmap.innerHTML = "";
  if (!state.chunks.length) {
    const statusText = state.lastStatus
      ? `status: configured=${String(state.lastStatus.configured)} model=${String(state.lastStatus.model)}`
      : "status: unknown";
    const errorText = state.lastSeedError ? `error: ${escapeHtml(state.lastSeedError)}` : "";
    refs.heatmap.innerHTML = `<div class="empty-heatmap">LLM seed memory unavailable<br><span class="mono">${escapeHtml(statusText)}</span>${errorText ? `<br><span class="mono">${errorText}</span>` : ""}</div>`;
    return;
  }
  state.chunks.forEach((chunk) => {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = `heat-cell ${chunk.gravity > 0.75 ? "pulse" : ""} ${chunk.id === state.selectedId ? "selected" : ""}`;
    cell.style.setProperty("--intensity", chunk.gravity.toFixed(3));
    cell.style.setProperty("--tier-color", TIER_META[chunk.tier].color);
    cell.title = `${chunk.id} gravity=${chunk.gravity.toFixed(2)} ${chunk.cluster}`;
    cell.addEventListener("click", () => {
      selectChunk(chunk.id);
      openChunkModal(chunk.id);
    });
    cell.innerHTML = `<span>${chunk.id}</span>`;
    refs.heatmap.appendChild(cell);
  });
}

function renderQueryOutputs() {
  refs.queryOutputs.innerHTML = "";
  if (!state.outputs.length) {
    refs.queryOutputs.innerHTML = `<div class="empty-output">Submit a query to see its synthesized output here.</div>`;
    return;
  }
  state.outputs.forEach((output, index) => {
    const card = document.createElement("article");
    card.className = "query-output";

    // Extract response chunks if available
    const answerChunks = output.answerChunks || [];
    const hasChunks = answerChunks.length > 0;

    card.innerHTML = `
      <div class="output-head">
        <strong class="mono">Q${String(state.outputs.length - index).padStart(2, "0")}</strong>
        <span>${escapeHtml(output.query)}</span>
      </div>
      <div class="output-body">
        <div class="output-section" style="--tier-color: var(--l3)">
          <div class="output-section-head" style="background: color-mix(in srgb, var(--l3) 12%, #0b111d); color: var(--l3)">USER QUERY</div>
          <div class="output-section-content">
            ${escapeHtml(output.query)}
          </div>
        </div>
        <div class="output-section" style="--tier-color: var(--l2)">
          <div class="output-section-head" style="background: color-mix(in srgb, var(--l2) 12%, #0b111d); color: var(--l2)">LLM RESPONSE</div>
          <div class="output-section-content">
            ${output.answerHtml}
          </div>
        </div>
        ${
          hasChunks
            ? `
        <div class="output-section" style="--tier-color: var(--l1)">
          <div class="output-section-head" style="background: color-mix(in srgb, var(--l1) 12%, #0b111d); color: var(--l1)">CONTEXT CHUNKS USED</div>
          <div class="output-chunk-list">
            ${answerChunks
              .map(
                (chunk, i) => `
              <div class="output-chunk-item" style="border-color: color-mix(in srgb, var(--l1) 30%, var(--line-soft)); background: color-mix(in srgb, var(--l1) 8%, #0b111d)">
                <div class="output-chunk-item-header">
                  <span class="output-chunk-id">${escapeHtml(chunk.id)}</span>
                  <span style="color: var(--muted); font-size: 8px">●</span>
                  <span style="color: var(--muted); font-size: 9px">${chunk.cluster}</span>
                </div>
                <div class="output-chunk-content">${escapeHtml(chunk.content.substring(0, 100))}${chunk.content.length > 100 ? "…" : ""}</div>
              </div>
            `,
              )
              .join("")}
          </div>
        </div>
        `
            : ""
        }
      </div>
    `;
    refs.queryOutputs.appendChild(card);
  });
}

function renderTurnPills() {
  refs.turnPills.innerHTML = "";
  const turns = state.turns.slice(-3);
  if (!turns.length) {
    refs.turnPills.innerHTML = `<span class="empty">No committed turns yet. Typing in the input will preview field gravity.</span>`;
    return;
  }
  for (const turn of turns) {
    const pill = document.createElement("div");
    pill.className = "turn-pill";
    pill.innerHTML = `<span>${turn.text}</span><strong class="mono">momentum: ${turn.momentum.toFixed(2)}</strong>`;
    refs.turnPills.appendChild(pill);
  }
}

function renderInspector() {
  const chunk =
    state.chunks.find((item) => item.id === state.selectedId) ||
    state.chunks[0];
  if (!chunk) {
    refs.selectedBadge.textContent = "none";
    refs.inspector.innerHTML = `<p>No chunks loaded. Configure <span class="mono">OPENAI_API_KEY</span> and restart the local server.</p>`;
    return;
  }
  refs.selectedBadge.textContent = chunk.id;
  refs.selectedBadge.style.borderColor = TIER_META[chunk.tier].color;
  refs.inspector.innerHTML = `
    <div class="inspect-id">
      <span class="mono">${chunk.id}</span>
      <strong style="color:${TIER_META[chunk.tier].color}">L${chunk.tier}</strong>
    </div>
    <p>${chunk.content.slice(0, 118)}...</p>
    <dl>
      <div><dt>cluster</dt><dd>${chunk.cluster}</dd></div>
      <div><dt>gravity</dt><dd class="mono glow" style="color:${TIER_META[chunk.tier].color}">${chunk.gravity.toFixed(3)}</dd></div>
      <div><dt>access count</dt><dd class="mono">${chunk.accessCount}</dd></div>
      <div><dt>last promoted</dt><dd class="mono">${formatStamp(chunk.lastPromotedAt)}</dd></div>
      <div><dt>tokens</dt><dd class="mono">${chunk.tokens}</dd></div>
    </dl>
    <div class="spark-wrap">
      <span class="mono">gravity last 8 turns</span>
      ${sparkline(chunk.gravityHistory, TIER_META[chunk.tier].color)}
    </div>
  `;
}

function renderEventLog() {
  refs.eventLog.innerHTML = "";
  state.events.slice(0, 80).forEach((event) => {
    const row = document.createElement("div");
    row.className = `event-row ${event.type.toLowerCase()}`;
    row.innerHTML = `<span>${event.time}</span><strong>${event.type}</strong><span>${event.target}</span><em>${event.detail}</em>`;
    refs.eventLog.appendChild(row);
  });
}


function selectChunk(id) {
  state.selectedId = id;
  renderInspector();
  renderHeatmap();
  renderMemoryMap();
  bindCitationButtons();
}

function openChunkModal(id) {
  const chunk =
    state.chunks.find((item) => item.id === id) ||
    state.committedChunks.find((item) => item.id === id);
  if (!chunk) return;
  refs.modalTitle.textContent = `${chunk.id} · ${chunk.cluster}`;
  refs.modalBody.innerHTML = `
    <div class="modal-meta">
      <span class="mono" style="color:${TIER_META[chunk.tier].color}">L${chunk.tier}</span>
      <span class="mono">gravity=${chunk.gravity.toFixed(3)}</span>
      <span class="mono">${chunk.tokens} tok</span>
      <span class="mono">access=${chunk.accessCount}</span>
    </div>
    <h3>Knowledge Held</h3>
    <p>${escapeHtml(chunk.content)}</p>
    <h3>Embedding Cluster</h3>
    <p>${escapeHtml(chunk.keywords.join(", "))}</p>
    <div class="modal-spark">${sparkline(chunk.gravityHistory, TIER_META[chunk.tier].color)}</div>
  `;
  refs.modal.showModal();
}

function bindCitationButtons() {
  document.querySelectorAll("[data-chunk-id]").forEach((button) => {
    button.addEventListener("click", () => {
      selectChunk(button.dataset.chunkId);
      openChunkModal(button.dataset.chunkId);
    });
  });
}

function addEvent(type, target, detail) {
  const elapsed = (performance.now() - state.startTime) / 1000;
  const time = `${elapsed.toFixed(1).padStart(4, "0")}s`;
  state.events.unshift({ type, target, detail, time });
}

function tierForGravity(gravity) {
  if (gravity > 0.8) return 1;
  if (gravity > 0.55) return 2;
  if (gravity > 0.2) return 3;
  return 4;
}

function countsByTier(chunks) {
  return chunks.reduce(
    (counts, chunk) => {
      counts[chunk.tier] += 1;
      return counts;
    },
    { 1: 0, 2: 0, 3: 0, 4: 0 },
  );
}

function cloneChunks(chunks) {
  return chunks.map((chunk) => ({
    ...chunk,
    vector: [...chunk.vector],
    keywords: [...chunk.keywords],
    gravityHistory: [...chunk.gravityHistory],
  }));
}

async function apiGet(path) {
  const response = await fetch(path);
  const json = await response.json();
  if (!response.ok)
    throw new Error(json.error || `Request failed: ${response.status}`);
  return json;
}

async function apiPost(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok)
    throw new Error(json.error || `Request failed: ${response.status}`);
  return json;
}

function sparkline(values, color) {
  const data = values.length ? values : [0, 0, 0, 0, 0, 0, 0, 0];
  const points = data
    .map((value, index) => {
      const x = 4 + index * (112 / Math.max(1, data.length - 1));
      const y = 38 - value * 34;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return `<svg class="sparkline" viewBox="0 0 124 42" role="img" aria-label="Gravity sparkline">
    <polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></polyline>
  </svg>`;
}

function formatStamp(value) {
  if (!value) return "never";
  return `${((value - state.startTime) / 1000).toFixed(1)}s`;
}

function formatAge(value) {
  if (!value) return "idle";
  const elapsed = Math.max(0, performance.now() - value);
  if (elapsed > 1000) return "more than 1 sec ago";
  return `${Math.round(elapsed)}ms ago`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function extractKeywords(text) {
  const stop = new Set([
    "about",
    "after",
    "again",
    "because",
    "before",
    "between",
    "could",
    "every",
    "their",
    "there",
    "these",
    "those",
    "through",
    "while",
    "would",
  ]);
  return Array.from(
    new Set(
      String(text)
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length > 4 && !stop.has(token)),
    ),
  ).slice(0, 8);
}

function estimateTokens(text) {
  return Math.ceil(String(text).split(/\s+/).filter(Boolean).length * 1.25);
}

function conceptBoost(text) {
  const unique = new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 5),
  );
  return Math.min(0.22, unique.size * 0.025);
}

function cosine(a, b) {
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  if (!aa || !bb) return 0;
  return dot / (Math.sqrt(aa) * Math.sqrt(bb));
}

function normalize(vector) {
  const magnitude = Math.sqrt(
    vector.reduce((sum, value) => sum + value * value, 0),
  );
  return magnitude ? vector.map((value) => value / magnitude) : vector;
}

function hash(value) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

function seeded(seed) {
  const x = Math.sin(seed * 999 + 17) * 10000;
  return x - Math.floor(x);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

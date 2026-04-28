const DEFAULT_DIMENSIONS = 96;
const DEFAULT_DECAY = 0.85;

export function createField({
  chunks,
  dimensions = DEFAULT_DIMENSIONS,
  decay = DEFAULT_DECAY,
  thresholds = { l1: 0.8, l2: 0.55, cold: 0.15 },
  now = () => Date.now()
} = {}) {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    throw new Error("createField requires at least one memory chunk.");
  }

  const state = {
    dimensions,
    decay,
    thresholds,
    clock: 0,
    lastTurnVec: null,
    turns: [],
    chunks: chunks.map((chunk, index) => normalizeChunk(chunk, index, dimensions)),
    now
  };

  return {
    get chunks() {
      return state.chunks;
    },
    get turns() {
      return state.turns;
    },
    update(text, metadata = {}) {
      return updateGravitationalField(text, state, metadata);
    },
    buildPromptContext(query, l1Budget = 1100) {
      return buildPromptContext(query, state.chunks, l1Budget);
    },
    snapshot() {
      return getFieldSnapshot(state);
    },
    reset() {
      state.clock = 0;
      state.lastTurnVec = null;
      state.turns = [];
      for (const chunk of state.chunks) {
        chunk.gravity = 0;
        chunk.tier = chunk.baseTier;
        chunk.lastPull = 0;
        chunk.history = [];
      }
    }
  };
}

export function updateGravitationalField(text, state, metadata = {}) {
  const turnVec = embed(text, state.dimensions);
  const prevVec = state.lastTurnVec || turnVec;
  const rawMomentum = 1 - cosineSimilarity(turnVec, prevVec);
  const conceptBoost = extractConcepts(text).length > 0 ? 0.12 : 0;
  const momentum = clamp(rawMomentum + conceptBoost, 0.08, 1);
  const time = state.clock++;

  state.lastTurnVec = turnVec;
  const turn = {
    id: `turn-${time + 1}`,
    text,
    vector: turnVec,
    momentum,
    time,
    concepts: extractConcepts(text),
    metadata
  };
  state.turns.push(turn);

  for (const chunk of state.chunks) {
    const pull = Math.max(0, cosineSimilarity(turnVec, chunk.embedding));
    chunk.lastPull = pull;
    chunk.gravity = clamp(chunk.gravity * state.decay + pull * momentum, 0, 1);
    chunk.tier = nextTier(chunk.gravity, chunk.tier, state.thresholds);
    chunk.history.push({ time, gravity: chunk.gravity, tier: chunk.tier, pull });
    if (chunk.history.length > 30) chunk.history.shift();
  }

  return {
    turn,
    promoted: state.chunks.filter((chunk) => chunk.history.at(-1)?.tier < chunk.history.at(-2)?.tier),
    hot: state.chunks.filter((chunk) => chunk.tier === 1).sort(byGravity)
  };
}

export function buildPromptContext(query, chunks, l1Budget = 1100) {
  const hot = chunks
    .filter((chunk) => chunk.tier === 1 || chunk.gravity > 0.5)
    .sort(byGravity);

  let used = 0;
  const context = [];
  for (const chunk of hot) {
    if (used + chunk.tokens > l1Budget && context.length > 0) continue;
    context.push({
      chunk,
      weight: chunk.gravity,
      role: context.length === 0 ? "primary" : "supporting",
      prominence: prominenceFor(chunk.gravity)
    });
    used += chunk.tokens;
    if (used >= l1Budget) break;
  }

  return {
    query,
    usedTokens: used,
    context,
    rendered: renderWeightedContext(context, query)
  };
}

export function renderWeightedContext(context, query) {
  const body = context.map(({ chunk, weight, prominence }) => {
    return `[${prominence} | gravity=${weight.toFixed(2)} | ${chunk.id}]\n${chunk.content}`;
  }).join("\n\n");

  return `${body}\n\nQUERY: ${query}`.trim();
}

export function getFieldSnapshot(state) {
  const tiers = [1, 2, 3, 4].map((tier) => ({
    tier,
    chunks: state.chunks.filter((chunk) => chunk.tier === tier).sort(byGravity)
  }));

  return {
    clock: state.clock,
    turns: state.turns.map(({ id, text, momentum, time, concepts }) => ({
      id,
      text,
      momentum,
      time,
      concepts
    })),
    tiers,
    chunks: state.chunks.slice().sort(byGravity).map((chunk) => ({
      id: chunk.id,
      title: chunk.title,
      content: chunk.content,
      topic: chunk.topic,
      gravity: chunk.gravity,
      tier: chunk.tier,
      baseTier: chunk.baseTier,
      tokens: chunk.tokens,
      lastPull: chunk.lastPull,
      history: chunk.history
    }))
  };
}

export function embed(text, dimensions = DEFAULT_DIMENSIONS) {
  const vector = new Float32Array(dimensions);
  const tokens = tokenize(text);

  for (const token of tokens) {
    const hash = hashString(token);
    const index = Math.abs(hash) % dimensions;
    const sign = hash % 2 === 0 ? 1 : -1;
    const weight = token.length > 6 ? 1.25 : 1;
    vector[index] += sign * weight;

    const secondary = Math.abs(hashString(`${token}:semantic`)) % dimensions;
    vector[secondary] += sign * 0.35;
  }

  return normalize(vector);
}

export function cosineSimilarity(a, b) {
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  if (aa === 0 || bb === 0) return 0;
  return dot / (Math.sqrt(aa) * Math.sqrt(bb));
}

export function extractConcepts(text) {
  const stop = new Set(["about", "again", "could", "every", "field", "from", "have", "into", "just", "like", "memory", "that", "this", "turn", "with", "would"]);
  return tokenize(text)
    .filter((token) => token.length > 5 && !stop.has(token))
    .slice(0, 8);
}

function normalizeChunk(chunk, index, dimensions) {
  const content = chunk.content || "";
  return {
    id: chunk.id || `chunk-${index + 1}`,
    title: chunk.title || `Chunk ${index + 1}`,
    topic: chunk.topic || "general",
    content,
    embedding: chunk.embedding || embed(`${chunk.title || ""} ${content}`, dimensions),
    gravity: chunk.gravity || 0,
    tier: chunk.tier || 4,
    baseTier: chunk.tier || 4,
    tokens: chunk.tokens || estimateTokens(content),
    lastPull: 0,
    history: []
  };
}

function nextTier(gravity, currentTier, thresholds) {
  if (gravity > thresholds.l1 && currentTier > 1) return 1;
  if (gravity > thresholds.l2 && currentTier > 2) return 2;
  if (gravity < thresholds.cold && currentTier < 4) return currentTier + 1;
  return currentTier;
}

function prominenceFor(weight) {
  if (weight > 0.75) return "CORE CONTEXT";
  if (weight > 0.5) return "SUPPORTING";
  return "BACKGROUND";
}

function byGravity(a, b) {
  return b.gravity - a.gravity;
}

function estimateTokens(text) {
  return Math.max(18, Math.ceil(text.split(/\s+/).filter(Boolean).length * 1.25));
}

function tokenize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function normalize(vector) {
  let magnitude = 0;
  for (const value of vector) magnitude += value * value;
  magnitude = Math.sqrt(magnitude);
  if (!magnitude) return vector;
  for (let i = 0; i < vector.length; i++) vector[i] = vector[i] / magnitude;
  return vector;
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash | 0;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

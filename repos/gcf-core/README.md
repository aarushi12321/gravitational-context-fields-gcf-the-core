# GCF Core

`@gcf/core` is the reusable engine behind the prototype. It models semantic memory as a set of chunks whose gravity changes after every conversational turn.

## What It Implements

- Deterministic local embeddings for zero-service demos.
- Momentum from turn-to-turn semantic direction changes.
- Exponential moving gravity per chunk.
- Tier promotion and demotion across L1, L2, L3, and L4.
- Prompt context harvesting from already-promoted hot chunks.
- Visualization-friendly snapshots.

## Core Loop

```js
const field = createField({ chunks });
field.update("Let's talk about cache prefetching and schedulers.");
const prompt = field.buildPromptContext("How would GCF reduce latency?");
```

Gravity is stored as one floating-point value per chunk. The engine keeps the latest turn vector and a short turn history for visualization, but the migration behavior itself depends on the running gravity value.

## Files

- `src/index.js` exports the full engine.
- `src/sample-memory.js` provides seeded memory chunks for demos.
- `src/self-test.js` verifies the basic gravity and prompt-packing behavior.

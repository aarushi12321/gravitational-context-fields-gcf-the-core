import { createField } from "../../gcf-core/src/index.js";
import { sampleChunks } from "../../gcf-core/src/sample-memory.js";

const turns = [
  "I want a semantic memory layer that behaves like a scheduler.",
  "It should prefetch chunks before the final user question arrives.",
  "Momentum should reward turns that introduce new concepts.",
  "How does this make retrieval latency feel close to zero?"
];

const field = createField({ chunks: sampleChunks });

for (const text of turns) {
  const { turn } = field.update(text);
  const hot = field.snapshot().chunks.slice(0, 5);
  console.log(`\nTurn: ${text}`);
  console.log(`Momentum: ${turn.momentum.toFixed(2)}`);
  for (const chunk of hot) {
    console.log(`  L${chunk.tier} ${chunk.gravity.toFixed(2)} ${chunk.title}`);
  }
}

console.log("\nRendered prompt context:\n");
console.log(field.buildPromptContext("Explain GCF in one paragraph.", 700).rendered);

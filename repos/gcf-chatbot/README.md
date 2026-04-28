# GCF Chatbot

This repo contains the interactive browser prototype.

## Features

- Chat interface driven by a local GCF memory field.
- Real-time visualization tab showing L1-L4 memory tiers.
- Momentum meter, turn trajectory, hot chunk list, and prompt preview.
- No remote model dependency; the assistant uses harvested GCF context to produce transparent demo responses.

## Run

From the workspace root:

```bash
cp .env.example .env
```

Then add your `OPENAI_API_KEY` to `.env`.

```bash
npm start
```

Then open `http://localhost:4176`.

If the key is missing, the UI intentionally loads no fake chunks and shows an API-needed state.

## How To Use

Ask about schedulers, prefetching, RAG, momentum, tier migration, latency, or prompt weighting. Then switch to the Field tab to watch chunks move upward as they gain gravity.

# Gravitational Context Fields

This workspace implements a complete local prototype of Gravitational Context Fields (GCF): a memory system where every chunk carries a continuously updated gravity score, migrates between memory tiers, and is harvested by the chatbot from a pre-warmed state.

## Repos

- `repos/gcf-core` is the reusable GCF engine: deterministic embeddings, momentum, gravity updates, tier migration, context packing, and diagnostics.
- `repos/gcf-chatbot` is the browser chatbot with two tabs: chat and real-time field visualization.
- `repos/gcf-lab` is a command-line simulator for watching chunks migrate through a scripted conversation.

## Run

Create a local `.env` from the example and add your OpenAI API key:

```bash
cp .env.example .env
```

Edit `.env`:

```bash
OPENAI_API_KEY=sk-your-key-here
OPENAI_MODEL=gpt-4.1-mini
```

Start the app:

```bash
npm start
```

Open `http://localhost:4176`.

The browser never receives your API key. The local Node server reads `.env` and calls the OpenAI Responses API from the backend.

Run the simulator:

```bash
npm run demo
```

Run the core self-test:

```bash
npm test
```

The implementation is intentionally dependency-free so the idea can be inspected, modified, and run without setup friction.

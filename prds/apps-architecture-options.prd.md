# Apps Architecture Options

## Context

Moldable apps live in `~/.moldable/shared/apps/` and run as local dev servers embedded in iframes. Users summon apps through conversation with an LLM, which writes the code.

**Key constraint:** LLMs write these apps, not humans. The architecture must optimize for:

1. LLM code generation quality (training data familiarity)
2. Local development experience (cold start, HMR)
3. Simplicity for personal-scale apps

---

## Options

### Option A: Next.js (Current Default)

**Pros:**

- LLMs are heavily trained on Next.js — high-quality code generation
- Full-featured: API routes, file-based routing, React Server Components
- Large ecosystem, well-documented patterns
- "Just works" for complex apps

**Cons:**

- Slow cold start (~3-5s) due to compilation
- Heavy runtime overhead for single-user local apps
- SSR/edge features are wasted locally
- Warmup required to avoid iframe load delays

### Option B: Vite + React

**Pros:**

- ~10x faster cold start (~300ms)
- Instant HMR
- Lighter resource usage
- Simpler mental model (no server/client boundary)

**Cons:**

- LLMs less fluent — more hallucinations, older patterns
- No built-in API routes (need Hono/Express/tRPC)
- Less "batteries included"

### Option C: Vite + React + Hono (Unified)

**Pros:**

- Fast like Vite, with API routes via Hono
- Single dev server possible
- Hono is tiny (~14kb) and fast

**Cons:**

- Non-standard setup — LLMs will struggle
- Requires custom scaffolding
- Less documentation to train on

### Option D: Static HTML + SQLite WASM

**Pros:**

- Zero build step, instant load
- Maximum simplicity
- Works offline, no server needed

**Cons:**

- LLMs generate poor vanilla JS (trained on frameworks)
- No component model
- Limited to simple apps

---

## Recommendation

**Stick with Next.js as the primary template.**

The LLM training data argument dominates. When Claude/GPT writes a Next.js app, it produces idiomatic, working code on the first try. When it writes Vite + custom backend, it often hallucinates imports, uses deprecated APIs, or creates non-working configurations.

**Mitigations for Next.js slowness:**

1. Pre-warm apps on Moldable launch (already implemented)
2. Use `turbopack` for faster dev builds (`next dev --turbo`)
3. Consider lighter alternatives for simple apps (future)

**Future consideration:** Create a `@moldable/vite-template` for power users who want speed over LLM reliability. But default to Next.js for the AI-generated path.

---

## Summary

| Factor           | Next.js | Vite   | Vite+Hono | Static |
| ---------------- | ------- | ------ | --------- | ------ |
| LLM code quality | ⭐⭐⭐  | ⭐⭐   | ⭐        | ⭐     |
| Cold start       | ⭐      | ⭐⭐⭐ | ⭐⭐⭐    | ⭐⭐⭐ |
| API routes       | ⭐⭐⭐  | ❌     | ⭐⭐      | ❌     |
| Ecosystem        | ⭐⭐⭐  | ⭐⭐   | ⭐        | ⭐     |

**Decision:** Next.js remains the default. Optimize startup with Turbopack and warmup. Revisit if LLM training catches up on Vite patterns.

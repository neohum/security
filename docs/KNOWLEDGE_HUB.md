# KNOWLEDGE_HUB.md — the central, cross-project memory

Every harnessed project writes what it learns to a shared **knowledge hub** so one
project's hard-won lesson becomes every project's starting context. The principle is
simple: **reuse instead of relearn.** A central hub only delivers that if it is read
as well as written — so the harness treats it as bidirectional.

## The two halves

| Direction | Who | Endpoint | Status |
| --------- | --- | -------- | ------ |
| **Write** (push) | `hub.ts` `pushToHub` (called by `knowledge.ts` `record`) | `POST /api/knowledge/ingest` | ✅ live |
| **Read** (recall) | `hub.ts` `searchHub` (called by `knowledge.ts` `recall`) | `GET /api/knowledge/search` | ✅ live |
| **Delete** (cleanup) | manual / admin (test & probe data) | `DELETE /api/knowledge/<id>`, `DELETE /api/knowledge?project=&tags=` | ✅ live |

Until the read endpoint exists, `recall` **degrades gracefully** to this project's
local `.harness/knowledge` store — and lights up across all projects automatically
the moment the hub ships the endpoint. Nothing in the loop breaks either way.

## Two streams: lessons vs the prompt trail

Not everything pushed to the hub is knowledge. The store carries two streams,
separated by tags, and **recall only serves the first**:

| Stream | Tags | Written by | Served by recall? |
| ------ | ---- | ---------- | ----------------- |
| **Lessons** — distilled "what worked / what trapped" | `lesson,auto,worked` / `lesson,auto,trapped`, plus manual `lesson,…` | `ralph-loop.ts` on every card finish (`done`/`failed`); validator/adversary agents and humans via `knowledge.ts add` | ✅ yes |
| **Prompt trail** — raw prompts archived by the `invoke-*` wrappers | `architect,prompt` / `typist,prompt` / `researcher,prompt` / `human,prompt` | `invoke-claude/codex/gemini/agy.ts`, agent human-input hooks | ❌ no (browse it on `/hub`; `assess-prompts.ts` mines it) |

`recall()` filters out any entry whose tags include `prompt` (over-fetching so
`limit` real lessons survive), and falls back to the local store with the same
filter. Pass `includeTrail: true` (API) only when you genuinely want the raw log.
This is what makes it safe for the loop to prepend recall to every build:
the builder sees lessons, not another project's prompt dumps.

**Design decisions are lessons too** — `design-orchestrator` / `design-evolve`
record adopted palettes, scales, language choices, and taste-tournament verdicts
with tags `design,decision,lesson` / `design,taste,lesson`, so cross-project
recall of "what design worked here" lights up the same way.

## Config (env)

```
WIKI_URL    CtrlCV Wiki base URL      (default: https://ctrlcv-wiki-production.up.railway.app)
WIKI_TOKEN  CtrlCV Wiki bearer token  (env-only, NOT baked in; unset => hub disabled)
HUB_URL     legacy alias for WIKI_URL (optional)
HUB_TOKEN   legacy alias for WIKI_TOKEN (optional)
KB_PROJECT  this project's name      (default: the project name)
```

## CLI

```bash
# write a lesson (also pushed to the hub)
node scripts/loop/knowledge.ts add --title "Stripe webhooks need idempotency keys" \
  --tags payments,gotcha --source day-human -- "Duplicate events double-charged in test"

# RECALL before building — hub-first across ALL projects, local fallback
node scripts/loop/knowledge.ts recall "stripe webhook idempotency"
node scripts/loop/hub.ts search "auth session handling"        # hub only, all projects
node scripts/loop/hub.ts search "auth session handling" --mine # hub only, this project

# CORRECT a lesson. Memory that can only grow cannot be fixed: an entry written
# from a wrong diagnosis keeps being recalled as true, and the loop reuses it
# instead of relearning — cross-project recall running in reverse.
# Only the fields you pass change; the rest of the entry is left alone.
node scripts/loop/knowledge.ts update 42 --title "…actually a clock-skew bug"
node scripts/loop/knowledge.ts update 42 --tags payments,gotcha,resolved -- "New body text"
node scripts/loop/knowledge.ts remove 42
```

`update` and `remove` are **local only.** The hub client is push/search, so a
correction here does not retract what was already pushed — fix the hub entry
there if it matters. Both fail loudly on an unknown id rather than reporting a
no-op as success.

## Read endpoint the hub needs to expose

Add this one route to the hub app to turn on cross-project recall. The harness
already calls it; it just 404s until it exists.

```
GET /api/knowledge/search?q=<text>&limit=<n>&project=<optional>
Authorization: Bearer <HUB_TOKEN>

200 OK -> JSON array (or { "entries": [ ... ] }) of:
  { "id", "project", "title", "body", "tags", "source", "card", "created_at" }
```

- `q` matches title/body/tags (case-insensitive substring is fine; full-text is better).
- Omit `project` to search across **all** projects — that cross-pollination is the
  whole value of the hub, and is the harness default.
- Same bearer auth as `/api/knowledge/ingest`. Keep it read-only.

Reference implementation (mirrors `knowledge.ts`'s local search), for a Next.js
route handler backed by the same store the ingest endpoint writes to:

```js
// GET /api/knowledge/search
export async function GET(req) {
  if (!authorized(req)) return new Response("unauthorized", { status: 401 });
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").toLowerCase();
  const project = searchParams.get("project");
  const limit = Math.min(Number(searchParams.get("limit")) || 10, 50);
  let rows = await store.all(); // {id,project,title,body,tags,source,card,created_at}
  if (project) rows = rows.filter((r) => r.project === project);
  rows = rows
    .filter((r) => [r.title, r.body, r.tags].some((s) => (s || "").toLowerCase().includes(q)))
    .sort((a, b) => b.id - a.id)
    .slice(0, limit);
  return Response.json(rows);
}
```

## Where recall is used in the loop

- **Before validating/building a card** — `validate-card.ts` recalls prior work on
  the same topic so the loop reuses solutions and avoids repeating known mistakes
  (see [`AUTONOMOUS_LOOP.md`](AUTONOMOUS_LOOP.md), "Validation gate").
- **Every build (on by default)** — `ralph-loop.ts` prepends recalled lessons to
  the builder's input. Opt out with `HUB_RECALL=0`.
- **Design harness** — `design-orchestrator` / `design-evolve` recall prior design
  decisions and accepted taste principles across projects before generating, and
  record the adopted decisions back (tags `design,decision,lesson`).

> The hub also serves humans at `/hub` (cross-project knowledge) and `/ops` (loop
> status). The API read endpoint above is the machine-readable counterpart so agents
> get the same recall a human gets from browsing `/hub`.

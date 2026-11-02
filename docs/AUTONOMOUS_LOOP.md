# AUTONOMOUS_LOOP.md — the always-on dev loop

This repo ships an **async, autonomous multi-agent dev loop**. It runs unattended on
an always-on Linux server while you (the human) are offline, and you supervise from
your phone over Telegram. You write intent in the morning; the agents turn it into
shipped, human-approved code through the day.

Design stance: **Linux-server-first, cross-platform-safe.** Scripts are plain Node
(`node:` builtins, no heavy deps) plus a `.sh`/`.ps1` pair for the health gate so the
same loop runs on the server and on your laptop.

## Lifecycle

```
   human writes spec.md (phone, morning)
              │
              ▼
   ┌──────────────────────┐
   │ lead: spec → cards    │   backlog.ts add
   │ (SQLite backlog)      │
   └──────────┬───────────┘
              ▼
   ┌──────────────────────────────────────────────┐
   │ per card, 4 roles run:                       │
   │                                              │
   │  lead → explorer → builder → reviewer        │
   │  (plan)  (map)     (code)    (verify)        │
   │                                              │
   │  claim-task.ts  (SQLite txn + git lock)     │
   │         │                                    │
   │         ▼                                    │
   │   iterate ──► health.sh + Playwright ──┐     │
   │     ▲         (gate, capped)           │     │
   │     └──── red: fix / escalate ─────────┘     │
   └──────────┬───────────────────────────────────┘
              │ green + reviewer sign-off
              ▼
        commit + push
              │
              ▼
   persona-approve.ts  (reuses review recommendation; separate judge is fallback)
              │
      ┌───────┴────────────────────────────────┐
      │ approve                                 │ escalate / reject
      │ (confident, low/med blast, non-sensitive)│ (uncertain / high-blast / sensitive)
      ▼                                         ▼
 deploy-railway.ts (auto)              deploy HELD (commit stays pushed)
      │                                         │
      ▼                                         ▼
 capture-screenshot ─► upload-wasabi ─► notify-telegram.ts
      │ (informational)                         │ (approval request, ✅ button)
      ▼                                         ▼
 ┌──────────────┐                     ┌───────────────────────┐
 │ human (opt): │                     │ human on phone:       │
 │  ↩ 반려 롤백  │                     │  ✅ 승인 → deploy      │
 └──────┬───────┘                     │  ↩ 반려 → 재개발       │
        │                             └──────────┬────────────┘
        └──────────► telegram-listener.ts ◄─────┘
                            │
              approve ──► deploy-railway.ts
              reject  ──► git revert + deploy (rollback & re-queue)
```

### Self-Assessment Loop
When the backlog is empty, `assess-shortcomings.ts` runs only when its shared cadence is due (24 hours by default). One swarm worker claims an owner-token `O_EXCL` lease, then the Codex assessment lane reads `.claude/persona.md` and audits the codebase and test results. It runs as a **structured devil's advocate** — it argues against the current direction (security exposure, missing regression tests, scope creep already shipped, compounding debt) rather than only confirming health, and writes an acceptance criterion into every card it queues. Failures retry after one hour. Wall-clock age never steals a live lease; after a verified process/host crash, remove the orphaned `.harness/shortcomings-assessment.lock` manually. Tune the cadence with `ASSESSMENT_INTERVAL_HOURS` and `ASSESSMENT_RETRY_HOURS`.

Once the loop reaches idle, it also launches `pain-point-scout.ts` as a detached
background subagent. The scout detects the service shape from
`.harness-service.json` and repository signals, inspects service-specific primary
user journeys, and queues only evidence-backed `high` or `blocker` findings. It
does not edit product code. A lock prevents overlapping scouts, the default
cooldown is 24 hours, and each run adds at most three findings. Set
`PAIN_POINT_SCOUT=0` to disable it; tune
`PAIN_POINT_INTERVAL_HOURS` and `PAIN_POINT_MAX_FINDINGS` as needed.

### Orca 24/7 factory supervisor

`factory.ts` composes the existing always-on loop into a complete product
factory without replacing its safety boundaries:

```text
Orca automation + built-in browser
  → market evidence → plan/acceptance contract
  → build ∥ independent test authoring → full test run → independent review
  → Wasabi evidence → persona-or-human gate
  → Railway staging → canary → production → Resend digest
```

Run `node scripts/loop/factory.ts plan` first. Then
`install-orca` idempotently registers the hourly Orca automation and `start`
launches the configured isolated swarm workers. `cycle` performs one strategic
intake/reporting pass. Orca orchestration owns the traceable task DAG; Ralph
continues to own atomic backlog claims, health checks, review and gated deploys.
Missing integration credentials degrade only that integration and are reported
by `plan`/`status`; secret values are never printed.

The scheduled prompt calls `factory.ts orchestrate`, which invokes
`orca orchestration run` and creates real task/dispatch/gate provenance instead
of treating the DAG as documentation. The process atomically acquires its
two-hour orchestration lease before making that blocking Orca call, so
simultaneous scheduler sessions cannot both enter the run. A scheduler session
that finds an active lease, or finishes its bounded run, reports once and exits
instead of remaining resident. Market, Wasabi, and Resend retry with bounded
exponential backoff and then degrade without stopping builds; Railway is never
retried automatically. Factory reports use content-addressed SHA-256 Wasabi
keys.

기본 공장은 Codex와 AGY 실행 레인을 격리한다. Codex가 리드·계획·주 구현·조율을
맡고 Claude는 최종 독립 리뷰에 집중한다. Independence is decided on a trust domain rather than an agent
name, so two lanes serving the same model weights count as one opinion and can
never review each other.

Commercial mode promotes staging → canary → production. Deploy and health must
pass at each stage before the next begins. Staging and production additionally
run the strict regression gate; a green command without an evidence reference
is still blocked. Every gate emits a `release.check` ledger row with status,
owner, observation time, evidence, approver, and block reason. Canary failure
never reaches production, and a failed production verification retains rollback
authority. A successful production release emits `hypercare.enter`; hypercare
may end only after its configured observation window, no open P0/P1 incidents,
and SLO evidence all pass `evaluateHypercareExit()`.

### Validate before building (keep sense-making ahead of building)
When AI makes building nearly free, the bottleneck moves from *can we build it* to *should we, and is it specified well enough to build once*. Two roles guard that, used by the **lead** before a card is queued:
- **validator** (`.claude/agents/validator.md`, `scripts/loop/validate-card.ts`) — recalls prior cross-project knowledge from the hub (reuse instead of relearn), sharpens vague intent into a testable change, and fixes the **acceptance criterion before** the builder starts. Verdict: go / sharpen / drop.
- **adversary** (`.claude/agents/adversary.md`) — a structured devil's advocate for high-stakes, irreversible, or scope-creep-smelling work, and for any "we have traction" claim. It steelmans the opposite, hunts disconfirming evidence, and returns holds / revise / pivot-stop. A false "go" costs far more than a false "stop", so it weights toward stopping when uncertain.

These embody the playbook discipline: validate before building, structured devil's advocate at every stage, and a measurement framework chosen up front instead of metrics cherry-picked after.

### Cross-project recall — the central hub, read as well as written
Every project writes to the shared hub (`knowledge.ts` → `hub.ts` → `POST /api/knowledge/ingest`), in two distinct streams:
- **Prompt trail** (tagged `prompt`) — the raw prompts the `invoke-*` wrappers archive. Kept for browsing/audit on `/hub` and for `assess-prompts.ts`, but **excluded from recall**: it is a log, not knowledge.
- **Lessons** (tagged `lesson`) — distilled one-liners of *what worked / what trapped*. The loop records one automatically when a card finishes (`done` or `failed`, see `runTask` in `ralph-loop.ts`); the validator/adversary agents and humans add more via `knowledge.ts add`.

The read half: `node scripts/loop/knowledge.ts recall "<topic>"` searches the hub across **all** projects (local fallback when the hub can't be read) and returns lessons only. The loop auto-prepends recalled prior knowledge to each build (**on by default**) so the builder reuses known solutions and sidesteps known traps. See [`KNOWLEDGE_HUB.md`](KNOWLEDGE_HUB.md).

Tuning knobs for the above:

```
HUB_RECALL=0     disable the cross-project recall prefix on builds (on by default)
VALIDATE_CARDS   reserved for an in-loop validation gate (the lead validates at queue time today)
HUB_URL / HUB_TOKEN / KB_PROJECT   hub connection (HUB_TOKEN is env-only, never baked in; unset => hub off)
```

### Self-Learning Designer (opt-in: `DESIGN_EVOLVE=1`)
> Requires the design subsystem, which ships only when the project was scaffolded
> with `--with-design` (7 agents, 8 skills, the `/design` commands). Without it
> `assess-design.ts` is still present and still inert, and the agents and skills
> named below simply do not exist — re-run the scaffolder with `--with-design` to
> add them.

When the backlog is empty and `DESIGN_EVOLVE` is set, the loop also runs `assess-design.ts`, which queues **one design-evolution round** (`design-evolve-round-N`). A builder then executes the `design-evolve` skill: it searches trends + your reference library, generates N deliberately diverse token variants, renders each to a preview and screenshots it, scores them with `design-critic` (contrast/math, an accessibility hard floor) + `taste-judge` (aesthetic, reading the growing `designer-persona.md`), runs a tournament, and **distills the win/loss into the LEARNED block of `designer-persona.md`** — so the taste grows one round per idle. This reuses the deploy-gate persona's textual-gradient-descent mechanism (`design-persona-synthesize.ts` mirrors `persona-synthesize.ts`) and the same Telegram tap path: a human is asked **only** when the top two variants are within 5 points (a maximally-informative active-learning sample). A design round is a **design artifact** (tokens + guide), not app code — its spec forbids touching application source, so the deploy gate has nothing to ship to production; a human adopts the tokens deliberately. The persona accumulates centrally in `PERSONA_HOME` (`~/.claude/persona/designer-persona.md`), so taste carries across projects. Knobs: `DESIGN_EVOLVE_VARIANTS` (default 4), `DESIGN_EVOLVE_MAX_PENDING` (default 1, prevents pile-up). See [`../.claude/skills/design-evolve/references/evolution-loop.md`](../.claude/skills/design-evolve/references/evolution-loop.md).

### Building the persona (the learning loop)
The persona that stands in for you is not just the static `persona.md` — it **learns from your decisions** so it needs your taps less and less. The mechanism is a closed feedback loop:

```
persona-approve  ─ predicts ─►  persona-feedback.jsonl  ◄─ labels ─  your ✅/❌ tap
        ▲                              │                              (telegram-listener)
        │                              ▼
   persona.md  ◄─ rewrites ─  persona-synthesize     persona-calibrate ─► calibrated p̂ + τ*
   (learned block)            (disagreements)        (Platt scaling)
```

- **The taps are the training signal.** Because the gate only escalates when it is *uncertain* (p≈0.5), every tap you make is a maximally-informative active-learning sample — `persona-feedback.ts` pairs it with what the persona predicted.
- **Cold-start is solved by history.** On startup `persona-bootstrap.ts` mines git (survived commits → approve, `git revert`-ed → reject) to seed the dataset with hundreds of free labels — no taps required.
- **Confidence is calibrated, the threshold is derived.** During idle, `persona-calibrate.ts` refits Platt scaling so the model's confidence becomes a real P(you approve); set `PERSONA_COST_ASK`/`PERSONA_COST_BAD` and the auto-approve bar becomes `τ* = 1 − C_ask/C_bad` instead of a guessed `0.8`.
- **The persona rewrites itself.** Once enough disagreements accrue (`PERSONA_SYNTH_MIN`, default 3), `persona-synthesize.ts` edits **only** the managed `LEARNED RULES` block in `persona.md` — your hand-written prose is never touched — prioritizing the costly false-approves.

Tuning knobs: `PERSONA_BOOTSTRAP=off`, `PERSONA_BOOTSTRAP_LIMIT`, `PERSONA_COST_ASK`, `PERSONA_COST_BAD`, `PERSONA_SYNTH_MIN`. The whole dataset lives in `.harness/persona-feedback.jsonl`; calibration params in `.harness/persona-calibration.json`.

## The four architecture layers under the loop

The loop's plumbing follows the current agent-engineering playbook — stateful
graphs, standardized tool/data schemas, isolated multi-agent swarms, and native
model scaffolding — each implemented dependency-free on top of `node:` builtins
rather than by adopting a framework.

### ① The per-card pipeline is a state graph (`graph.ts`)

The card lifecycle inside `ralph-loop.ts` is no longer one long hardcoded
function: it is a **declarative graph** of nodes and conditional edges over a
JSON-serializable state, executed by the checkpointing runtime in `graph.ts`
(the LangGraph idea, ~200 lines, zero deps):

```
prime ─▶ build ─▶ strictHealth ─▶ challenge ─▶ review ─▶ ship ─▶ END
          │ ▲                          │          │
          └─┘ retry (≤ maxIters)       │          └─▶ END (failed / cooldown)
                                       └─▶ END (mandatory high-risk challenge failure — never shipped)
```

What the graph buys over the old pipeline:

The independent reviewer is already adversarial on every card, so the separate
cross-model challenge is opt-in for normal risk (`FRAMEIN_CHALLENGE=1`). High-risk
or unscorable diffs always require it. A missing challenger, non-zero exit,
unparseable verdict, or `BLOCK` fails closed before review/ship; provider limits
yield the card for retry instead of bypassing the gate.

- **Crash-resume.** The state is checkpointed to `.harness/graph/<card>.json`
  after every node. If the loop process dies mid-card (crash, reboot, SIGTERM),
  the next claim resumes at the exact node — a card that had already built green
  goes straight back to review instead of rebuilding from scratch.
- **Time-travel.** Every step's snapshot is kept:
  `node scripts/loop/graph.ts history <card>` shows the trail,
  `node scripts/loop/graph.ts rewind <card> <step>` re-runs from any point
  (e.g. re-review without rebuilding). `list`, `show`, `clear` also exist.
- **A hard loop guard.** The build ⇄ health cycle is legal; an unbounded one is
  not — `maxSteps` cuts any wedged cycle and fails the card cleanly.

**Run the same pipeline interactively.** The as-is pipeline also ships as a
Claude Code Workflow, `.claude/workflows/card-pipeline.mjs` — in a Claude Code
session, ask for the `card-pipeline` workflow with `{ card, spec }` and one card
runs through the identical order and gates (validate/adversary → explore →
build ⇄ health capped at the same iteration budget → strict gate → adversarial
challenge with the high-risk BLOCK → read-only review). It deliberately has
**no ship node**: commit/push/deploy stays with the loop's persona deploy gate
or with you.

A **to-be** variant, `.claude/workflows/card-pipeline-tobe.mjs`, keeps the
identical order, gates, and bounds but makes each stage work by its senior
playbook — plan-first at validate, repo-recon at explore, tdd-loop /
debug-protocol / safe-refactor at build, self-review at review — and adds a
read-only **verify-done evidence gate** after reviewer approval: a card is
"ready" only when the build ran, tests passed, and the change was actually
exercised. Missing evidence rejects back into the *same* iteration budget, so
the extra gate never widens the loop. See `docs/HARNESS.md` for the
playbook-to-role map.

### ② Structured output everywhere (`schema.ts`)

Every place the loop asks a model for machine-readable output (the persona
verdict, the self-assessment card list) used to regex-scrape JSON and hand-check
fields. `schema.ts` centralizes that into the Pydantic-AI pattern:
robust extraction (fenced block → balanced scan → whole text), validation
against a JSON-Schema subset, and **one format-feedback retry** that tells the
model exactly which fields failed before the caller falls back to its
conservative floor. A partially valid assessment array is salvaged
item-by-item instead of thrown away.

### ②′ The harness speaks MCP (`mcp-harness.ts`)

The harness's own state — backlog, telemetry trail, cooldowns, framein risk
scoring, graph checkpoints — is exposed as a **local MCP server** registered in
`.mcp.json` as `harness`. Any MCP-capable agent (Claude Code, Codex, Gemini
CLI, …) can call `backlog_list`, `backlog_add`, `backlog_get`,
`backlog_set_status`, `loop_trail`, `cooldowns`, `risk_score`, and
`graph_state` as typed tools instead of shelling out to loop scripts and
parsing stdout. Zero deps: MCP's stdio transport is newline-delimited JSON-RPC.

### ③ Swarm mode — parallel workers in isolated checkouts (`swarm.ts`)

The claim protocol (SQLite txn + `O_EXCL` lock) was always race-safe; the
limit was two loops trampling one working tree. `swarm.ts` removes it:

```bash
node scripts/loop/swarm.ts start 3        # 3 workers, isolated clones
node scripts/loop/swarm.ts plan 3         # print the plan, run nothing
node scripts/loop/swarm.ts start 3 --fresh  # re-clone worker checkouts
```

Each worker is a **separate git clone** under `.harness/swarm/worker-N` (its
own working tree = its own builder sandbox), but shares the primary repo's
coordination state through two env vars every state module honors:

```
HARNESS_STATE_DIR   backlog, telemetry, cooldowns, framein, graph checkpoints
HARNESS_LOCK_DIR    the O_EXCL claim locks
```

Workers ship through the `origin` remote (one is required — pushing into a
non-bare checkout is a git error); push races are absorbed by a
rebase-and-retry in `commitAndPush`. Cooldowns are shared, so a rate limit hit
by one worker routes every worker off that provider.

### ③′ Per-card worktree isolation (`worktree.ts`, opt-in: `LOOP_WORKTREE=1`)

Swarm isolates **workers**; this isolates **cards**. One worker still runs its
cards one after another in the shared tree, so a card that yields on cooldown
leaves uncommitted edits sitting there — and a human editing the repo, or the
next card, absorbs them. With the flag on, each claimed card gets its own
branch and checkout:

```
branch    loop/<card>                 (LOOP_WT_BRANCH_PREFIX)
worktree  .harness/worktrees/<card>   (gitignored; LOOP_WT_DIR)
```

`prime` creates or reuses the pair and passes its path down the graph as
`workdir`; build, health, challenge, review, and WIP-save all run there. The
path doubles as the **sandbox root**, so the container mounts the card's
checkout as `/workspace` and the agent cannot see the main tree at all.

Shipping is what makes it parallel-safe. Without the flag, staging a held card
runs `git switch -c` in the shared tree and switches back — fine alone, a race
with anything concurrent. With it, the review branch is pushed straight from
the card's checkout, and an approved card is merged into the base with
`--no-ff` in the main tree, which **never changes branch**. A conflicting merge
is aborted (the main tree is never left mid-merge) and the card requeues; the
next `ensure` reproduces that conflict inside the worktree, where the builder
resolves it in its normal iterate→health loop.

The fork point is recorded in git config (`loop.worktree.<card>.base`) at
ensure time, so `integrate` can tell "the main tree moved" from "this is the
right target" — deriving it from the current HEAD would compare HEAD against
itself and never fire.

A fresh checkout has no `node_modules`; set `LOOP_WT_SETUP` (e.g.
`pnpm install`) if `HEALTH_INSTALL` does not already cover it. The two modes
compose: swarm workers may each run with `LOOP_WORKTREE=1`.

```bash
node scripts/loop/worktree.ts list
node scripts/loop/worktree.ts remove <card> --force   # abandon a parked card
```

### ④ Native scaffolding stance

Orchestration stays on the **model vendors' own CLIs** (`claude -p`,
`codex exec`, gemini/antigravity wrappers) with the fallback chain in the
agent session and builder roster — no third-party orchestration framework in the dependency
tree. The graph/schema/MCP layers above are thin, replaceable standards
(JSON-RPC, JSON Schema, a ~200-line graph walker), so when the vendors ship
these natively in their SDKs, each layer can be deleted, not migrated.

### ⑤ Observability — traces, breakpoints, and the studio dashboard

Debugging an agent means seeing every prompt call, state transition, tool
invocation, and loop/branch decision. The harness follows the custom-harness
playbook — emit OpenTelemetry-style spans internally, render them in a UI —
in two zero-dep modules:

**`trace.ts` — span tracing.** Every graph-node execution and every child
command the loop spawns (builder CLI, health gate, git) becomes a nested span;
one card = one trace, so the whole claim → build ⇄ health → review → ship
journey reads as a single timeline with durations and exit codes. Nesting is
automatic (`AsyncLocalStorage`), storage is SQLite + JSONL fallback under
`.harness/`, and `node scripts/loop/trace.ts tree <card>` prints the tree in
the terminal. Set `OTEL_EXPORTER_OTLP_ENDPOINT` and every span is also shipped
as OTLP/HTTP JSON — plug the loop into **Phoenix, Jaeger, or LangSmith** with
no code changes (best-effort: a dead collector never slows the loop).

**`dashboard.ts` — the local studio** (`node scripts/loop/dashboard.ts`,
then http://127.0.0.1:4780; binds localhost only):

- **Pipeline view** — the card state graph with the current node highlighted
  live from the graph checkpoints.
- **Span waterfall** — the nested execution timeline per card, errors in red.
- **Breakpoints** (LangGraph-Studio pattern) — click the dot on a node (or
  `graph.ts bp <card> <node>`, key `*` = every card) and the loop pauses
  **before** that node runs, parking the card as `paused` so it is never
  auto-resumed.
- **State editor** — inspect and patch the paused checkpoint's state (e.g.
  rewrite `feedback` or `builderInput`), then **▶ resume**: the node runs once
  with your edits and the breakpoint re-arms.
- **Time-travel** — every history step has a ⏪ rewind button (same engine as
  `graph.ts rewind`).
- **Screenshots** — the `.harness/shots` gallery: what the app looked like at
  each approval. (For deeper browser-agent observation, a headless-browser
  observability service like Browserbase/Stagehand can replace this — the
  Playwright capture step is the integration point.)

Knobs: `HARNESS_DASHBOARD_PORT` (default 4780), `OTEL_EXPORTER_OTLP_ENDPOINT`.

## Scripts in `scripts/loop/`

| Script                  | Role in the loop                                                         |
| ----------------------- | ------------------------------------------------------------------------ |
| `ralph-loop.ts`        | **main driver** — the always-on loop: pull → claim → run the card state graph → persona gate → deploy or hold |
| `graph.ts`             | **state-graph runtime** — checkpointed nodes/edges for the card pipeline; crash-resume, `history`/`rewind` time-travel, hard step cap |
| `schema.ts`            | **structured output** — JSON extraction + schema validation + format-feedback retry for every model-to-machine response |
| `mcp-harness.ts`       | **MCP server** — exposes backlog/trail/cooldowns/risk/graph state as typed MCP tools over stdio (registered as `harness` in `.mcp.json`) |
| `swarm.ts`             | **swarm runner** — N parallel loop workers in isolated clones sharing one backlog/lock/state surface via `HARNESS_STATE_DIR`/`HARNESS_LOCK_DIR` |
| `worktree.ts`          | **per-card isolation** (`LOOP_WORKTREE=1`) — each card gets `loop/<card>` + its own checkout; merges back with `--no-ff` without the main tree ever switching branch |
| `trace.ts`             | **span tracing** — nested OTel-style spans per card (node + tool level), SQLite/JSONL store, optional OTLP export to Phoenix/Jaeger/LangSmith |
| `dashboard.ts`         | **studio dashboard** — local web UI: live pipeline view, span waterfall, breakpoints, checkpoint state editor, rewind, screenshot gallery |
| `persona-approve.ts`   | **persona deploy gate** — decides *as the owner* (per `persona.md`) whether to auto-deploy or hold for a human tap; conservative floor escalates sensitive/uncertain changes |
| `persona-feedback.ts`  | **labeled dataset** — pairs each persona verdict with your actual tap (`.harness/persona-feedback.jsonl`); the active-learning signal the persona learns from |
| `persona-bootstrap.ts` | **behavioral cloning** — mines git history (survived=approve, reverted=reject) to seed the dataset with zero new taps |
| `persona-calibrate.ts` | **calibration** — Platt-scales the model's confidence into a real P(approve) and derives the deploy threshold from cost (`tau*=1-C_ask/C_bad`) |
| `persona-synthesize.ts`| **persona self-improvement** — rewrites the learned-rules block in `persona.md` from the cases where it disagreed with you |
| `spec-sync.ts`         | **intent → cards** — turns each `## Today` bullet in `spec.md` into a backlog card every tick; the card id is a slug + content hash, so re-syncing is a no-op and editing a bullet means new work |
| `plan-compile.ts`      | **plan → cards** — `Status: ready`, goal, `AC-*` acceptance, and `Tests` evidence are all mandatory; unverifiable cards are rejected |
| `plan-doc.ts`          | **계획서 → 카드 사슬** — one approved `plans/<slug>.plan.md` compiles into every step it declares, dependency-chained, with `Parallel: yes` steps sharing a wave; an invalid document compiles nothing ([`PLAN_DOCS.md`](PLAN_DOCS.md)) |
| `plan-gate.ts`         | **no plan, no risky build** — refuses a `Risk: medium\|high` card that no approved plan declares, before the worktree exists; `HARNESS_PLAN_GATE=off` is interactive-only |
| `evidence.ts`          | **verification on disk** — `evidence/<YYYYMMDD>-<card>/` with four mandatory sections plus a captured artifact; `verify` is a ship gate |
| `deps.ts`              | **ready set / waves** — actually reads `Dependencies:`, so a card is claimable only when its predecessors are `done`, and the ready set is the wave workers split between them |
| `assess-shortcomings.ts`| **self-assessment** — audits codebase against `.claude/persona.md` and queues shortcomings |
| `pain-point-scout.ts`   | **background user-pain scout** — detects the service type, audits primary journeys, and queues evidence-backed usability gaps |
| `factory.ts`            | **Orca 24/7 factory supervisor** — schedules the market→plan→build/test→review→artifact→gated deploy→notify DAG |
| `assess-market.ts`      | evidence-led market and competitor research that queues measurable opportunities |
| `notify-resend.ts`      | sends cycle/deployment digests through Resend |
| `assess-design.ts`     | **self-learning designer** (opt-in `DESIGN_EVOLVE=1`) — queues one `design-evolve` round per idle; the round distills taste into `designer-persona.md` |
| `hub.ts`               | **central hub client** — `pushToHub` (write) + `searchHub` (read, all projects); the bidirectional cross-project memory |
| `knowledge.ts`         | local knowledge store + `record` (write-through to hub) + `recall` (hub-first, local fallback) |
| `validate-card.ts`     | **validate-before-building** — recalls prior knowledge for a card and emits the acceptance-criteria contract the validator fills in |
| `backlog.ts`           | SQLite (JSON fallback) task backlog; the **lead** adds cards here         |
| `claim-task.ts`        | race-free two-phase claim: SQLite txn + `current_tasks/<card>.lock`       |
| `quality-contract.ts`  | parses frozen `AC-*` criteria, requires one evidenced reviewer result per criterion, and classifies failures |
| `quality-profile.ts`   | resolves required checks from `.harness-quality.json` and the changed paths |
| `health.sh` / `health.ps1` | fail-closed quality gate — required checks cannot be absent or skipped |

Failures persist a reproduction bundle under
`.harness/failures/<card>/<timestamp>/` (`contract.json`, environment,
commands/health feedback, checkpoint, and `git-diff.patch`). The same normalized
failure signature twice stops automatic retries early; a different failure may
continue up to `LOOP_MAX_ATTEMPTS`.
| `telemetry.ts`         | append-only action trail (SQLite + `current.md` human-readable fallback)  |
| `cooldown.ts`          | per-agent rate-limit tracking: records when each agent (claude/codex/antigravity/gemini) resets so the loop can route around limits and bring an agent back automatically |
| `lanes.ts`             | **recurring-job lanes** — 자체 점검·카드 분류·페르소나 학습은 Codex, 시장·고충·레이더 조사는 AGY. 작업별 재정의를 지원하며 최종 승인 게이트는 별도로 유지한다 |
| `mcp-registry.ts`      | **MCP server registry** — one view of which MCP servers each client (Claude `.mcp.json`, AGY `.agents/mcp_config.json`) exposes; add/remove keeps them in step, `doctor` catches a server whose command or script no longer resolves, `tools` prints the harness catalogue |
| `routing-report.ts`    | **model assignment view** — one command showing which lane each recurring job asks for, the builder roster, the audit lanes and the reviewer, plus live cooldowns. Composes; decides nothing |
| `data-contract.ts`     | pre-write guard; blocks DB-row shapes / storage paths that violate `AGENTS.md` |
| `capture-screenshot.ts`| Playwright screenshot of the running app for the mobile approval          |
| `upload-wasabi.ts`     | uploads the screenshot to Wasabi (S3-compatible) and returns a URL        |
| `notify-telegram.ts`   | sends the screenshot + summary to your phone with rollback/logs buttons  |
| `telegram-listener.ts` | listens for your tap; reject triggers git revert + deploy rollback        |
| `deploy-railway.ts`    | non-interactive, environment-scoped Railway promotion (staging/canary/production) |
| `cross-build-wails.sh`  | cross-compiles the Wails desktop build (cross-platform output)            |

## Required environment

Set these on the server (and locally for testing). The loop reads them from the
environment — never commit them.

| Var                  | Used by                                  | What it is                                            |
| -------------------- | ---------------------------------------- | ----------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN` | `notify-telegram.ts`, `telegram-listener.ts` | bot token for the approval channel              |
| `TELEGRAM_CHAT_ID`   | `notify-telegram.ts`, `telegram-listener.ts` | the chat to message (your DM with the bot)      |
| `WASABI_ACCESS_KEY`  | `upload-wasabi.ts`                      | Wasabi access key                                     |
| `WASABI_SECRET_KEY`  | `upload-wasabi.ts`                      | Wasabi secret key                                     |
| `WASABI_BUCKET`      | `upload-wasabi.ts`                      | bucket for approval screenshots                       |
| `WASABI_REGION`      | `upload-wasabi.ts`                      | Wasabi region / endpoint                              |
| `RAILWAY_STAGING_TOKEN` | `deploy-railway.ts`                  | staging project/environment-scoped token |
| `RAILWAY_CANARY_TOKEN` | `deploy-railway.ts`                   | canary project/environment-scoped token |
| `RAILWAY_TOKEN`      | `deploy-railway.ts`                     | production project/environment-scoped token |
| `STAGING_HEALTH_URL` | `verify-deployment.ts`                  | staging health endpoint |
| `CANARY_HEALTH_URL`  | `verify-deployment.ts`                  | canary health endpoint |
| `FACTORY_HEALTH_URL` | `verify-deployment.ts`                  | production health endpoint |
| `RESEND_API_KEY`     | `notify-resend.ts`                       | Resend restricted API key |
| `FACTORY_EMAIL_FROM` | `notify-resend.ts`                       | verified sender address |
| `FACTORY_EMAIL_TO`   | `notify-resend.ts`                       | comma-separated operations recipients |

## Rate-limit handling (zero-touch agent rotation)

The loop never stops just because one provider hits a subscription/rate limit. When
an agent CLI returns a limit (`limit|quota|rate|subscription|429|too many requests`):

1. **Save first.** The working tree is committed as `wip:<card>` so no progress is
   lost — the limited iteration is never "burned."
2. **Record the reset time.** `cooldown.ts` parses the reset time out of the CLI's
   own message, tuned to the **actual Claude Code limit strings**, most-precise first:
   - headless epoch — `Claude AI usage limit reached|1749924000` (exact, UTC seconds)
   - full sentence + IANA tz — `Claude usage limit reached. Your limit will reset at 3pm (America/New_York)` (resolved in that zone)
   - status line — `5-hour limit reached ∙ resets 5am` / `… - resets 3pm` (both `∙` and `-`)
   - weekly — `Opus weekly limit reached ∙ resets Oct 6, 1pm`
   - 429 wrapped — `rate_limit_error … retry-after: 3600` (seconds)
   - generic fallbacks — ISO timestamp, bare clock time, `try again in 2h 30m`

   If none is parseable it falls back to the documented window per provider
   (Claude/Codex ~5h, Gemini/Antigravity ~24h). State lives in `.harness/cooldown.json`.
3. **Route around it.** The next build iteration picks the first eligible agent in
   the roster that is **not** in cooldown — Codex → Antigravity →
   Gemini → Claude by default
   (override with `LOOP_BUILDERS`). The reviewer does the same: if Claude is limited,
   review falls back to any available agent.
4. **Resume automatically.** If **every** agent is cooling down, the task is
   WIP-saved, requeued (`open`), and the loop sleeps until the **soonest** reset
   (capped at 1h so a bad parse can't wedge it for a day), then resumes — no human
   needed. Cooldowns are pruned the moment they expire, so each agent returns to its
   primary role on its own.

```
LOOP_BUILDERS   override the builder roster (comma-separated commands; default:
```

### Recurring jobs run on the unmetered lane (`lanes.ts`)

The loop's ongoing cost is not the work you asked for. It is the jobs that run on a
timer whether or not anything happened — the idle shortcomings audit, the market
scan, prompt triage, pain-point scouting, the session radar, persona synthesis.
Each of those used to hardcode its own `--agent`, so moving them meant editing six
files.

공유 테이블 `lanes.ts`에서 자체 점검(assessment)·카드 분류(prompts)·페르소나
학습(persona)은 **codex**, 시장(market)·고충(painPoints)·레이더(radar) 조사는
**agy**로 배정한다. 자체 점검은 최종 독립 리뷰를 대체하지 않는다. 첫 요청 레인만
선택하므로 제한·부재 시 위 폴백을 따르며 Claude는 마지막에 사용한다.

```
HARNESS_RECURRING_LANE   move every recurring job to one lane (e.g. codex)
HARNESS_LANE_<JOB>       move one job — ASSESSMENT, MARKET, PROMPTS,
                         PAIN_POINTS, RADAR, PERSONA
```

**Gate decisions never come through here.** The reviewer's verdict and the persona
deploy gate keep their own lane, because AGENTS.md requires the reviewer to be a
different provider than the builder. Routing both through one cheap lane would
collapse that into a model agreeing with itself — cheapness is not a reason to let
a build approve itself.

The reset times you asked to "기록" live in `.harness/cooldown.json`; the live trail
(`current.md`) logs every cooldown set and every "sleeping Ns" yield.

## Human interaction windows

The loop is async on purpose: it works while you can't, and asks for the minimum when
you can. Your **persona stands in for you at the deploy gate** (`persona-approve.ts`),
so most decisions never reach your phone — only the ones the persona deliberately
escalates do. Energy is irregular, so the touch-points are small and time-boxed.

- **Weekday 07:00–08:00 — direction (phone).** Write/edit `spec.md` for the day. This
  is the only window where you set what gets built. Both `spec.md` and `plan.md` ship with
  their format explained by example, and **both parsers strip HTML comments
  first**, so those examples are inert: a fresh project idles at `backlog empty —
  nothing to do` until you write a bullet or a card outside the comment. An
  unterminated comment discards everything after it — that is how it renders, and
  opening work from a half-written note is the worse failure.
  설계가 필요한 일은 이 창에서 **계획서 한 장**으로 쓴다:
  `node scripts/loop/plan-doc.ts init <slug>` → 채우고 → `check` → `status: approved`.
  그러면 그 문서가 순서를 갖춘 카드 전체로 컴파일되므로, 기능 하나를 위해 카드를
  다섯 번 적을 필요가 없다 ([`PLAN_DOCS.md`](PLAN_DOCS.md)).
- **Weekday 08:00–16:30 — exceptions only (mobile).** During teaching hours the persona
  auto-ships routine changes for you. You tap ✅/❌ **only** on the cards the persona
  *held* (sensitive areas, high blast radius, low confidence). No typing, no review.
- **Weekend 07:00–11:00 — harness tuning.** Adjust the iteration cap, conventions in
  `CLAUDE.md`, the data contract in `AGENTS.md`, the escalation rules + threshold in
  `persona.md` (`PERSONA_APPROVE_THRESHOLD`), and review the `current.md` trail to audit
  what the persona approved on your behalf.

Outside these windows the loop keeps running; auto-approved changes ship, and anything
the persona held simply waits in the queue until you tap.

> **Tuning the gate.** `PERSONA_APPROVE_THRESHOLD` (default `0.8`) is the confidence bar
> for an autonomous deploy. Set `PERSONA_APPROVE=off` to disable the gate entirely and
> revert to legacy auto-deploy-on-sign-off. The persona's verdict for every card is
> normally produced in the independent review response and recorded in the
> `current.md` trail (`actor: persona`). Old checkpoints and direct CLI callers
> retain the separate persona-judge fallback.

## See also

- [`../AGENTS.md`](../AGENTS.md) — the master role contract and data contract
- [`../spec.md`](../spec.md) — your morning intent input
- [`../current.md`](../current.md) — the live action trail (telemetry fallback)
- [`./HARNESS.md`](./HARNESS.md) — the interactive (non-autonomous) 3-agent router

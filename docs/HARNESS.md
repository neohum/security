# HARNESS.md — how this multi-agent harness works

이 프로젝트는 Codex 중심 라우터와 Codex·Claude Code·AGY 네이티브 어댑터를 제공한다.
Codex가 리드·설계·구현을 맡고 Claude는 최종 독립 리뷰에 집중한다:

```
       user / native client
              │
              ▼
   ┌───────── route.ts ─────────┐
   │  heuristic task router       │
   └──────┬──────────┬───────────┘
          │          │
    ┌──────▼──┐  ┌──────▼──────┐  ┌──────────┐
    │architect│  │ researcher  │  │  typist  │
    │ (codex) │  │    (agy)    │  │  (codex) │
    └─────────┘  └─────────────┘  └──────────┘
```

## Two role systems — don't confuse them

This project has **two separate sets of agent roles** that serve different
purposes. They use different names on purpose; a task belongs to exactly one.

| System | Roles | Where it lives | When it runs |
| ------ | ----- | -------------- | ------------ |
| **Interactive router** (this doc) | `architect` · `researcher` · `typist` · `builder` | `scripts/route.ts`, `.claude/agents/`, `.codex/agents/`, `.agents/agents/` | on demand, for one task you hand it — the only explicit cross-CLI bridge |
| **Autonomous loop pipeline** | `lead` · `explorer` · `builder` · `reviewer` (with `validator` · `adversary` gates before a card is queued) | `AGENTS.md` + `scripts/loop/` | unattended, always-on; drives cards through build→health→review→ship |

The router picks **one** agent to help with **one** interactive task. The loop
pipeline is the **unattended** assembly line — a different concern with its own
vocabulary (see `docs/AUTONOMOUS_LOOP.md`). `scripts/route.ts` bridges CLIs only
for the router; the loop coordinates through git + the SQLite backlog instead.

## Files that drive it

| File                              | Role                                             |
| --------------------------------- | ------------------------------------------------ |
| `AGENTS.md`                       | shared contract; loaded by Codex and AGY          |
| `CLAUDE.md`                       | Claude adapter; imports `AGENTS.md`               |
| `lat.md`                          | code-graph / file-level map of the repo          |
| `DESIGN.md`                       | UI/UX system contract                            |
| `.claude/agents/*.md`             | per-agent identity & lane                        |
| `.claude/commands/*.md`           | slash commands (`/route`, `/analyze`, `/design`) |
| `.claude/settings.json`           | allowed shell commands                           |
| `.claude/workflows/card-pipeline.mjs` | the loop's card pipeline as a Claude Code Workflow (interactive, no ship) |
| `.claude/workflows/card-pipeline-tobe.mjs` | the to-be pipeline: same gates + senior playbooks per stage + verify-done evidence gate |
| `.claude/skills/`                 | Claude-native skills, incl. lead/reviewer playbooks (`plan-first`, `self-review`, `verify-done`, `git-hygiene`) |
| `.agents/skills/`                 | shared skills (Codex + AGY), incl. explorer/builder playbooks (`repo-recon`, `tdd-loop`, `debug-protocol`, `safe-refactor`) |
| `.codex/agents/*.toml`            | Codex-native custom agents                       |
| `.codex/config.toml`              | Codex-native project MCP and agent settings      |
| `.agents/agents/*/agent.md`       | AGY-native custom agents                         |
| `.agents/mcp_config.json`         | AGY-native workspace MCP servers                 |
| `.mcp.json`                       | Claude-native MCP servers                        |
| `scripts/route.ts`               | picks an agent for a task                        |
| `scripts/agent-session.ts`       | runs a task and switches provider/model on usage limit |
| `scripts/invoke-{claude,codex,agy}.ts` | thin CLI wrappers                               |

## Daily usage

```bash
# 1. see which agent handles a task
node scripts/route.ts "rename FooBar to FooBaz across lib/"

# 2. run it
node scripts/route.ts "rename FooBar to FooBaz across lib/" --run

# 3. force a specific agent
node scripts/route.ts "draft a migration plan for auth" --agent=architect --run

# 4. start with any provider and fail over automatically if it reaches a limit
node scripts/agent-session.ts "implement the approved task" # 기본 Codex
```

`agent-session.ts` is the required entry point for cross-provider failover.
Starting `claude`, `codex`, `agy`, or `gemini` directly leaves that process outside
the harness, so its session cannot be switched automatically. A handoff preserves
the original task, the limited provider's final output, and the current Git
status/diff; it starts a new native CLI session rather than transferring a
provider-private conversation ID.

For long-running Ralph/swarm workers, the session runner is intentionally invoked
with `--same-provider-only`: it tries `<PROVIDER>_FALLBACK_MODELS` first, then the
loop records the true provider cooldown and hands the card to a different provider.
This keeps a builder from reviewing its own handoff work.

Cross-provider execution is token-aware: the requested provider stays first,
then Codex/AGY/Gemini are exhausted before Claude
unless the session explicitly started with Claude. Ordinary command or test
failures stop in place and are not mistaken for provider limits. Claude stays
the final independent reviewer; on normal-risk cards that one structured
response also carries the persona deploy recommendation. High-risk cards retain
the mandatory extra challenger and deterministic human-approval floor.

In Claude Code, the same actions are available as slash commands:
`/route`, `/analyze`, `/design`.

When you work directly in Claude Code, Codex, or AGY, stay on that client's
native agent surface. The cross-CLI router is an explicit opt-in for tasks where
you intentionally want another provider to take a lane.

## Senior playbooks — which role reads which skill

Eight portable engineering playbooks (from
[senior-agent-skills](https://github.com/adityaarakeri/senior-agent-skills))
ship with the harness, placed where the consuming role's CLI discovers them
natively:

| Playbook         | Role (lane)          | Location                              | When it applies |
| ---------------- | -------------------- | ------------------------------------- | --------------- |
| `plan-doc`       | Codex lead / architect | `.agents/skills/plan-doc/`          | 3+ files, public APIs, schemas, auth, billing, CI — plan before queueing |
| `repo-recon`     | explorer             | `.agents/skills/repo-recon/`          | map the repo before any card touches it |
| `tdd-loop`       | builder              | `.agents/skills/tdd-loop/`            | behavior changes & bug fixes — failing test first |
| `debug-protocol` | builder              | `.agents/skills/debug-protocol/`      | a gate is red — reproduce, hypothesize, fix the root cause |
| `safe-refactor`  | builder              | `.agents/skills/safe-refactor/`       | restructuring cards — behavior-preserving verified steps |
| `self-review`    | reviewer             | `.claude/skills/self-review/`         | reading the diff before a verdict |
| `verify-done`    | reviewer             | `.claude/skills/verify-done/`         | before sign-off — evidence, not assumption |
| `git-hygiene`    | reviewer             | `.claude/skills/git-hygiene/`         | the commit/push step — atomic, no destructive git |

The **to-be card pipeline** (`.claude/workflows/card-pipeline-tobe.mjs`) runs
one card through the same order, gates, and bounds as the as-is
`card-pipeline`, with each stage working by its playbook and reviewer approval
additionally gated on `verify-done` evidence. Shipping stays outside the
workflow either way.

## Optional add-on: a code knowledge graph (graphify)

[graphify](https://github.com/Graphify-Labs/graphify) parses a codebase with
tree-sitter into a queryable `calls`/`imports`/`inherits`/`mixes_in` graph.
Nothing here installs or requires it; it is a pointer, like the other optional
tools the harness deliberately leaves out.

**Worth it when** you applied the harness to an existing or legacy repo with
`--update` and the explorer keeps burning tokens rediscovering the same call
graph. **Not worth it** on a freshly scaffolded project — a graph of an empty
repo tells you nothing.

```bash
uv tool install graphifyy        # the PyPI package is graphifyy, the command is graphify
graphify install                 # register the /graphify skill with your assistant
graphify hook install            # optional: rebuild the graph on each git commit
```

Then `/graphify .` builds `graphify-out/` (`graph.json`, `GRAPH_REPORT.md`,
`graph.html`). Add `graphify-out/` to `.gitignore` — it is a build artifact.

Where it plugs in: the **repo-recon** playbook
(`.agents/skills/repo-recon/SKILL.md`) has an optional first step that queries
the graph to decide *where to read*, which both explorer lanes follow. That is
the only integration point.

**Do not wire it into any gate.** Not `health.sh`, not the reviewer sign-off,
not `framein.ts risk`, not `persona-approve.ts`. The graph is a snapshot of
the last build, so a stale one produces a confidently wrong blast radius — and a
gate that trusts it fails open exactly when the code moved fastest. It also
carries `INFERRED` edges that are resolution guesses, and its own published
retrieval benchmark — LOCOMO recall@10 of 0.497 — misses more than it finds.
Use it to aim attention, never to decide.

Requires Python ≥ 3.10 and `uv`, which the harness otherwise does not — on a
Windows box or a bare Linux loop server, check that before depending on it.

## Adding a new MCP server

Add the server to the native config for every client that should expose it:

- Claude Code: `.mcp.json`
- Codex: `.codex/config.toml`
- AGY: `.agents/mcp_config.json`

Keep credentials in environment variables and restart the client after changes.

## Adding a new agent

1. Add the role in each client-native location that should expose it:
   `.claude/agents/<name>.md`, `.codex/agents/<name>.toml`, and
   `.agents/agents/<name>/agent.md`.
2. Add a signal block to `scripts/route.ts` so it can be routed automatically.
3. Optionally add `scripts/invoke-<name>.ts` if it wraps an external CLI.

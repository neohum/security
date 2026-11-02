// goal-anchor.ts — Immutable Goal Anchor layer inspired by OpenGoal & nulnul-harness.
//
// In long multi-turn agent loops or large-context autonomous execution, models
// tend to suffer from context drift or goal erosion — gradually relaxing safety
// checks, expanding blast radius, or dropping acceptance criteria.
//
// The Goal Anchor is an immutable prompt header block placed at the highest-salience
// position of the agent's context. It hard-pins:
//   1. Core Intent (What must be accomplished and WHY)
//   2. Architectural & Operational Invariants (Non-negotiables that cannot be bypassed)
//   3. Scope & Boundary Constraints (Declared files, forbidden paths, Non-Goals)
//   4. Acceptance Criteria (Verifiable AC-* checklist)
//
// Benchmark references:
// - opellen/OpenGoal: Immutable goal anchoring against context compression
// - SeoNaRu/nulnul-harness: Strict invariants and fail-closed gate enforcement

import type { Card } from "./agent-policy.ts";
import type { PlanDoc, PlanStep } from "./plan-doc.ts";

export const GOAL_ANCHOR_HEADER = "================================================================================";
export const GOAL_ANCHOR_START = "[IMMUTABLE GOAL ANCHOR — DO NOT REMOVE OR COMPROMISE]";
export const GOAL_ANCHOR_END = "[END GOAL ANCHOR — STRICT COMPLIANCE MANDATORY]";

export const DEFAULT_INVARIANTS = [
  "Immutable Intent: Do not drop, dilute, or silently alter the stated Intent under any circumstance.",
  "Anti-False Consensus: Review and audit must remain strictly independent of the builder domain.",
  "No Evidence, No Ship: Every acceptance criterion (AC-*) must have verifiable test/execution proof on disk.",
  "Bounded Blast Radius: Touch only declared and allowed files; non-goals and forbidden paths are strictly off-limits.",
  "Fail-Closed Safety: Halt and alert on gate failures or ambiguities rather than silently bypassing them.",
] as const;

export interface GoalAnchorScope {
  files?: string[];
  allowed?: string[];
  forbidden?: string[];
  nonGoals?: string[];
  [key: string]: unknown;
}

export interface GoalAnchorContext {
  card?: string;
  planSlug?: string;
  intent: string;
  invariants?: string[];
  scope?: GoalAnchorScope;
  acceptanceCriteria?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Renders a standardized, immutable goal anchor prompt block.
 * This block is guaranteed to contain all critical requirements and constraints.
 */
export function renderGoalAnchor(context: GoalAnchorContext): string {
  const intent = (context.intent || "").trim() || "(No explicit intent provided — maintain existing behavior)";
  const invariants = (context.invariants && context.invariants.length > 0)
    ? context.invariants
    : [...DEFAULT_INVARIANTS];

  const lines: string[] = [
    GOAL_ANCHOR_HEADER,
    GOAL_ANCHOR_START,
    GOAL_ANCHOR_HEADER,
  ];

  if (context.card || context.planSlug) {
    const metaParts: string[] = [];
    if (context.planSlug) metaParts.push(`Plan: ${context.planSlug}`);
    if (context.card) metaParts.push(`Card: ${context.card}`);
    lines.push(`📌 CONTEXT: ${metaParts.join(" | ")}`, "");
  }

  lines.push("🎯 CORE INTENT (IMMUTABLE GOAL):");
  lines.push(`   ${intent.replace(/\n/g, "\n   ")}`, "");

  lines.push("🛡️ ARCHITECTURAL & OPERATIONAL INVARIANTS:");
  invariants.forEach((inv, idx) => {
    lines.push(`   ${idx + 1}. ${inv}`);
  });
  lines.push("");

  // Scope & Boundaries
  const scope = context.scope || {};
  const targetFiles = Array.from(new Set([...(scope.files || []), ...(scope.allowed || [])]));
  const forbiddenFiles = scope.forbidden || [];
  const nonGoals = scope.nonGoals || [];

  lines.push("🚧 OPERATIONAL SCOPE & BOUNDARIES:");
  if (targetFiles.length > 0) {
    lines.push(`   - Allowed / Target Files: ${targetFiles.join(", ")}`);
  } else {
    lines.push("   - Allowed / Target Files: (Unspecified — operate minimally within current task)");
  }

  if (forbiddenFiles.length > 0) {
    lines.push(`   - Forbidden Paths (DO NOT TOUCH): ${forbiddenFiles.join(", ")}`);
  }

  if (nonGoals.length > 0) {
    lines.push("   - Non-Goals (Explicitly Out of Scope):");
    nonGoals.forEach((ng) => {
      lines.push(`     * ${ng}`);
    });
  }
  lines.push("");

  // Acceptance Criteria
  const acs = context.acceptanceCriteria || [];
  if (acs.length > 0) {
    lines.push("📋 ACCEPTANCE CRITERIA (AC):");
    acs.forEach((ac) => {
      lines.push(`   - [ ] ${ac}`);
    });
    lines.push("");
  }

  lines.push(GOAL_ANCHOR_HEADER);
  lines.push(GOAL_ANCHOR_END);
  lines.push(GOAL_ANCHOR_HEADER);

  return lines.join("\n");
}

/**
 * Checks if a given prompt text already contains the immutable goal anchor block.
 */
export function hasGoalAnchor(prompt: string): boolean {
  if (!prompt || typeof prompt !== "string") return false;
  return prompt.includes(GOAL_ANCHOR_START) && prompt.includes(GOAL_ANCHOR_END);
}

/**
 * Extracts the goal anchor block from a prompt if present.
 */
export function extractGoalAnchor(prompt: string): string | null {
  if (!hasGoalAnchor(prompt)) return null;
  const startIdx = prompt.indexOf(GOAL_ANCHOR_HEADER);
  const endMarkerIdx = prompt.indexOf(GOAL_ANCHOR_END);
  if (startIdx === -1 || endMarkerIdx === -1) return null;

  const afterEnd = prompt.indexOf(GOAL_ANCHOR_HEADER, endMarkerIdx + GOAL_ANCHOR_END.length);
  if (afterEnd === -1) {
    return prompt.slice(startIdx, endMarkerIdx + GOAL_ANCHOR_END.length).trim();
  }
  return prompt.slice(startIdx, afterEnd + GOAL_ANCHOR_HEADER.length).trim();
}

/**
 * Attaches or updates the goal anchor block at the very top (highest salience position)
 * of the prompt. If an anchor is already present, it is replaced cleanly.
 */
export function attachGoalAnchor(basePrompt: string, context: GoalAnchorContext): string {
  const rendered = renderGoalAnchor(context);
  const cleanedPrompt = stripGoalAnchor(basePrompt).trim();
  if (!cleanedPrompt) return rendered;
  return `${rendered}\n\n${cleanedPrompt}`;
}

/**
 * Removes any existing goal anchor block from a prompt.
 */
export function stripGoalAnchor(prompt: string): string {
  if (!hasGoalAnchor(prompt)) return prompt;
  const existing = extractGoalAnchor(prompt);
  if (!existing) return prompt;
  return prompt.replace(existing, "").trim();
}

/**
 * Builds a GoalAnchorContext from a card object/string and an optional PlanDoc.
 */
export function buildGoalAnchorFromPlanAndCard(
  card: Card | string,
  planDoc?: PlanDoc | null,
  extraInvariants: string[] = [],
): GoalAnchorContext {
  const cardName = typeof card === "string" ? card : (card.card || "unknown");
  const cardSpec = typeof card === "string" ? "" : (card.spec || "");

  let intent = planDoc?.intent || "";
  if (!intent && cardSpec) {
    const goalMatch = cardSpec.match(/Goal:\s*(.*?)(?:\n|$)/i);
    if (goalMatch?.[1]) {
      intent = goalMatch[1].trim();
    } else {
      const firstLine = cardSpec.split("\n")[0]?.trim() || "";
      intent = firstLine;
    }
  }
  if (!intent) intent = `Execute card ${cardName}`;

  // Find step in planDoc if present
  let step: PlanStep | undefined;
  if (planDoc?.steps) {
    step = planDoc.steps.find((s) => s.card === cardName || s.goal === cardName);
  }

  // Files & Scope
  const files: string[] = [];
  if (step?.files && Array.isArray(step.files)) {
    files.push(...step.files);
  } else if (cardSpec) {
    const filesMatch = cardSpec.match(/Files:\s*(.*?)(?:\n|$)/i);
    if (filesMatch?.[1]) {
      files.push(...filesMatch[1].split(",").map((s) => s.trim()).filter(Boolean));
    }
  }

  const nonGoals = planDoc?.nonGoals || [];

  // Acceptance criteria
  const acList: string[] = [];
  if (step?.acceptance && Array.isArray(step.acceptance)) {
    acList.push(...step.acceptance);
  } else if (cardSpec) {
    const acMatches = cardSpec.matchAll(/Acceptance:\s*(.*?)(?:\n|$)/gi);
    for (const match of acMatches) {
      if (match[1]) acList.push(match[1].trim());
    }
  }

  const invariants = Array.from(new Set([...DEFAULT_INVARIANTS, ...extraInvariants]));

  return {
    card: cardName,
    planSlug: planDoc?.slug,
    intent,
    invariants,
    scope: {
      files,
      nonGoals,
    },
    acceptanceCriteria: acList,
  };
}

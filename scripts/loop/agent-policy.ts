// agent-policy.ts — who may review whom.
//
// One rule, and it is the one the loop's trustworthiness rests on: an agent may
// not sign off work it authored. "The same agent" means the same WEIGHTS, not
// the same process — two nodes serving one model are one opinion however many
// machines they run on, so independence is decided on a trust domain rather than
// on an agent name.
//
// Today every lane is a distinct provider and the domain is just the name. The
// indirection stays because the rule is about weights: the moment two lanes
// share a model, this is the single place that has to learn it.

import {
  attachGoalAnchor,
  hasGoalAnchor,
  renderGoalAnchor,
  buildGoalAnchorFromPlanAndCard,
  type GoalAnchorContext,
} from "./goal-anchor.ts";

/** The shape the loop passes around for a backlog card. */
export interface Card {
  card?: string;
  spec?: string;
  [key: string]: unknown;
}

export function trustDomainFor(agent: string | null | undefined): string {
  return String(agent || "").toLowerCase();
}

export function independentAgents(left: string, right: string): boolean {
  return trustDomainFor(left) !== trustDomainFor(right);
}

/**
 * Enforces that a prompt handed to an agent (builder or reviewer) has the
 * immutable Goal Anchor block attached at the highest-salience header.
 */
export function enforceGoalAnchor(prompt: string, context: GoalAnchorContext): string {
  return attachGoalAnchor(prompt, context);
}

/**
 * Validates that an agent prompt or response preserves the immutable Goal Anchor.
 * Fails closed if the goal anchor is absent.
 */
export function validateGoalAnchorCompliance(prompt: string): { ok: boolean; reason?: string } {
  if (!hasGoalAnchor(prompt)) {
    return {
      ok: false,
      reason: "Immutable Goal Anchor block is missing or corrupted from agent prompt.",
    };
  }
  return { ok: true };
}

export {
  attachGoalAnchor,
  hasGoalAnchor,
  renderGoalAnchor,
  buildGoalAnchorFromPlanAndCard,
  type GoalAnchorContext,
};

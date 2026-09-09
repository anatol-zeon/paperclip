import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { issueRecoveryActions, type Db } from "@paperclipai/db";
import { EXECUTION_RECONCILIATION_CAUSES, type ExecutionBlocker } from "@paperclipai/shared";

/** Resolved recovery bookkeeping can still carry an effective no-replay hold. */
export function executionBlockerPredicate() {
  return and(
    inArray(issueRecoveryActions.cause, [...EXECUTION_RECONCILIATION_CAUSES]),
    or(inArray(issueRecoveryActions.status, ["active", "escalated"]),
      sql`${issueRecoveryActions.evidence}->'automaticRecovery'->>'replay' = 'blocked'`),
  );
}

export async function getExecutionBlocker(db: Db, companyId: string, issueId: string): Promise<ExecutionBlocker | null> {
  const [action] = await db.select().from(issueRecoveryActions).where(and(
    eq(issueRecoveryActions.companyId, companyId),
    eq(issueRecoveryActions.sourceIssueId, issueId),
    executionBlockerPredicate(),
  )).orderBy(desc(issueRecoveryActions.updatedAt), desc(issueRecoveryActions.id)).limit(1);
  if (!action) return null;
  const runId = action.evidence.runId ?? action.evidence.sourceRunId;
  return {
    recoveryActionId: action.id,
    runId: typeof runId === "string" ? runId : null,
    agentId: action.returnOwnerAgentId,
    cause: action.cause,
    nextAction: action.nextAction,
  };
}

import type { ReactNode } from "react";

import type { ProposalResult } from "../api";
import { Notice } from "./Notice";

type Action = ProposalResult["actions"][number];

/**
 * What a transaction will do, shown before anyone signs: an optional label, one line per action (escape and blocked
 * actions in red), the rules engine's warnings, then anything the screen adds (amounts, a checklist).
 */
export function ReviewPanel({ label, actions = [], warnings = [], children }: { label?: ReactNode; actions?: Action[]; warnings?: string[]; children?: ReactNode }) {
  return (
    <div className="review-panel">
      {label && <div className="metric-label">{label}</div>}
      {actions.map((action, i) => (
        <div key={i} className={`tx-action ${action.kind}`}>
          {action.summary}
        </div>
      ))}
      {warnings.map((warning) => (
        <Notice key={warning} tone="warning">
          {warning}
        </Notice>
      ))}
      {children}
    </div>
  );
}

/** What signing a proposal does, for the review: alone you execute at once; otherwise your signature is a confirmation. */
export function SigningSteps({ sole }: { sole: boolean }) {
  return (
    <ul className="checklist">
      {sole ? (
        <>
          <li>Sent by your current key, the only signature needed</li>
          <li>You rotate to your next key</li>
        </>
      ) : (
        <>
          <li>Signed with your current key as your confirmation</li>
          <li>Another signer executes; you both rotate</li>
        </>
      )}
    </ul>
  );
}

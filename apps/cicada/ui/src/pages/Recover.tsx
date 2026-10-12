import { useState, type ReactNode } from "react";

import { api, type Exposure, type ProposalResult } from "../api";
import { sendingLabel, sendLabel } from "../lib/execution";
import { Notice, ReviewPanel, useSoleSigner } from "../components";

type Replacement = ProposalResult & { slotIds: number[] };

/**
 * The fix for keys that signed something that never went through: one force-rotate of every exposed slot, proposed
 * at the current nonce so it also cancels the lost transaction. Preview first, then sign and propose.
 */
export function Recover({ exposure, onProposed }: { exposure: Exposure; onProposed?: () => void }) {
  const slots = exposure.slotIds.map((slotId) => `slot ${slotId}`).join(", ");
  return (
    <ReplaceAtNonce
      start="Replace exposed keys"
      load={(preview) => api.recover(preview)}
      onProposed={onProposed}
      intro={`Transaction #${exposure.nonce} was signed but never went through, so the keys of ${slots} are public without having rotated. Replacing them is one transaction: it gives each of those slots its next key and takes the place of #${exposure.nonce}.`}
    />
  );
}

/**
 * Rejects the next pending transaction: a force-rotate at the same nonce, so whichever executes first, the other can
 * never run. It also rotates every key the rejected transaction exposed.
 */
export function Reject({ nonce, safeTxHash, onProposed, onCancel }: { nonce: string; safeTxHash: string; onProposed?: () => void; onCancel: () => void }) {
  return (
    <ReplaceAtNonce
      start="Review rejection"
      load={(preview) => api.reject(safeTxHash, preview)}
      onProposed={onProposed}
      onCancel={onCancel}
      intro={`Rejecting proposes a replacement for #${nonce} at the same nonce: once it executes, #${nonce} can never run. It gives a fresh key to every slot whose key is exposed, including those that confirmed #${nonce}. Until then, #${nonce} can still execute if it gets enough confirmations first.`}
    />
  );
}

function ReplaceAtNonce({
  intro,
  start,
  load,
  onProposed,
  onCancel,
}: {
  intro: ReactNode;
  start: string;
  load: (preview: boolean) => Promise<Replacement>;
  onProposed?: () => void;
  onCancel?: () => void;
}) {
  const sole = useSoleSigner();
  const [review, setReview] = useState<Replacement>();
  const [done, setDone] = useState<Replacement>();
  const [error, setError] = useState<string>();
  const [working, setWorking] = useState(false);

  async function run(step: () => Promise<void>) {
    setWorking(true);
    setError(undefined);
    try {
      await step();
    } catch (caught) {
      const message = (caught as Error).message;
      setError(message.charAt(0).toUpperCase() + message.slice(1));
    } finally {
      setWorking(false);
    }
  }

  if (done) {
    const slots = done.slotIds.map((slotId) => `slot ${slotId}`).join(", ");
    return (
      <p className="muted small">
        {sole ? `Executing #${done.nonce}: fresh keys for ${slots}. Follow it on Transactions.` : `Proposed #${done.nonce}: fresh keys for ${slots}. Another signer executes it from Transactions, and everyone who signed rotates.`}
      </p>
    );
  }
  return (
    <div className="recover">
      <p className="small">{intro}</p>
      {review && (
        <ReviewPanel actions={review.actions} />
      )}
      {error && (
        <Notice tone="critical">
          {error}
        </Notice>
      )}
      <div className="tx-footer">
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={working}>
            Cancel
          </button>
        )}
        {review ? (
          <button
            type="button"
            className="primary"
            disabled={working}
            onClick={() =>
              void run(async () => {
                setDone(await load(false));
                onProposed?.();
              })
            }
          >
            {working ? sendingLabel(sole) : sendLabel(sole)}
          </button>
        ) : (
          <button type="button" className="primary" disabled={working} onClick={() => void run(async () => setReview(await load(true)))}>
            {working ? "Checking…" : start}
          </button>
        )}
      </div>
    </div>
  );
}

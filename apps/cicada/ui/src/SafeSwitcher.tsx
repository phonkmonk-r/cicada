import { useEffect, useState } from "react";

import { desktop, type SafeSummary, type StatusView } from "./api";
import { explorer, short } from "./format";
import { Skeleton } from "./Skeleton";
import { IconCheck, IconCopy, IconExternal, IconPlus, IconSelector } from "./icons";
import { Avatar, ErrorNotice, ListRow, usePopover } from "./components";

/** The Safe card at the top of the sidebar; in the desktop app it opens a list of the profile's Safes. */
export function SafeSwitcher({ status, onSwitched, onAdd }: { status: StatusView; onSwitched: () => void; onAdd?: () => void }) {
  const { open, setOpen, box, triggerProps } = usePopover(window.location.hash.includes("switcher"));
  const [safes, setSafes] = useState<SafeSummary[]>();
  const [error, setError] = useState<string>();
  const [forgetting, setForgetting] = useState<string>();

  useEffect(() => {
    if (!open || !desktop) return;
    setSafes(undefined);
    void desktop.listSafes().then(setSafes, (caught: Error) => setError(caught.message));
  }, [open]);

  async function forget(key: string) {
    setError(undefined);
    try {
      await desktop!.removeSafe(key);
      setForgetting(undefined);
      setSafes(await desktop!.listSafes());
      onSwitched();
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  async function select(key: string) {
    setError(undefined);
    try {
      await desktop!.selectSafe(key);
      setOpen(false);
      onSwitched();
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  const chip = (
    <>
      <Avatar address={status.safe} size={28} />
      <span className="safe-chip-text">
        <span className="safe-chip-address mono">{short(status.safe)}</span>
        <span className="safe-chip-meta">
          <span className={`network-dot ${status.chainId === 1 ? "mainnet" : "testnet"}`} aria-hidden="true" />
          <span>{status.chainId === 1 ? "Ethereum" : status.chainName}</span>
          <span aria-hidden="true">·</span>
          <span title={`${status.threshold} of ${status.owners.length} signers must sign`}>
            {status.threshold} of {status.owners.length}
            <span className="sr-only"> signers</span>
          </span>
        </span>
      </span>
    </>
  );
  if (!desktop) {
    return (
      <div className="safe-switcher">
        <div className="safe-chip" title={status.safe}>
          {chip}
          <SafeActions safe={status.safe} chainId={status.chainId} />
        </div>
      </div>
    );
  }

  return (
    <div className="safe-switcher" ref={box}>
      <button type="button" className={`safe-chip ${open ? "open" : ""}`} title="Switch Safe" {...triggerProps}>
        {chip}
        <IconSelector className="safe-chip-chevron" width="16" height="16" />
      </button>
      {open && (
        <div className="safe-menu" role="menu">
          {!safes && !error && (
            <div className="safe-menu-note stack-tight" role="status" aria-label="Loading">
              <Skeleton width={140} height={12} />
              <Skeleton width={90} height={10} />
            </div>
          )}
          {safes?.map((safe) =>
            forgetting === safe.key ? (
              <div key={safe.key} className="safe-forget">
                <span className="small">Forget {short(safe.safe)} on this computer? Nothing changes on-chain; you can add it again.</span>
                <div className="safe-forget-actions">
                  <button type="button" onClick={() => setForgetting(undefined)}>
                    Keep
                  </button>
                  <button type="button" className="danger" onClick={() => void forget(safe.key)}>
                    Forget
                  </button>
                </div>
              </div>
            ) : (
              <ListRow
                key={safe.key}
                role="menuitem"
                active={safe.active}
                onClick={() => void select(safe.key)}
                leading={<Avatar address={safe.safe} size={24} />}
                title={<span className="mono">{short(safe.safe)}</span>}
                subtitle={`${safe.chainName} · slot ${safe.slotId}${safe.error ? " · not connected" : ""}`}
                trailing={
                  <>
                    {(safe.needsYou ?? 0) > 0 && (
                      <span className="count" title="Transactions waiting for you">
                        {safe.needsYou}
                      </span>
                    )}
                    {safe.queued > 0 && (
                      <span className="count muted-count" title="Actions in this Safe's queue">
                        {safe.queued}
                      </span>
                    )}
                  </>
                }
                actions={
                  <>
                    <SafeActions safe={safe.safe} chainId={safe.chainId} />
                    <button type="button" className="icon-button" title="Forget on this computer" aria-label={`Forget ${short(safe.safe)}`} onClick={() => setForgetting(safe.key)}>
                      ✕
                    </button>
                  </>
                }
              />
            ),
          )}
          <ErrorNotice error={error} className="safe-menu-note" />
          {onAdd && (
            <button
              type="button"
              className="list-row menu-add"
              onClick={() => {
                setOpen(false);
                onAdd();
              }}
            >
              <IconPlus /> Add a Safe
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Copy the Safe's address, or open it on the block explorer; beside the Safe card, which is itself a button. */
function SafeActions({ safe, chainId }: { safe: string; chainId: number }) {
  const [copied, setCopied] = useState(false);
  const link = explorer(chainId, "address", safe);
  return (
    <span className="safe-chip-actions">
      <button
        type="button"
        className="icon-button"
        title="Copy the Safe's address"
        aria-label="Copy the Safe's address"
        onClick={() => {
          void navigator.clipboard.writeText(safe).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          });
        }}
      >
        {copied ? <IconCheck width="14" height="14" /> : <IconCopy />}
      </button>
      {link && (
        <a className="icon-button" href={link} target="_blank" rel="noreferrer" title="View on the block explorer" aria-label="View on the block explorer">
          <IconExternal />
        </a>
      )}
    </span>
  );
}

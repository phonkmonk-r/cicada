import { useState, type ComponentProps, type ReactNode } from "react";

import { IconChevronRight, IconCopy, IconKey, IconPlus } from "../icons";
import { Field } from "./Field";
import { ListRow } from "./ListRow";
import { ErrorNotice, Notice } from "./Notice";
import { Address, Avatar, Badge, Dots } from "./primitives";
import { ReviewPanel, SigningSteps } from "./ReviewPanel";
import { usePopover } from "./usePopover";

const SAFE = "0x2717c3B4f1a52d0E9b6D0dC2a0e3B9f1C4e7b4DC";
const OTHER = "0xa8d0f1c2E3b4A5968778695a4B3c2D1e0F9a8019";
const ACTIONS = [
  { kind: "transfer", summary: "Send 0.25 ETH to 0x0000…bEEF" },
  { kind: "guard-admin", summary: "Rotate slot(s) 0, 2 to their next keys" },
  { kind: "escape", summary: "Remove the rotation guard (escape hatch)" },
] as unknown as NonNullable<ComponentProps<typeof ReviewPanel>["actions"]>;
const TOKENS = ["--bg", "--sidebar", "--surface", "--surface-2", "--border", "--border-strong", "--text", "--muted", "--accent", "--accent-soft", "--warning", "--warning-soft", "--critical", "--critical-soft", "--mainnet", "--testnet"];
const TYPE = ["xs", "sm", "md", "base", "lg", "xl", "2xl", "display"];

/**
 * Every part of the kit in every state, at #components. Check a change to a component here, in light and dark, before
 * looking for it across the app; the e2e suite opens this page so a component that stops rendering fails a test.
 */
export function Gallery() {
  const [password, setPassword] = useState("");
  const menu = usePopover();
  return (
    <div className="gallery">
      <header className="page-header">
        <div>
          <h1>Components</h1>
          <p className="subtitle">The kit in components/, on the tokens in styles.css.</p>
        </div>
      </header>

      <Section title="Colors">
        <div className="gallery-swatches">
          {TOKENS.map((token) => (
            <div key={token} className="gallery-swatch">
              <span style={{ background: `var(${token})` }} />
              <code>{token}</code>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Type">
        {TYPE.map((step) => (
          <div key={step} className="gallery-type" style={{ fontSize: `var(--text-${step})` }}>
            <code>--text-{step}</code> Every signature is the last one its key makes.
          </div>
        ))}
      </Section>

      <Section title="Buttons">
        <div className="gallery-row">
          <button type="button" className="primary">
            Sign &amp; propose
          </button>
          <button type="button">Cancel</button>
          <button type="button" className="danger">
            Forget
          </button>
          <button type="button" className="link-button">
            Use another profile
          </button>
          <button type="button" className="icon-button" aria-label="Copy">
            <IconCopy />
          </button>
          <button type="button" className="primary" disabled>
            Disabled
          </button>
          <button type="button" className="primary large">
            Get started
          </button>
        </div>
      </Section>

      <Section title="Badges and counts">
        <div className="gallery-row">
          <Badge>Seed</Badge>
          <Badge tone="accent">Ledger</Badge>
          <Badge tone="ok">Your turn</Badge>
          <Badge tone="warning">Stuck</Badge>
          <Badge tone="critical">Reverted</Badge>
          <span className="count">3</span>
          <span className="count muted-count">2</span>
          <Dots filled={2} total={3} />
        </div>
      </Section>

      <Section title="Notices">
        <Notice tone="ok">Confirmation posted.</Notice>
        <Notice tone="pending">
          <span className="spinner" /> Simulating the transaction against the chain…
        </Notice>
        <Notice tone="warning">1 other transaction also uses nonce 5: only one of them can ever execute</Notice>
        <ErrorNotice error="transaction #4 is still pending: execute or reject it first" />
      </Section>

      <Section title="Fields">
        <div className="gallery-fields">
          <Field label="Recipient" hint="An address or ENS name.">
            <input placeholder="0x…" />
          </Field>
          <Field label="Safe address" aside="optional">
            <input placeholder="Leave empty to create a Safe" />
          </Field>
          <Field label="Password" error={password ? undefined : "Wrong password. Try again."}>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        </div>
      </Section>

      <Section title="List rows">
        <div className="gallery-menu">
          <ListRow role="menuitem" active leading={<Avatar address={SAFE} size={24} />} title={<span className="mono">0x2717…b4DC</span>} subtitle="Sepolia · slot 0" trailing={<span className="count">2</span>} actions={<IconButton label="Copy the Safe's address" />} />
          <ListRow role="menuitem" leading={<Avatar address={OTHER} size={24} />} title={<span className="mono">0xa8d0…8019</span>} subtitle="Ethereum · slot 1" actions={<IconButton label="Copy the Safe's address" />} />
          <button type="button" className="list-row menu-add">
            <IconPlus /> Add a Safe
          </button>
        </div>
        <div className="gallery-list">
          <ListRow boxed leading={<Avatar address={OTHER} size={34} />} title="Alice" subtitle={<span className="mono">Safe 0xa8d0…8019</span>} trailing={<Badge tone="accent">Ledger</Badge>} />
          <ListRow boxed leading={<span className="card-icon">{<IconKey />}</span>} title="Join a Safe" subtitle="Its rotation is already set up" trailing={<IconChevronRight className="list-row-chevron" width="16" height="16" />} />
        </div>
      </Section>

      <Section title="Menu">
        <div className="gallery-popover" ref={menu.box}>
          <button type="button" {...menu.triggerProps}>
            Open a menu
          </button>
          {menu.open && (
            <div className="safe-menu" role="menu">
              <ListRow role="menuitem" title="First choice" onClick={() => menu.setOpen(false)} />
              <ListRow role="menuitem" title="Second choice" onClick={() => menu.setOpen(false)} />
            </div>
          )}
        </div>
      </Section>

      <Section title="Review panel">
        <ReviewPanel label="Proposal #5" actions={ACTIONS} warnings={["Slot 2 has one staged key left; refill soon"]}>
          <SigningSteps sole={false} />
        </ReviewPanel>
      </Section>

      <Section title="Identity">
        <div className="gallery-row">
          <Avatar address={SAFE} size={28} />
          <Avatar address={OTHER} size={48} />
          <Address address={SAFE} />
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card gallery-section" aria-label={title}>
      <h2 className="card-title">{title}</h2>
      {children}
    </section>
  );
}

function IconButton({ label }: { label: string }) {
  return (
    <button type="button" className="icon-button" title={label} aria-label={label}>
      <IconCopy />
    </button>
  );
}

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { IconKey, IconLock, IconRefresh, IconSigners, Logo } from "./icons";
import { Backdrop } from "./components";

interface IntroPage {
  icon?: ReactNode;
  title: string;
  lines: string[];
}

const PAGES: IntroPage[] = [
  { title: "Cicada", lines: ["A Safe multisig that sheds its keys.", "Every signature is the last one its key ever makes."] },
  { icon: <IconKey />, title: "One key, one signature", lines: ["Each signer signs with their slot's current key.", "The guard replaces it in the same transaction, so a key that signed is never an owner again."] },
  { icon: <IconRefresh />, title: "Next keys, committed ahead", lines: ["Your next keys come from a list you committed when you joined.", "Even if someone could break a public key, nothing exposed is left to break."] },
  { icon: <IconSigners />, title: "Nothing to switch", lines: ["Cicada finds which address is yours right now and signs with it.", "No accounts to add or swap after a rotation."] },
  { icon: <IconLock />, title: "Addresses only", lines: ["Your seed stays encrypted on this computer, or your keys stay on your Ledger.", "Only the key in use is derived, at the moment it signs."] },
];

/** How long the outgoing page takes to clear before the next one comes in; matches `--intro-leave` in styles.css. */
const LEAVE_MS = 220;

/**
 * First launch, before any profile exists: a short intro, one idea per page. The logo arrives first and rises to the
 * top, then each page's lines come in one after another. Continue, the dots, Enter and the arrow keys move through
 * it; Skip or Get started leaves it.
 */
export function Welcome({ onStart }: { onStart: () => void }) {
  const [page, setPage] = useState(0);
  const [leaving, setLeaving] = useState<"forward" | "back">();
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  // Only the very first page waits for the logo's entrance.
  const [opening, setOpening] = useState(true);
  const target = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const last = page === PAGES.length - 1;

  // A new choice during the outgoing animation just retargets it, so input is never locked out.
  const go = useCallback((next: number) => {
    if (next < 0 || next >= PAGES.length || next === target.current) return;
    const dir = next > target.current ? "forward" : "back";
    target.current = next;
    setOpening(false);
    setLeaving(dir);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setDirection(dir);
      setPage(target.current);
      setLeaving(undefined);
    }, LEAVE_MS);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") go(target.current + 1);
      else if (event.key === "ArrowLeft") go(target.current - 1);
      else if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement)) {
        if (target.current === PAGES.length - 1) onStart();
        else go(target.current + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onStart]);

  const current = PAGES[page]!;
  return (
    <div className={`intro ${opening ? "opening" : ""}`}>
      <Backdrop />

      <button type="button" className="intro-skip link-button" onClick={onStart}>
        Skip
      </button>

      <div className="intro-logo">
        <Logo size={88} />
      </div>

      <main className="intro-stage" aria-live="polite">
        <section key={page} className={`intro-page ${direction} ${current.icon ? "" : "hero"} ${leaving ? `leaving ${leaving}` : ""}`}>
          {current.icon && (
            <div className="intro-icon" style={line(0)}>
              {current.icon}
            </div>
          )}
          <h1 style={line(1)}>{current.title}</h1>
          {current.lines.map((text, i) => (
            <p key={text} style={line(i + 2)}>
              {text}
            </p>
          ))}
        </section>
      </main>

      <footer className="intro-controls">
        <div className="intro-dots" role="tablist" aria-label="Intro pages">
          {PAGES.map((p, i) => (
            <button key={p.title} type="button" role="tab" aria-selected={i === page} aria-label={p.title} className={i === page ? "active" : ""} onClick={() => go(i)} />
          ))}
        </div>
        <button type="button" className="primary large" onClick={last ? onStart : () => go(target.current + 1)}>
          {last ? "Get started" : "Continue"}
        </button>
        <p className="muted small intro-footnote">Seed phrase or Ledger. Your Safe stays a standard Safe.</p>
      </footer>
    </div>
  );
}

/** Staggers each line of a page by its position. */
const line = (index: number): CSSProperties => ({ "--line": index }) as CSSProperties;

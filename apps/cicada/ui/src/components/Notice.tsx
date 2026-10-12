import type { ReactNode } from "react";

import { IconAlert, IconCheck } from "../icons";

export type NoticeTone = "ok" | "warning" | "critical" | "pending";

/** First letter upper-cased: errors come from code ("wrong password") and are shown as sentences. */
export const sentence = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * A message about a whole step or section: status (pending), completion (ok), warning or error (critical). Its icon
 * follows the tone unless one is given. For a message about one field, use `FieldError` instead.
 */
export function Notice({ tone, icon, className = "", children }: { tone: NoticeTone; icon?: ReactNode | false; className?: string; children: ReactNode }) {
  const glyph = icon === false ? null : (icon ?? (tone === "ok" ? <IconCheck width="15" height="15" /> : tone === "pending" ? null : <IconAlert width="15" height="15" />));
  return (
    <div className={`note ${tone} ${className}`.trim()} role={tone === "critical" ? "alert" : undefined}>
      {glyph}
      <span>{children}</span>
    </div>
  );
}

/** A failed action's message as a critical notice, or nothing when there is no error. */
export function ErrorNotice({ error, className }: { error?: string; className?: string }) {
  if (!error) return null;
  return (
    <Notice tone="critical" className={className}>
      {sentence(error)}
    </Notice>
  );
}

/** The error of one field, right under it. `id` is what the field's `aria-describedby` points at. */
export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="field-error" role="alert">
      <IconAlert width="13" height="13" />
      {children}
    </p>
  );
}

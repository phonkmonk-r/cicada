import { cloneElement, useId, type ReactElement, type ReactNode } from "react";

import { FieldError } from "./Notice";

/**
 * A labelled form control with an optional hint and error. It wires the control for assistive tech: the label names
 * it, and the hint or error describe it (`aria-describedby`); with an error the control is marked invalid, which also
 * turns it red. The error sits outside the label so it never becomes part of the control's name.
 */
export function Field({
  label,
  aside,
  hint,
  error,
  children,
}: {
  label: ReactNode;
  /** Shown at the right of the label, such as "optional". */
  aside?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactElement<{ id?: string; "aria-invalid"?: boolean; "aria-describedby"?: string }>;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : undefined, hint ? hintId : undefined].filter(Boolean).join(" ") || undefined;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        <span>{label}</span>
        {aside && <span className="muted">{aside}</span>}
      </label>
      {cloneElement(children, { id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {error && <FieldError id={errorId}>{error}</FieldError>}
      {hint && !error && (
        <p id={hintId} className="field-hint">
          {hint}
        </p>
      )}
    </div>
  );
}

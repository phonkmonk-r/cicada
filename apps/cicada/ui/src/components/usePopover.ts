import { useEffect, useRef, useState } from "react";

/**
 * Open state for a menu or popover anchored to a trigger. A click outside `box` or Escape closes it; Escape also
 * hands focus back to the trigger, so keyboard users land where they started.
 */
export function usePopover<Box extends HTMLElement = HTMLDivElement, Trigger extends HTMLElement = HTMLButtonElement>(initial = false) {
  const [open, setOpen] = useState(initial);
  const box = useRef<Box>(null);
  const trigger = useRef<Trigger>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    window.addEventListener("mousedown", outside);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("mousedown", outside);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);

  return { open, setOpen, box, trigger, triggerProps: { ref: trigger, "aria-haspopup": "menu" as const, "aria-expanded": open, onClick: () => setOpen(!open) } };
}

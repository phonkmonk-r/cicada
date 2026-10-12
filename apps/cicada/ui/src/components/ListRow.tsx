import type { ReactNode } from "react";

/**
 * One choice in a list: leading avatar or icon, a title, an optional second line, and something trailing (a badge, a
 * count). `boxed` rows stand alone on a page with a border (choose a profile, how to connect a Safe); plain rows sit in
 * a menu. `actions` are buttons beside the row (copy, remove), kept outside it since a button cannot hold buttons.
 */
export function ListRow({
  leading,
  title,
  subtitle,
  trailing,
  actions,
  active = false,
  boxed = false,
  role,
  onClick,
}: {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  actions?: ReactNode;
  active?: boolean;
  boxed?: boolean;
  role?: "menuitem" | "option";
  onClick?: () => void;
}) {
  const row = (
    <button type="button" role={role} className={`list-row ${boxed ? "boxed" : ""} ${active ? "active" : ""}`} aria-current={active || undefined} onClick={onClick}>
      {leading}
      <span className="list-row-text">
        <span className="list-row-title">{title}</span>
        {subtitle && <span className="list-row-subtitle">{subtitle}</span>}
      </span>
      {trailing}
    </button>
  );
  if (!actions) return row;
  return (
    <div className="list-row-group">
      {row}
      <span className="list-row-actions">{actions}</span>
    </div>
  );
}

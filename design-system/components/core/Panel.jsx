import React from "react";
import { IconButton } from "./IconButton.jsx";

const NUDGE = 16;
const RESIZE_NUDGE = 16;

/** The overlay's glass container. Every floating surface in the product is a Panel:
 *  header row (drag handle + title + actions), optional media-time stamp, body.
 *  `draggable` turns the header into a grab handle: pointer-drag it, or focus it and use
 *  the arrow keys (Home resets position). The panel keeps its layout slot and moves by
 *  transform, so dragging one panel never reflows the others. Every draggable panel also
 *  gets a header chevron that COLLAPSES it (header-only, content stays mounted) — distinct
 *  from a caller-supplied close/hide action, which unmounts the panel entirely. `resizable`
 *  (default true when draggable) adds a bottom-right grip handle: drag it, or focus it and
 *  use the arrow keys (Home resets size). */
export function Panel({ title, icon, mediaTime, stale, actions, collapsed, onToggleCollapse, collapsible = true, resizable, footer, tone = "glass", draggable, children, style, bodyStyle, ...rest }) {
  const [offset, setOffset] = React.useState({ x: 0, y: 0 });
  const [size, setSize] = React.useState(null);
  const [dragging, setDragging] = React.useState(false);
  const [internalCollapsed, setInternalCollapsed] = React.useState(false);
  const from = React.useRef(null);
  const resizeFrom = React.useRef(null);

  const isCollapsed = collapsed != null ? collapsed : internalCollapsed;
  const canResize = resizable != null ? resizable : draggable;
  const setCollapsed = (next) => (onToggleCollapse ? onToggleCollapse(next) : setInternalCollapsed(next));

  const onPointerDown = (e) => {
    if (!draggable || e.target.closest("button")) return;
    e.preventDefault();
    setDragging(true);
    from.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
    const move = (ev) => from.current && setOffset({ x: ev.clientX - from.current.x, y: ev.clientY - from.current.y });
    const up = () => { from.current = null; setDragging(false); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const onKeyDown = (e) => {
    if (!draggable) return;
    const step = { ArrowLeft: [-NUDGE, 0], ArrowRight: [NUDGE, 0], ArrowUp: [0, -NUDGE], ArrowDown: [0, NUDGE] }[e.key];
    if (step) { e.preventDefault(); setOffset((o) => ({ x: o.x + step[0], y: o.y + step[1] })); }
    if (e.key === "Home") { e.preventDefault(); setOffset({ x: 0, y: 0 }); }
  };
  const onResizePointerDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.parentElement.getBoundingClientRect();
    resizeFrom.current = { x: e.clientX, y: e.clientY, w: size?.width ?? rect.width, h: size?.height ?? rect.height };
    const move = (ev) => resizeFrom.current && setSize({ width: Math.max(160, resizeFrom.current.w + (ev.clientX - resizeFrom.current.x)), height: Math.max(96, resizeFrom.current.h + (ev.clientY - resizeFrom.current.y)) });
    const up = () => { resizeFrom.current = null; window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const onResizeKeyDown = (e) => {
    const step = { ArrowLeft: [-RESIZE_NUDGE, 0], ArrowRight: [RESIZE_NUDGE, 0], ArrowUp: [0, -RESIZE_NUDGE], ArrowDown: [0, RESIZE_NUDGE] }[e.key];
    if (step) { e.preventDefault(); setSize((s) => ({ width: Math.max(160, (s?.width ?? 240) + step[0]), height: Math.max(96, (s?.height ?? 160) + step[1]) })); }
    if (e.key === "Home") { e.preventDefault(); setSize(null); }
  };

  return (
    <section
      style={{
        width: size?.width ?? "100%",
        height: size?.height,
        transform: offset.x || offset.y ? `translate(${offset.x}px, ${offset.y}px)` : undefined,
        borderRadius: "var(--radius-lg)",
        background: tone === "solid" ? "var(--surface-panel-solid)" : "var(--surface-panel)",
        backdropFilter: tone === "solid" ? undefined : "var(--blur-panel)",
        WebkitBackdropFilter: tone === "solid" ? undefined : "var(--blur-panel)",
        border: "1px solid var(--border-hairline)",
        boxShadow: "var(--shadow-panel)",
        overflow: "hidden",
        position: draggable ? "relative" : undefined,
        ...style,
      }}
      {...rest}
    >
      {(title || actions || (draggable && collapsible)) && (
        <header
          onPointerDown={onPointerDown}
          onKeyDown={onKeyDown}
          tabIndex={draggable ? 0 : undefined}
          role={draggable ? "group" : undefined}
          aria-label={draggable ? `${title || "Panel"} header; drag to move, or use arrow keys` : undefined}
          aria-keyshortcuts={draggable ? "ArrowLeft ArrowRight ArrowUp ArrowDown Home" : undefined}
          aria-grabbed={draggable ? dragging : undefined}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-4)",
            height: "32px",
            padding: "0 var(--sp-3) 0 var(--sp-5)",
            borderBottom: isCollapsed ? "none" : "1px solid var(--border-hairline)",
            background: "rgba(255,255,255,.02)",
            cursor: draggable ? (dragging ? "grabbing" : "grab") : undefined,
            touchAction: draggable ? "none" : undefined,
            userSelect: draggable ? "none" : undefined,
          }}
        >
          {icon}
          <h3 style={{ margin: 0, font: "var(--type-label)", letterSpacing: "var(--ls-caps)", textTransform: "uppercase", color: "var(--text-muted)" }}>{title}</h3>
          {mediaTime && !isCollapsed && (
            <span style={{ font: "var(--type-mono)", fontSize: "var(--fs-10)", color: stale ? "var(--signal-warn)" : "var(--text-faint)" }}>
              {mediaTime}
              {stale ? " · stale" : ""}
            </span>
          )}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "var(--sp-1)" }}>
            {draggable && collapsible && (
              <IconButton
                size="sm"
                label={(isCollapsed ? "Expand " : "Collapse ") + (title || "panel").toLowerCase() + " panel"}
                aria-expanded={!isCollapsed}
                icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d={isCollapsed ? "m6 9 6 6 6-6" : "m18 15-6-6-6 6"} /></svg>}
                onClick={(e) => { e.stopPropagation(); setCollapsed(!isCollapsed); }}
              />
            )}
            {actions}
          </div>
        </header>
      )}
      {!isCollapsed && <div style={{ padding: "var(--sp-5)", minHeight: 0, ...bodyStyle }}>{children}</div>}
      {!isCollapsed && footer && (
        <footer style={{ padding: "var(--sp-4) var(--sp-5)", borderTop: "1px solid var(--border-hairline)", background: "rgba(0,0,0,.18)" }}>{footer}</footer>
      )}
      {draggable && canResize && !isCollapsed && (
        <button
          type="button"
          aria-label={`Resize ${(title || "panel").toLowerCase()} panel`}
          aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home"
          title="Drag to resize. Use arrow keys for precise sizing; Home resets the size."
          onPointerDown={onResizePointerDown}
          onKeyDown={onResizeKeyDown}
          style={{ position: "absolute", right: 2, bottom: 2, width: 18, height: 18, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0, border: 0, borderRadius: "var(--radius-xs)", background: "transparent", color: "var(--text-faint)", cursor: "nwse-resize", touchAction: "none", opacity: 0.7 }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><circle cx="9" cy="5" r="1" fill="currentColor" stroke="none" /><circle cx="15" cy="5" r="1" fill="currentColor" stroke="none" /><circle cx="9" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="9" cy="19" r="1" fill="currentColor" stroke="none" /><circle cx="15" cy="19" r="1" fill="currentColor" stroke="none" /></svg>
        </button>
      )}
    </section>
  );
}

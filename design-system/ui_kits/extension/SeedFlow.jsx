const NS = window.BadmintonVisionDesignSystem_0ab536;
const { Button, Icon, StepDots, Badge } = NS;

const CORNERS = ["Near left", "Near right", "Far right", "Far left"];
/* Approximate image positions of the four outer doubles corners on the stage backdrop, in %. */
const TARGETS = [{ x: 22, y: 82 }, { x: 78, y: 82 }, { x: 63, y: 33 }, { x: 37, y: 33 }];

/** Court seed — the only modal step (§4.2). Playback continues behind it. */
function SeedFlow({ onDone, onSkip, onCancel }) {
  const [pts, setPts] = React.useState([]);
  const done = pts.length === 4;
  const add = (e) => {
    if (done) return;
    const r = e.currentTarget.getBoundingClientRect();
    setPts((prev) => (prev.length === 4 ? prev : [...prev, { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 }]));
  };
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div onClick={add} style={{ position: "absolute", inset: 0, cursor: done ? "default" : "crosshair", background: "rgba(6,9,11,.35)" }}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
          {pts.length > 1 && (
            <polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ") + (done ? ` ${pts[0].x},${pts[0].y}` : "")} fill={done ? "rgba(200,240,74,.1)" : "none"} stroke="var(--lime-500)" strokeWidth="0.25" vectorEffect="non-scaling-stroke" />
          )}
          {done && (
            <g stroke="rgba(233,245,240,.7)" strokeWidth="0.15" vectorEffect="non-scaling-stroke" fill="none">
              {[0.07, 0.35, 0.5, 0.65, 0.93].map((t, i) => {
                const l = { x: pts[0].x + (pts[3].x - pts[0].x) * t, y: pts[0].y + (pts[3].y - pts[0].y) * t };
                const r = { x: pts[1].x + (pts[2].x - pts[1].x) * t, y: pts[1].y + (pts[2].y - pts[1].y) * t };
                return <line key={i} x1={l.x} y1={l.y} x2={r.x} y2={r.y} strokeWidth={t === 0.5 ? 0.3 : 0.15} vectorEffect="non-scaling-stroke" />;
              })}
              {[0.075, 0.5, 0.925].map((t, i) => {
                const a = { x: pts[0].x + (pts[1].x - pts[0].x) * t, y: pts[0].y + (pts[1].y - pts[0].y) * t };
                const b = { x: pts[3].x + (pts[2].x - pts[3].x) * t, y: pts[3].y + (pts[2].y - pts[3].y) * t };
                return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
              })}
            </g>
          )}
        </svg>
        {!done && (
          <span style={{ position: "absolute", left: `${TARGETS[pts.length].x}%`, top: `${TARGETS[pts.length].y}%`, transform: "translate(-50%,-50%)", width: 26, height: 26, borderRadius: 999, border: "1px dashed var(--lime-500)", background: "var(--lime-tint)", pointerEvents: "none" }} />
        )}
        {pts.map((p, i) => (
          <span key={i} style={{ position: "absolute", left: `${p.x}%`, top: `${p.y}%`, transform: "translate(-50%,-50%)", display: "flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, borderRadius: 999, background: "var(--lime-500)", color: "var(--text-on-accent)", font: "var(--type-mono)", fontSize: 10, boxShadow: "0 2px 8px rgba(0,0,0,.5)" }}>{i + 1}</span>
        ))}
      </div>

      <div style={{ position: "absolute", left: "50%", bottom: 78, transform: "translateX(-50%)", width: "min(520px, 94%)", borderRadius: "var(--radius-lg)", background: "var(--surface-panel)", backdropFilter: "var(--blur-panel)", border: "1px solid var(--border-subtle)", boxShadow: "var(--shadow-modal)", padding: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <StepDots total={4} current={pts.length} labels={CORNERS} />
          <span style={{ font: "var(--type-ui)", color: "var(--text-primary)" }}>{done ? "Court locked" : `Click the ${CORNERS[pts.length].toLowerCase()} outer corner`}</span>
          {done && <Badge tone="in">homography ok</Badge>}
          <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <Button size="sm" variant="ghost" onClick={() => setPts(pts.slice(0, -1))} disabled={!pts.length}>Undo</Button>
            <Button size="sm" variant="ghost" onClick={onSkip}>Skip to manual</Button>
            <Button size="sm" variant="primary" disabled={!done} onClick={onDone}>Lock court</Button>
          </span>
        </div>
        <p style={{ font: "var(--type-body-sm)", fontSize: "var(--fs-12)", color: "var(--text-faint)", margin: "10px 0 0", textWrap: "pretty" }}>
          Your four clicks are the outer doubles corners only. Service lines, centre lines and the net come from the official 13.40 × 6.10 m court and are projected in — they never adapt to the image.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
          <Icon name="info" size={13} color="var(--slate-300)" />
          <span style={{ font: "var(--type-ui-sm)", fontSize: "var(--fs-11)", color: "var(--text-faint)" }}>Playback keeps running. A camera cut past tolerance pauses analysis, not the video.</span>
          <span style={{ marginLeft: "auto" }}><Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button></span>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { SeedFlow });

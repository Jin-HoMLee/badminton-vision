const NS = window.BadmintonVisionDesignSystem_0ab536;
const { Button, Icon, StepDots, Badge, Callout } = NS;

const CORNERS = ["Near left", "Near right", "Far right", "Far left"];
/* Approximate image positions of the four outer doubles corners on the stage backdrop, in %. */
const TARGETS = [{ x: 22, y: 82 }, { x: 78, y: 82 }, { x: 63, y: 33 }, { x: 37, y: 33 }];

/** Court seed — the only modal step (§4.2). Playback continues behind it. */
const CARD_MARGIN = 12, CARD_NUDGE = 16, TOP_RATIO = 0.35;

function SeedFlow({ onDone, onSkip, onCancel }) {
  const [pts, setPts] = React.useState([]);
  /* Card position as a 0–1 fraction of the stage, clamped to a 12px margin — the
     model in src/seed-card.js. Default: horizontally centred, 35% down. */
  const [pos, setPos] = React.useState({ x: null, y: TOP_RATIO });
  const stageRef = React.useRef(null), cardRef = React.useRef(null), dragRef = React.useRef(null);
  const done = pts.length === 4;

  const clamp = (next) => {
    const st = stageRef.current, cd = cardRef.current;
    if (!st || !cd) return next;
    const sw = st.offsetWidth, sh = st.offsetHeight, cw = cd.offsetWidth, ch = cd.offsetHeight;
    const maxLeft = Math.max(CARD_MARGIN, sw - cw - CARD_MARGIN), maxTop = Math.max(CARD_MARGIN, sh - ch - CARD_MARGIN);
    return {
      x: Math.max(CARD_MARGIN, Math.min(maxLeft, next.x * sw)) / sw,
      y: Math.max(CARD_MARGIN, Math.min(maxTop, next.y * sh)) / sh,
    };
  };
  const onHandleDown = (e) => {
    const st = stageRef.current, cd = cardRef.current;
    if (!st || !cd) return;
    e.preventDefault();
    const sr = st.getBoundingClientRect(), cr = cd.getBoundingClientRect();
    dragRef.current = { dx: e.clientX - cr.left, dy: e.clientY - cr.top, sr };
    const move = (ev) => {
      const d = dragRef.current; if (!d) return;
      setPos(clamp({ x: (ev.clientX - d.dx - d.sr.left) / d.sr.width, y: (ev.clientY - d.dy - d.sr.top) / d.sr.height }));
    };
    const up = () => { dragRef.current = null; window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  const onHandleKey = (e) => {
    const step = { ArrowLeft: [-CARD_NUDGE, 0], ArrowRight: [CARD_NUDGE, 0], ArrowUp: [0, -CARD_NUDGE], ArrowDown: [0, CARD_NUDGE] }[e.key];
    if (!step) return;
    e.preventDefault();
    const st = stageRef.current, cd = cardRef.current;
    if (!st || !cd) return;
    const left = pos.x === null ? (st.offsetWidth - cd.offsetWidth) / 2 : pos.x * st.offsetWidth;
    setPos(clamp({ x: (left + step[0]) / st.offsetWidth, y: (pos.y * st.offsetHeight + step[1]) / st.offsetHeight }));
  };
  /* src/seed-card.js clamps the DEFAULT too — without this the card can hang past the
     bottom edge on a short stage. Runs once the card has a measured height. */
  React.useEffect(() => {
    const st = stageRef.current, cd = cardRef.current;
    if (!st || !cd) return;
    const left = (st.offsetWidth - cd.offsetWidth) / 2;
    setPos(clamp({ x: left / st.offsetWidth, y: TOP_RATIO }));
  }, []);

  const add = (e) => {
    if (done) return;
    const r = e.currentTarget.getBoundingClientRect();
    setPts((prev) => (prev.length === 4 ? prev : [...prev, { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 }]));
  };
  return (
    <div ref={stageRef} style={{ position: "absolute", inset: 0 }}>
      <div onClick={add} style={{ position: "absolute", inset: 0, cursor: done ? "default" : "crosshair", background: "rgba(6,9,11,.42)" }}>
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

      <div ref={cardRef} style={{ position: "absolute", left: pos.x === null ? "50%" : `${pos.x * 100}%`, top: `${pos.y * 100}%`, transform: pos.x === null ? "translateX(-50%)" : "none", boxSizing: "border-box", width: "min(560px, calc(100% - 24px))", maxHeight: "calc(100% - 24px)", overflow: "auto", zIndex: 3, borderRadius: "var(--radius-lg)", background: "var(--ink-900)", border: "2px solid var(--lime-500)", boxShadow: "0 8px 28px rgba(0,0,0,.72)", padding: "var(--sp-5)", cursor: "default" }}>
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <span role="button" tabIndex={0} aria-label="Move this card" onPointerDown={onHandleDown} onKeyDown={onHandleKey}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, minHeight: 30, padding: "0 var(--sp-3)", border: "1px solid var(--lime-500)", borderRadius: "var(--radius-sm)", background: "var(--lime-tint)", color: "var(--lime-500)", font: "var(--type-label)", letterSpacing: "var(--ls-caps)", cursor: "grab", touchAction: "none" }}>
            <Icon name="grip-vertical" size={12} />Move
          </span>
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
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: "var(--sp-4)", paddingTop: "var(--sp-4)", borderTop: "1px solid var(--border-subtle)" }}>
          <Icon name="info" size={13} color="var(--slate-300)" />
          <span style={{ font: "var(--type-ui-sm)", fontSize: "var(--fs-11)", color: "var(--text-body)" }}>Playback keeps running. Drag <b style={{ color: "var(--lime-500)", fontWeight: 500 }}>Move</b> or use the arrow keys if this card covers a corner.</span>
          <span style={{ marginLeft: "auto" }}><Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button></span>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { SeedFlow });

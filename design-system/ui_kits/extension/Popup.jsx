const NS = window.BadmintonVisionDesignSystem_0ab536;
const { Button, IconButton, Badge, Icon, Toggle, SegmentedControl, StatusChip, Callout, InfoTip } = NS;

const HEALTH = { ok: "var(--signal-in)", degraded: "var(--signal-warn)", off: "var(--signal-unknown)", unavailable: "var(--ink-400)" };

const MiniSwitch = ({ on, disabled, onClick }) => (
  <button type="button" role="switch" aria-checked={!!on} disabled={disabled} onClick={onClick}
    style={{ position: "relative", width: 28, height: 16, flex: "0 0 auto", borderRadius: "var(--radius-pill)", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.42 : 1, transition: "var(--transition-control)", background: on ? "var(--lime-500)" : "var(--ink-600)", border: `1px solid ${on ? "var(--lime-600)" : "var(--border-subtle)"}` }}>
    <span style={{ position: "absolute", top: 1, left: on ? 13 : 1, width: 12, height: 12, borderRadius: "var(--radius-pill)", background: on ? "var(--text-on-accent)" : "var(--slate-200)", transition: "left var(--dur-fast) var(--ease-standard)" }} />
  </button>
);

const TrackerRow = ({ t, onToggle }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0" }}>
    <span style={{ width: 6, height: 6, borderRadius: 999, flex: "0 0 auto", background: t.on ? HEALTH[t.health] : HEALTH.off }} />
    <span style={{ font: "var(--type-ui-sm)", color: t.health === "unavailable" ? "var(--text-faint)" : "var(--text-primary)" }}>{t.label}</span>
    <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ font: "var(--type-mono)", fontSize: "var(--fs-10)", color: t.on && t.health === "degraded" ? "var(--signal-warn)" : "var(--text-faint)" }}>{t.on ? t.note : "off"}</span>
      <MiniSwitch on={t.on} disabled={t.health === "unavailable"} onClick={() => onToggle(t.id)} />
    </span>
  </div>
);

const Section = ({ title, aside, children }) => (
  <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border-hairline)" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 10, font: "var(--type-label)", letterSpacing: "var(--ls-caps)", textTransform: "uppercase", color: "var(--text-faint)", marginBottom: 10 }}>{title}<span style={{ marginLeft: "auto", textTransform: "none", letterSpacing: 0 }}>{aside}</span></div>
    {children}
  </div>
);

/** Toolbar popup — the control center (§4.1). Fixed 360px. */
function Popup({ state, onEnable, onSeed, onManual, onSummary, density, setDensity, panels, setPanels, onClose }) {
  const seeded = state.seeded;
  const [open, setOpen] = React.useState(false);
  const [trackers, setTrackers] = React.useState([
    { id: "court", label: "Court", health: seeded ? "ok" : "degraded", note: seeded ? "seeded" : "not seeded", on: true },
    { id: "players", label: "Players", health: "ok", note: "2 tracked", on: true },
    { id: "body", label: "Body pose", health: "ok", note: "17 keypoints", on: true },
    { id: "shuttle", label: "Shuttle", health: "degraded", note: "low light", on: true },
    { id: "score", label: "Score OCR", health: "degraded", note: "partial", on: true },
    { id: "racket", label: "Racket", health: "unavailable", note: "not in MVP", on: false },
  ]);
  const toggleTracker = (id) => setTrackers((prev) => prev.map((t) => (t.id === id ? { ...t, on: !t.on } : t)));
  const active = trackers.filter((t) => t.on).length;
  const degraded = trackers.some((t) => t.on && t.health === "degraded");
  return (
    <div style={{ width: "var(--popup-width)", borderRadius: "var(--radius-lg)", overflow: "hidden", background: "var(--surface-panel-solid)", border: "1px solid var(--border-subtle)", boxShadow: "var(--shadow-modal)" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px 12px 16px" }}>
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, letterSpacing: "-0.02em", color: "var(--lime-500)" }}>Badminton Vision</span>
        <span style={{ marginLeft: "auto" }}><IconButton size="sm" label="Settings" icon={<Icon name="settings" size={14} />} /></span>
        <IconButton size="sm" label="Close" icon={<Icon name="x" size={14} />} onClick={onClose} />
      </header>

      <div style={{ padding: "0 16px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
        <StatusChip state={state.enabled ? (state.stale ? "stale" : "live") : "ready"} label={state.enabled ? (state.stale ? "Analysis behind" : `Rally ${state.rally}`) : "Badminton match found on this page"} detail={state.enabled ? state.time : undefined} style={{ width: "100%", justifyContent: "flex-start" }} />
        {!state.enabled && (
          <Callout tone="guide" title="Three steps to get going">
            Turn the overlay on, click the four court corners once, then keep watching — the video is never paused or moved.
          </Callout>
        )}
      </div>

      <Section title="Panels on the video" aside="the video's own Panels button offers these as quick shortcuts">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Toggle id="p-feed" label="Shots this rally" description="Every stroke as it happens" checked={panels.feed} onChange={(v) => setPanels({ ...panels, feed: v })} />
          <Toggle id="p-stats" label="Rally stats" checked={panels.stats} onChange={(v) => setPanels({ ...panels, stats: v })} />
          <Toggle id="p-map" label="Court map" description="Where players and the shuttle are" checked={panels.map} onChange={(v) => setPanels({ ...panels, map: v })} />
          <Toggle id="p-pro" label="Compare with the pros" description="Coming later — needs a licensed benchmark" disabled />
        </div>
      </Section>

      <Section title={<span style={{ display: "flex", alignItems: "center", gap: 8 }}>What's being tracked<span style={{ display: "inline-flex", gap: 2 }}>{trackers.map((t) => <span key={t.id} style={{ width: 10, height: 3, borderRadius: 1, background: t.on ? HEALTH[t.health] : "var(--ink-500)" }} />)}</span></span>}
        aside={<button type="button" onClick={() => setOpen(!open)} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", font: "var(--type-ui-sm)", fontSize: "var(--fs-11)", padding: 0 }}>{active} of {trackers.length} on<Icon name={open ? "chevron-up" : "chevron-down"} size={12} /></button>}>
        {!open ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Badge tone={degraded ? "warn" : "in"}>{degraded ? "some parts unsure" : "all working"}</Badge>
            <span style={{ font: "var(--type-ui-sm)", fontSize: "var(--fs-11)", color: "var(--text-faint)" }}>runs on your machine · nothing uploaded</span>
          </div>
        ) : (
          <React.Fragment>
            {trackers.map((t) => <TrackerRow key={t.id} t={t} onToggle={toggleTracker} />)}
            <p style={{ font: "var(--type-ui-sm)", fontSize: "var(--fs-11)", color: "var(--text-faint)", margin: "8px 0 0" }}>Turn something off and it stops being analysed — anything that depended on it is left blank rather than guessed.</p>
          </React.Fragment>
        )}
      </Section>

      <Section title={<span style={{ display: "flex", alignItems: "center", gap: 7 }}>How much to show<InfoTip term="How much to show">Changes only what appears on the video. Everything is still analysed either way.</InfoTip></span>}>
        <SegmentedControl full value={density} onChange={setDensity} options={[{ value: "minimal", label: "Just a chip" }, { value: "balanced", label: "Shots + stats" }, { value: "full", label: "Everything" }]} />
      </Section>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "14px 16px", borderTop: "1px solid var(--border-hairline)", background: "rgba(0,0,0,.2)" }}>
        {!state.enabled ? (
          <Button full variant="primary" icon={<Icon name="play" />} onClick={onEnable}>Turn on — step 1 of 3</Button>
        ) : (
          <Button full variant="primary" icon={<Icon name="layout-dashboard" />} onClick={onClose}>Back to the match</Button>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <Button style={{ flex: 1 }} icon={<Icon name="crosshair" />} onClick={onSeed}>{seeded ? "Set up court again" : "Set up court"}</Button>
          <Button style={{ flex: 1 }} icon={<Icon name="pencil-line" />} onClick={onManual}>Label it myself</Button>
        </div>
        <Button full variant="ghost" icon={<Icon name="table" />} onClick={onSummary}>See match summary · download data</Button>
      </div>
    </div>
  );
}

Object.assign(window, { Popup });

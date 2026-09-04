const NS = window.BadmintonVisionDesignSystem_0ab536;
const { Panel, IconButton, Icon, Badge, StatusChip, StrokeFeedItem, SuggestionRow, StatTile, MixBar, CourtDiagram, ConfidenceMeter, Button } = NS;

/* src/styles.css `.bv-overlay-root .bv-panel` — over video the panels go OPAQUE rather than
   translucent, so text stays legible against bright court footage. */
const OVER_VIDEO = { background: "var(--ink-900)", borderColor: "var(--border-subtle)", boxShadow: "0 8px 24px rgba(0,0,0,.68)" };
const OVER_VIDEO_CHIP = { background: "var(--ink-900)", borderColor: "var(--border-subtle)", backdropFilter: "none", boxShadow: "0 4px 16px rgba(0,0,0,.6)" };
/* exported for App.jsx's overlay action row */
const OVER_VIDEO_BUTTON = { color: "var(--text-primary)", borderColor: "var(--border-subtle)", background: "var(--ink-900)", boxShadow: "0 4px 14px rgba(0,0,0,.55)" };

/** Live overlay (§4.3): independent, collapsible sibling panels anchored to the video rect. */
function LiveOverlay({ density, panels, setPanels, strokes, suggestion, state, onAccept, onCorrect, onOpenPanel }) {
  const minimal = density === "minimal";
  const showStats = !minimal && panels.stats;
  const showMap = !minimal && panels.map;
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      <div style={{ position: "absolute", left: "var(--overlay-gutter)", top: "var(--overlay-gutter)", bottom: "var(--overlay-gutter)", width: "var(--overlay-panel-width)", display: "flex", flexDirection: "column", gap: 10, minHeight: 0, overflow: "hidden", pointerEvents: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto", flexWrap: "wrap" }}>
          <StatusChip state={state.stale ? "stale" : "live"} label={state.stale ? "Analysis behind" : `Rally ${state.rally}`} detail={state.stale ? "+1.2s" : state.time} onClick={onOpenPanel} style={OVER_VIDEO_CHIP} />
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, maxWidth: 280, padding: "4px 7px", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-xs)", background: "var(--ink-900)", color: "var(--text-body)", font: "var(--type-mono)", fontSize: "var(--fs-10)" }}>
            <Icon name="cpu" size={11} />local only
          </span>
        </div>
        {showStats && (
          <Panel draggable title="Stats" mediaTime={state.time} stale={state.stale} icon={<Icon name="activity" size={13} color="var(--text-faint)" />}
            style={{ width: "var(--overlay-panel-width)", ...OVER_VIDEO, minHeight: 96, flex: "0 1 auto", display: "flex", flexDirection: "column" }}
            bodyStyle={{ minHeight: 0, overflow: "auto" }}
            actions={<IconButton size="sm" label="Close stats" icon={<Icon name="x" size={13} />} onClick={() => setPanels({ ...panels, stats: false })} />}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <StatTile label="Rally" value={state.rally} />
              <StatTile label="Shots" value={strokes.length} />
              <StatTile label="Length" value="28.4" unit="s" />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "12px 0" }}>
              <span style={{ font: "var(--type-mono)", fontSize: "var(--fs-12)", color: "var(--text-muted)" }}>21–18 · 14–11</span>
              <Badge tone="warn">score OCR partial</Badge>
            </div>
            <MixBar segments={[{ label: "Clear", value: 5, color: "var(--player-a)" }, { label: "Drop", value: 4, color: "#2f8f77" }, { label: "Smash", value: 3, color: "var(--lime-500)" }, { label: "Net", value: 3, color: "var(--player-b)" }, { label: "Unclassified", value: 2 }]} />
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border-hairline)" }}>
              <span style={{ font: "var(--type-ui-sm)", color: "var(--text-faint)" }}>Last rally end</span>
              <Badge tone="unknown">unclassified</Badge>
              <span style={{ marginLeft: "auto" }}><ConfidenceMeter value={null} size="sm" /></span>
            </div>
          </Panel>
        )}
        {showMap && (
          <Panel draggable title="Court" mediaTime={state.time} icon={<Icon name="crosshair" size={13} color="var(--text-faint)" />}
            style={{ width: 150, ...OVER_VIDEO, flex: "0 0 auto", marginTop: "auto" }} bodyStyle={{ padding: 10 }}
            actions={<IconButton size="sm" label="Close minimap" icon={<Icon name="x" size={13} />} onClick={() => setPanels({ ...panels, map: false })} />}>
            <CourtDiagram width={128} players={[{ x: 3.1, y: 9.7 }, { x: 2.5, y: 4.1, side: "b" }]} trajectory={[{ x: 2.5, y: 4.3 }, { x: 3.5, y: 8.4 }, { x: 4.8, y: 12.9 }]} landing={{ x: 4.8, y: 12.9 }} call="IN" />
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
              <Badge tone="in">IN</Badge>
              <span style={{ font: "var(--type-mono)", fontSize: "var(--fs-10)", color: "var(--text-faint)" }}>0.11 m inside</span>
            </div>
            <div style={{ marginTop: 6 }}><ConfidenceMeter value={0.52} label="geo" size="sm" /></div>
          </Panel>
        )}
      </div>

      <div style={{ position: "absolute", right: "var(--overlay-gutter)", top: "var(--overlay-gutter)", bottom: 88, width: "var(--overlay-panel-width)", display: "flex", flexDirection: "column", minHeight: 0, pointerEvents: "auto" }}>
        {panels.feed && (
          <Panel draggable title="Stroke feed" mediaTime={state.time} stale={state.stale} style={{ ...OVER_VIDEO, minHeight: 0, display: "flex", flexDirection: "column" }} icon={<Icon name="list" size={13} color="var(--text-faint)" />}
            actions={<>
              <IconButton size="sm" label="Open labeling panel (O)" icon={<Icon name="pencil-line" size={13} />} onClick={onOpenPanel} />
              <IconButton size="sm" label="Close feed" icon={<Icon name="x" size={13} />} onClick={() => setPanels({ ...panels, feed: false })} />
            </>}
            bodyStyle={{ padding: "6px", minHeight: 0, overflow: "auto" }}
            footer={<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Badge tone="accent">rally 13 · index 74</Badge>
              <span style={{ marginLeft: "auto" }}><Button size="sm" variant="ghost" onClick={onOpenPanel} iconRight={<Icon name="chevron-right" size={12} />}>Older rallies</Button></span>
            </div>}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 1, maxHeight: 212, overflow: "hidden" }}>
              {strokes.map((s) => <StrokeFeedItem key={s.sequence} {...s} />)}
            </div>
            {suggestion && (
              <div style={{ marginTop: 6 }}>
                <SuggestionRow shot={suggestion.shot} confidence={suggestion.confidence} time={suggestion.time} onAccept={onAccept} onCorrect={onCorrect} />
              </div>
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { LiveOverlay, OVER_VIDEO_CHIP, OVER_VIDEO_BUTTON });

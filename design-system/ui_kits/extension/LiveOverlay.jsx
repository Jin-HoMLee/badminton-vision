const NS = window.BadmintonVisionDesignSystem_0ab536;
const { Panel, IconButton, Icon, Badge, StatusChip, StrokeFeedItem, SuggestionRow, StatTile, MixBar, CourtDiagram, ConfidenceMeter, Button } = NS;

/** Live overlay (§4.3): independent, collapsible sibling panels anchored to the video rect. */
function LiveOverlay({ density, panels, setPanels, strokes, suggestion, state, onAccept, onCorrect, onOpenPanel }) {
  const minimal = density === "minimal";
  const showStats = !minimal && panels.stats;
  const showMap = density === "full" && panels.map;
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      <div style={{ position: "absolute", left: "var(--overlay-gutter)", top: "var(--overlay-gutter)", display: "flex", flexDirection: "column", gap: 10, pointerEvents: "auto" }}>
        <StatusChip state={state.stale ? "stale" : "live"} label={state.stale ? "Analysis behind" : `Rally ${state.rally}`} detail={state.stale ? "+1.2s" : state.time} onClick={onOpenPanel} />
        {showStats && (
          <Panel title="Stats" mediaTime={state.time} stale={state.stale} icon={<Icon name="activity" size={13} color="var(--text-faint)" />} style={{ width: "var(--overlay-panel-width)" }}
            actions={<IconButton size="sm" label="Hide stats" icon={<Icon name="chevron-up" size={13} />} onClick={() => setPanels({ ...panels, stats: false })} />}>
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
      </div>

      {showMap && (
        <div style={{ position: "absolute", left: "var(--overlay-gutter)", bottom: 84, pointerEvents: "auto" }}>
          <Panel title="Court" mediaTime={state.time} icon={<Icon name="crosshair" size={13} color="var(--text-faint)" />} style={{ width: 176 }} bodyStyle={{ padding: 10 }}
            actions={<IconButton size="sm" label="Hide minimap" icon={<Icon name="chevron-down" size={13} />} onClick={() => setPanels({ ...panels, map: false })} />}>
            <CourtDiagram width={154} players={[{ x: 3.1, y: 9.7 }, { x: 2.5, y: 4.1, side: "b" }]} trajectory={[{ x: 2.5, y: 4.3 }, { x: 3.5, y: 8.4 }, { x: 4.8, y: 12.9 }]} landing={{ x: 4.8, y: 12.9 }} call="IN" />
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
              <Badge tone="in">IN</Badge>
              <span style={{ font: "var(--type-mono)", fontSize: "var(--fs-10)", color: "var(--text-faint)" }}>0.11 m inside</span>
            </div>
            <div style={{ marginTop: 6 }}><ConfidenceMeter value={0.52} label="geo" size="sm" /></div>
          </Panel>
        </div>
      )}

      <div style={{ position: "absolute", right: "var(--overlay-gutter)", top: "var(--overlay-gutter)", width: "var(--overlay-panel-width)", pointerEvents: "auto" }}>
        {panels.feed && (
          <Panel title="Stroke feed" mediaTime={state.time} stale={state.stale} icon={<Icon name="list" size={13} color="var(--text-faint)" />}
            actions={<>
              <IconButton size="sm" label="Open labeling panel (O)" icon={<Icon name="pencil-line" size={13} />} onClick={onOpenPanel} />
              <IconButton size="sm" label="Hide feed" icon={<Icon name="chevron-up" size={13} />} onClick={() => setPanels({ ...panels, feed: false })} />
            </>}
            bodyStyle={{ padding: "6px" }}
            footer={<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Badge tone="accent">rally 13 · index 74</Badge>
              <span style={{ marginLeft: "auto" }}><Button size="sm" variant="ghost" onClick={onOpenPanel} iconRight={<Icon name="chevron-right" size={12} />}>Older rallies</Button></span>
            </div>}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 1, maxHeight: 190, overflow: "hidden" }}>
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

Object.assign(window, { LiveOverlay });

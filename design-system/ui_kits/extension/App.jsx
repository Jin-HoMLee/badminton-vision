const NS = window.BadmintonVisionDesignSystem_0ab536;
const { Button, Icon, EmptyState } = NS;

/** Click-through of the whole extension: badge → popup → seed → live overlay → labeling → summary. */
function App() {
  const [view, setView] = React.useState("video");
  const [popup, setPopup] = React.useState(true);
  const [seeding, setSeeding] = React.useState(false);
  const [labeling, setLabeling] = React.useState(false);
  const [density, setDensity] = React.useState("minimal");
  const [panels, setPanels] = React.useState({ feed: true, stats: true, map: true });
  const [state, setState] = React.useState({ enabled: false, seeded: false, stale: false, rally: 14, time: "12:04.320" });
  const [strokes, setStrokes] = React.useState(window.BVDATA.strokes);
  const [suggestion, setSuggestion] = React.useState(window.BVDATA.suggestion);

  const accept = (shot) => {
    const s = shot || suggestion.shot;
    setStrokes((prev) => [...prev.slice(-5), { sequence: prev[prev.length - 1].sequence + 1, player: "A", shot: s, time: suggestion.time, status: shot ? "corrected" : "accepted", source: shot ? "manual" : "auto", confidence: shot ? null : suggestion.confidence }]);
    setSuggestion(null);
    setLabeling(false);
    setTimeout(() => setSuggestion({ shot: "Net Kill", confidence: 0.44, time: "12:06.940" }), 900);
  };

  React.useEffect(() => { if (window.lucide) window.lucide.createIcons && null; }, []);

  if (view === "summary") return <Summary onBack={() => setView("video")} />;

  const popupEl = popup && (
    <div style={{ position: "fixed", right: 18, top: 58, zIndex: 60 }}>
      <Popup
        state={state} density={density} setDensity={setDensity} panels={panels} setPanels={setPanels}
        onClose={() => setPopup(false)}
        onEnable={() => { setPopup(false); state.seeded ? setState({ ...state, enabled: true }) : setSeeding(true); }}
        onSeed={() => { setPopup(false); setSeeding(true); }}
        onManual={() => { setPopup(false); setState({ ...state, enabled: true }); setLabeling(true); }}
        onSummary={() => { setPopup(false); setView("summary"); }}
      />
    </div>
  );

  return (
    <React.Fragment>
    <VideoStage badgeActive={state.enabled} onToggleBadge={() => setPopup(!popup)}>
      {state.enabled && !seeding && (
        <LiveOverlay
          density={density} panels={panels} setPanels={setPanels}
          strokes={strokes} suggestion={suggestion} state={state}
          onAccept={() => accept()} onCorrect={() => setLabeling(true)} onOpenPanel={() => setLabeling(true)}
        />
      )}
      {seeding && <SeedFlow onDone={() => { setSeeding(false); setState({ ...state, seeded: true, enabled: true }); setDensity("balanced"); }} onSkip={() => { setSeeding(false); setState({ ...state, enabled: true }); setLabeling(true); }} onCancel={() => setSeeding(false)} />}
      {labeling && <LabelingPanel suggestion={suggestion || { shot: "Smash", confidence: 0.61 }} onClose={() => setLabeling(false)} onSave={(s) => accept(s)} />}


      {!state.enabled && !seeding && (
        <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", pointerEvents: "auto", borderRadius: "var(--radius-lg)", background: "var(--surface-panel)", backdropFilter: "var(--blur-panel)", border: "1px solid var(--border-hairline)", boxShadow: "var(--shadow-panel)" }}>
          <EmptyState compact icon={<Icon name="mouse-pointer-click" size={20} />} title="Overlay off"
            body={popup ? "Use the popup at the top right: Enable overlay starts the one-time court seed." : "Open the toolbar badge to enable analysis for this match."}
            action={<Button variant="primary" size="sm" onClick={() => { if (popup) { setPopup(false); setSeeding(true); } else setPopup(true); }}>{popup ? "Seed court now" : "Open Badminton Vision"}</Button>} />
        </div>
      )}

      {state.enabled && !seeding && (
        <div style={{ position: "absolute", right: "var(--overlay-gutter)", bottom: 56, display: "flex", gap: 8, pointerEvents: "auto", zIndex: 2 }}>
          <Button size="sm" variant="secondary" icon={<Icon name="sliders-horizontal" size={13} />} style={window.OVER_VIDEO_BUTTON} onClick={() => setDensity(density === "minimal" ? "balanced" : density === "balanced" ? "full" : "minimal")}>
            Density: {density}
          </Button>
          <Button size="sm" variant="secondary" icon={<Icon name="clock" size={13} />} style={window.OVER_VIDEO_BUTTON} onClick={() => setState({ ...state, stale: !state.stale })}>
            {state.stale ? "Caught up" : "Simulate lag"}
          </Button>
          <Button size="sm" variant="secondary" icon={<Icon name="table" size={13} />} style={window.OVER_VIDEO_BUTTON} onClick={() => setView("summary")}>Summary</Button>
        </div>
      )}
    </VideoStage>
    {popupEl}
    </React.Fragment>
  );
}

Object.assign(window, { App });

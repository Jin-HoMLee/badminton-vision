const NS = window.BadmintonVisionDesignSystem_0ab536;
const { Panel, Button, IconButton, Icon, Badge, KeyHint, ShotPicker, DimensionAxis, ConfidenceMeter, Callout, InfoTip } = NS;

/** Hybrid manual labeling panel (§4.4). Keyboard-first, playback never pauses. */
function LabelingPanel({ suggestion, onClose, onSave }) {
  const [shot, setShot] = React.useState(null);
  const [axes, setAxes] = React.useState(() => Object.fromEntries(window.BVDATA.axes.map((a) => [a.label, a.value])));
  return (
    <div style={{ position: "absolute", right: "var(--overlay-gutter)", top: "var(--overlay-gutter)", bottom: "var(--overlay-gutter)", width: "min(380px, calc(100% - 32px))", pointerEvents: "auto" }}>
      <Panel
        draggable
        title="Label this shot"
        mediaTime="12:04.120"
        icon={<Icon name="pencil-line" size={13} color="var(--text-faint)" />}
        actions={<>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, marginRight: 4 }}><KeyHint>Esc</KeyHint></span>
          <IconButton size="sm" label="Close" icon={<Icon name="x" size={13} />} onClick={onClose} />
        </>}
        style={{ height: "100%", display: "flex", flexDirection: "column" }}
        bodyStyle={{ overflow: "auto", flex: 1 }}
        footer={<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Button size="sm" variant="ghost" icon={<Icon name="download" size={13} />}>Export CSV</Button>
          <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button size="sm" variant="primary" onClick={() => onSave(shot || suggestion.shot)} disabled={!shot && !suggestion}>Save shot</Button>
          </span>
        </div>}
      >
        <Callout tone="guide" title="Tell it what you just saw">
          Mark where the shot starts and ends, pick the stroke, then save. The video keeps playing throughout.
        </Callout>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, padding: "8px 10px", borderRadius: "var(--radius-sm)", background: "var(--ink-700)", border: "1px solid var(--border-hairline)" }}>
          <span style={{ font: "var(--type-mono)", fontSize: "var(--fs-11)", color: "var(--text-muted)" }}>12:03.980 → 12:04.420</span>
          <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <Button size="sm" variant="ghost" iconRight={<KeyHint>S</KeyHint>}>Start</Button>
            <Button size="sm" variant="ghost" iconRight={<KeyHint>E</KeyHint>}>End</Button>
          </span>
        </div>

        {suggestion && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
            <Badge tone="warn">its guess</Badge>
            <span style={{ font: "var(--type-ui)", color: shot ? "var(--text-faint)" : "var(--text-primary)", textDecoration: shot ? "line-through" : "none" }}>{suggestion.shot}</span>
            <ConfidenceMeter value={suggestion.confidence} size="sm" />
            <span style={{ marginLeft: "auto", font: "var(--type-ui-sm)", fontSize: "var(--fs-11)", color: "var(--text-faint)", display: "inline-flex", gap: 5, alignItems: "center" }}>accept <KeyHint tone="accent">↵</KeyHint></span>
          </div>
        )}

        <div style={{ font: "var(--type-label)", letterSpacing: "var(--ls-caps)", textTransform: "uppercase", color: "var(--text-faint)", margin: "16px 0 8px" }}>Which stroke was it?</div>
        <ShotPicker value={shot} suggested={suggestion && suggestion.shot} onChange={setShot} columns={3} />

        <div style={{ font: "var(--type-label)", letterSpacing: "var(--ls-caps)", textTransform: "uppercase", color: "var(--text-faint)", margin: "16px 0 10px" }}>How was it played? <span style={{ textTransform: "none", letterSpacing: 0 }}><InfoTip term="How was it played?">Optional detail — side of the body, height, intent. Skip any row you are unsure about; blank is better than a guess.</InfoTip></span></div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {window.BVDATA.axes.map((a) => (
            <DimensionAxis key={a.label} label={a.label} options={a.options} value={axes[a.label]} onChange={(v) => setAxes({ ...axes, [a.label]: v })} />
          ))}
        </div>

        <p style={{ font: "var(--type-ui-sm)", fontSize: "var(--fs-11)", color: "var(--text-faint)", margin: "14px 0 0" }}>
          Your label replaces the guess for this shot — it never adds a duplicate, and the summary counts it as confirmed.
        </p>
      </Panel>
    </div>
  );
}

Object.assign(window, { LabelingPanel });

const NS = window.BadmintonVisionDesignSystem_0ab536;
const { Panel, Button, IconButton, Icon, Badge, KeyHint, ShotPicker, DimensionAxis, ConfidenceMeter } = NS;

/** Hybrid manual labeling panel (§4.4). Keyboard-first, playback never pauses. */
function LabelingPanel({ suggestion, onClose, onSave }) {
  const [shot, setShot] = React.useState(null);
  const [axes, setAxes] = React.useState(() => Object.fromEntries(window.BVDATA.axes.map((a) => [a.label, a.value])));
  return (
    <div style={{ position: "absolute", right: "var(--overlay-gutter)", top: "var(--overlay-gutter)", bottom: 84, width: 380, pointerEvents: "auto" }}>
      <Panel
        title="Manual labeling"
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
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: "var(--radius-sm)", background: "var(--ink-700)", border: "1px solid var(--border-hairline)" }}>
          <span style={{ font: "var(--type-mono)", fontSize: "var(--fs-11)", color: "var(--text-muted)" }}>12:03.980 → 12:04.420</span>
          <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <Button size="sm" variant="ghost" iconRight={<KeyHint>S</KeyHint>}>Start</Button>
            <Button size="sm" variant="ghost" iconRight={<KeyHint>E</KeyHint>}>End</Button>
          </span>
        </div>

        {suggestion && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
            <Badge tone="warn">auto suggestion</Badge>
            <span style={{ font: "var(--type-ui)", color: shot ? "var(--text-faint)" : "var(--text-primary)", textDecoration: shot ? "line-through" : "none" }}>{suggestion.shot}</span>
            <ConfidenceMeter value={suggestion.confidence} size="sm" />
            <span style={{ marginLeft: "auto", font: "var(--type-ui-sm)", fontSize: "var(--fs-11)", color: "var(--text-faint)", display: "inline-flex", gap: 5, alignItems: "center" }}>accept <KeyHint tone="accent">↵</KeyHint></span>
          </div>
        )}

        <div style={{ font: "var(--type-label)", letterSpacing: "var(--ls-caps)", textTransform: "uppercase", color: "var(--text-faint)", margin: "16px 0 8px" }}>Shot family</div>
        <ShotPicker value={shot} suggested={suggestion && suggestion.shot} onChange={setShot} columns={3} />

        <div style={{ font: "var(--type-label)", letterSpacing: "var(--ls-caps)", textTransform: "uppercase", color: "var(--text-faint)", margin: "16px 0 10px" }}>Dimensions</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {window.BVDATA.axes.map((a) => (
            <DimensionAxis key={a.label} label={a.label} options={a.options} value={axes[a.label]} onChange={(v) => setAxes({ ...axes, [a.label]: v })} />
          ))}
        </div>

        <p style={{ font: "var(--type-ui-sm)", fontSize: "var(--fs-11)", color: "var(--text-faint)", margin: "14px 0 0" }}>
          Manual labels are first-class records. Saving updates the same event id and appends provenance — it never creates a duplicate.
        </p>
      </Panel>
    </div>
  );
}

Object.assign(window, { LabelingPanel });

const NS = window.BadmintonVisionDesignSystem_0ab536;
const { Button, IconButton, Icon, Badge, StatTile, MixBar, RallyRow, Chip, SegmentedControl, CourtDiagram } = NS;

const Block = ({ title, meta, children }) => (
  <section style={{ borderRadius: "var(--radius-lg)", border: "1px solid var(--border-hairline)", background: "var(--surface-panel-solid)", padding: 16 }}>
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 14 }}>
      <h2 style={{ font: "var(--type-h3)", color: "var(--text-primary)", margin: 0 }}>{title}</h2>
      {meta && <span style={{ font: "var(--type-mono)", fontSize: "var(--fs-10)", color: "var(--text-faint)" }}>{meta}</span>}
    </div>
    {children}
  </section>
);

/** Match summary & export (§4.5). Opens in a tab; never seeks the player. */
function Summary({ onBack }) {
  const d = window.BVDATA;
  const [filter, setFilter] = React.useState("all");
  const [mapMode, setMapMode] = React.useState("call");
  const L = d.landings;
  const n = (fn) => L.filter(fn).length;
  return (
    <div style={{ minHeight: "100%", background: "var(--ink-900)", padding: "28px 32px 48px" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
        <header style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <IconButton variant="solid" label="Back to video" icon={<Icon name="arrow-left" size={15} />} onClick={onBack} />
          <div>
            <h1 style={{ font: "var(--type-h1)", color: "var(--text-primary)", margin: 0 }}>Match summary</h1>
            <p style={{ font: "var(--type-body-sm)", color: "var(--text-faint)", margin: "4px 0 0" }}>{d.video.title} · local data only, nothing uploaded</p>
          </div>
          <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <Button icon={<Icon name="download" />}>Shots CSV</Button>
            <Button variant="primary" icon={<Icon name="download" />}>Rallies CSV</Button>
          </span>
        </header>

        <Block title="Overview" meta="42 rallies · 249 shots · analysed locally">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 20 }}>
            <StatTile label="Match duration" value="1:12:40" />
            <StatTile label="Rallies" value="42" />
            <StatTile label="Shots" value="249" />
            <StatTile label="Avg rally" value="8.4" unit="shots" note="42 rallies" />
            <StatTile label="Longest rally" value="31" unit="shots" note="rally 23 · 18:42" tone="accent" />
          </div>
        </Block>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Block title="Shot mix" meta="18 unclassified">
            <MixBar segments={d.shotMix} height={10} />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
              {["All", "Player A", "Player B"].map((l) => <Chip key={l} selected={filter === l.toLowerCase()} onClick={() => setFilter(l.toLowerCase())}>{l}</Chip>)}
            </div>
          </Block>
          <Block title="Winner / error attribution" meta="12 unclassified">
            <MixBar segments={d.outcomeMix} height={10} />
            <p style={{ font: "var(--type-ui-sm)", fontSize: "var(--fs-11)", color: "var(--text-faint)", margin: "16px 0 0" }}>
              Attribution needs a known final landing and player identity. Where either is missing the rally stays unclassified rather than being guessed.
            </p>
          </Block>
        </div>

        <Block title="Top rallies" meta="highlights index · deterministic · 42-rally sample">
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {d.rallies.map((r) => <RallyRow key={r.rallyId} {...r} />)}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border-hairline)" }}>
            <Badge tone="warn">*partial</Badge>
            <span style={{ font: "var(--type-ui-sm)", fontSize: "var(--fs-11)", color: "var(--text-faint)" }}>
              index = 0.40 length percentile + 0.25 variety + 0.20 outcome pressure + 0.15 mean tracking confidence. Score OCR unavailable on starred rallies, so outcome pressure used the ordinary-state value.
            </span>
          </div>
        </Block>

        <Block title="Where the shuttle landed" meta={`${n((p) => p.call !== "UNKNOWN")} of ${L.length} shots located · ${n((p) => p.call === "UNKNOWN")} unknown`}>
          <div style={{ display: "flex", gap: 28, alignItems: "flex-start" }}>
            <CourtDiagram width={190} showLabels landings={d.landings} colorBy={mapMode} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14 }}>
              <SegmentedControl value={mapMode} onChange={setMapMode} options={[{ value: "call", label: "By line call" }, { value: "player", label: "By player" }, { value: "pro", label: "Compare to pro", disabled: true }]} />
              <p style={{ font: "var(--type-body-sm)", color: "var(--text-body)", margin: 0, maxWidth: "58ch", textWrap: "pretty" }}>
                One dot per shot: the point on the court where the shuttle came down, for every rally in this match. Dots are projected through the court seed onto the canonical 13.40 × 6.10 m court, so they are comparable across camera angles and across videos.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 20px" }}>
                {(mapMode === "player"
                  ? [["var(--player-a)", "Player A hit it", n((p) => p.side === "a")], ["var(--player-b)", "Player B hit it", n((p) => p.side === "b")]]
                  : [["var(--signal-in)", "Landed in", n((p) => p.call === "IN")], ["var(--signal-out)", "Landed out", n((p) => p.call === "OUT")], ["var(--signal-unknown)", "Not located", n((p) => p.call === "UNKNOWN"), true]]
                ).map(([c, label, count, dashed]) => (
                  <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 7, font: "var(--type-ui-sm)", color: "var(--text-muted)" }}>
                    <span style={{ width: 9, height: 9, borderRadius: 999, background: dashed ? "transparent" : c, border: `1px ${dashed ? "dashed" : "solid"} ${c}` }} />
                    {label}<span style={{ font: "var(--type-mono)", fontSize: "var(--fs-10)", color: "var(--text-faint)" }}>{count}</span>
                  </span>
                ))}
              </div>
              <p style={{ font: "var(--type-ui-sm)", fontSize: "var(--fs-11)", color: "var(--text-faint)", margin: 0, maxWidth: "58ch" }}>
                A 40 mm line belongs to the area it bounds (BWF Law 1.3), so a shuttle touching the line reads IN. Shots the shuttle tracker could not locate stay dashed and are never placed on the court — they are excluded from the counts above, not spread across them.
              </p>
            </div>
          </div>
        </Block>
      </div>
    </div>
  );
}

Object.assign(window, { Summary });

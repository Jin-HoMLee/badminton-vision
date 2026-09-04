const { Icon } = window.BadmintonVisionDesignSystem_0ab536;

/* A deliberately generic video-page shell. It stands in for the host page so the overlay can be
   shown in context; it is not a recreation of any specific site's interface. */
function VideoStage({ children, playing = true, onToggleBadge, badgeActive, time = "12:04" }) {
  const d = window.BVDATA.video;
  return (
    <div style={{ minHeight: "100%", background: "#0e1113", padding: "0 0 40px" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 16, height: 52, padding: "0 20px", borderBottom: "1px solid rgba(255,255,255,.06)" }}>
        <span style={{ width: 96, height: 12, borderRadius: 3, background: "rgba(255,255,255,.12)" }} />
        <div style={{ flex: 1, maxWidth: 420, height: 30, borderRadius: 999, border: "1px solid rgba(255,255,255,.1)", margin: "0 auto" }} />
        <button
          type="button"
          onClick={onToggleBadge}
          title="Badminton Vision"
          style={{
            display: "inline-flex", alignItems: "center", gap: 7, height: 30, padding: "0 12px", cursor: "pointer",
            borderRadius: "var(--radius-pill)", border: `1px solid ${badgeActive ? "var(--lime-600)" : "rgba(255,255,255,.14)"}`,
            background: badgeActive ? "var(--lime-tint)" : "transparent", color: badgeActive ? "var(--lime-500)" : "var(--slate-200)",
            font: "var(--type-ui-sm)", fontFamily: "var(--font-display)", letterSpacing: "-0.01em",
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: 999, background: badgeActive ? "var(--lime-500)" : "var(--slate-400)" }} />
          BV
        </button>
        <span style={{ width: 26, height: 26, borderRadius: 999, background: "rgba(255,255,255,.12)" }} />
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "1280px minmax(0,300px)", gap: 24, padding: "20px", minWidth: 1320, margin: "0 auto" }}>
        <div>
          <div style={{ position: "relative", width: 1280, height: 720, borderRadius: "var(--radius-lg)", overflow: "hidden", background: "#07110f" }}>
            <div style={{ position: "absolute", inset: 0, background: "radial-gradient(120% 80% at 50% 12%,#1b4a3c 0%,#123830 42%,#0a1f1d 78%,#07110f 100%)" }} />
            <div style={{ position: "absolute", left: "50%", top: "18%", width: "78%", height: "68%", transform: "translateX(-50%) perspective(700px) rotateX(52deg)", background: "linear-gradient(#1f6b52,#17513f)", border: "2px solid rgba(233,245,240,.55)", boxShadow: "inset 0 0 0 1px rgba(233,245,240,.18)" }}>
              <div style={{ position: "absolute", inset: 0, borderTop: "2px solid rgba(233,245,240,.4)", borderBottom: "2px solid rgba(233,245,240,.4)", top: "35%", height: "30%" }} />
              <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 2, background: "rgba(233,245,240,.32)" }} />
            </div>
            <div style={{ position: "absolute", left: "50%", top: "34%", width: "82%", height: 3, transform: "translateX(-50%)", background: "rgba(240,248,245,.85)" }} />
            {children}
            <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 64, background: "var(--scrim-bottom)", display: "flex", alignItems: "flex-end", gap: 12, padding: "0 14px 10px" }}>
              <Icon name={playing ? "pause" : "play"} size={18} color="#fff" />
              <Icon name="volume-2" size={18} color="#fff" />
              <span style={{ font: "var(--type-mono)", fontSize: 11, color: "#e8eef0" }}>{time} / {d.duration}</span>
              <div style={{ flex: 1, height: 3, borderRadius: 2, background: "rgba(255,255,255,.25)", marginBottom: 7 }}>
                <div style={{ width: "17%", height: "100%", borderRadius: 2, background: "#ff3b30" }} />
              </div>
              <Icon name="settings" size={18} color="#fff" />
              <Icon name="maximize" size={18} color="#fff" />
            </div>
          </div>
          <h1 style={{ font: "var(--type-h2)", color: "#f1f5f6", margin: "14px 0 6px" }}>{d.title}</h1>
          <p style={{ font: "var(--type-body-sm)", color: "var(--text-faint)", margin: 0 }}>{d.channel} · {d.views} · {d.posted}</p>
        </div>
        <aside style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} style={{ display: "flex", gap: 10 }}>
              <div style={{ width: 108, height: 62, borderRadius: 6, background: "linear-gradient(140deg,#173a31,#0d201d)", flex: "0 0 auto" }} />
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6, paddingTop: 2 }}>
                <span style={{ height: 9, borderRadius: 3, background: "rgba(255,255,255,.12)" }} />
                <span style={{ height: 9, width: "70%", borderRadius: 3, background: "rgba(255,255,255,.08)" }} />
                <span style={{ height: 8, width: "45%", borderRadius: 3, background: "rgba(255,255,255,.06)" }} />
              </div>
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}

Object.assign(window, { VideoStage });

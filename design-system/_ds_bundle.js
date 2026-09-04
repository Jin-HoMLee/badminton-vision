/* @ds-bundle: {"format":4,"namespace":"BadmintonVisionDesignSystem_0ab536","components":[{"name":"DimensionAxis","sourcePath":"components/controls/DimensionAxis.jsx"},{"name":"SegmentedControl","sourcePath":"components/controls/SegmentedControl.jsx"},{"name":"SHOT_FAMILIES","sourcePath":"components/controls/ShotPicker.jsx"},{"name":"ShotPicker","sourcePath":"components/controls/ShotPicker.jsx"},{"name":"Toggle","sourcePath":"components/controls/Toggle.jsx"},{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Chip","sourcePath":"components/core/Chip.jsx"},{"name":"Icon","sourcePath":"components/core/Icon.jsx"},{"name":"IconButton","sourcePath":"components/core/IconButton.jsx"},{"name":"KeyHint","sourcePath":"components/core/KeyHint.jsx"},{"name":"Panel","sourcePath":"components/core/Panel.jsx"},{"name":"CourtDiagram","sourcePath":"components/data/CourtDiagram.jsx"},{"name":"Legend","sourcePath":"components/data/Legend.jsx"},{"name":"MixBar","sourcePath":"components/data/MixBar.jsx"},{"name":"RallyRow","sourcePath":"components/data/RallyRow.jsx"},{"name":"StatTile","sourcePath":"components/data/StatTile.jsx"},{"name":"StrokeFeedItem","sourcePath":"components/data/StrokeFeedItem.jsx"},{"name":"SuggestionRow","sourcePath":"components/data/SuggestionRow.jsx"},{"name":"Callout","sourcePath":"components/feedback/Callout.jsx"},{"name":"ConfidenceMeter","sourcePath":"components/feedback/ConfidenceMeter.jsx"},{"name":"EmptyState","sourcePath":"components/feedback/EmptyState.jsx"},{"name":"InfoTip","sourcePath":"components/feedback/InfoTip.jsx"},{"name":"StatusChip","sourcePath":"components/feedback/StatusChip.jsx"},{"name":"StepDots","sourcePath":"components/feedback/StepDots.jsx"}],"sourceHashes":{"components/controls/DimensionAxis.jsx":"d48a6d1f44c7","components/controls/SegmentedControl.jsx":"2ce27ad6bf25","components/controls/ShotPicker.jsx":"e9a2a87c9eae","components/controls/Toggle.jsx":"0ebde785dd9b","components/core/Badge.jsx":"3af4d646b748","components/core/Button.jsx":"29c4f6218419","components/core/Chip.jsx":"49bddb098434","components/core/Icon.jsx":"76dba62f020c","components/core/IconButton.jsx":"6c5ac4e387d2","components/core/KeyHint.jsx":"dc4269b3e25a","components/core/Panel.jsx":"0f1f804f8df2","components/data/CourtDiagram.jsx":"c11522183a30","components/data/Legend.jsx":"292c2be8d4bb","components/data/MixBar.jsx":"cf6a2d1e99c7","components/data/RallyRow.jsx":"f3eddd9b3fc1","components/data/StatTile.jsx":"5b71b5391122","components/data/StrokeFeedItem.jsx":"e83f30cce6b6","components/data/SuggestionRow.jsx":"509f706440ea","components/feedback/Callout.jsx":"f66b47535e60","components/feedback/ConfidenceMeter.jsx":"4e7379c5862b","components/feedback/EmptyState.jsx":"6bbc0974ac8d","components/feedback/InfoTip.jsx":"ab99114d0aaf","components/feedback/StatusChip.jsx":"1b4292ab0ed9","components/feedback/StepDots.jsx":"aad60008a730","ui_kits/extension/App.jsx":"985a79dc7728","ui_kits/extension/LabelingPanel.jsx":"b98435629e5e","ui_kits/extension/LiveOverlay.jsx":"73f2aa9057c9","ui_kits/extension/Popup.jsx":"ca3535f4e2cd","ui_kits/extension/SeedFlow.jsx":"00484ddc8c48","ui_kits/extension/Summary.jsx":"a388f2b213a7","ui_kits/extension/VideoStage.jsx":"6a9edf1c2eb1","ui_kits/extension/data.js":"1a6b6b227262"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.BadmintonVisionDesignSystem_0ab536 = window.BadmintonVisionDesignSystem_0ab536 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/controls/DimensionAxis.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** One of the five shuttle-insights dimension axes rendered as a compact labelled option row. */
function DimensionAxis({
  label,
  options = [],
  value,
  onChange,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--sp-4)",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      width: "84px",
      flex: "0 0 auto",
      font: "var(--type-label)",
      letterSpacing: "var(--ls-caps)",
      textTransform: "uppercase",
      color: "var(--text-faint)"
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: "var(--sp-2)"
    }
  }, options.map(o => {
    const on = o === value;
    return /*#__PURE__*/React.createElement("button", {
      key: o,
      type: "button",
      "aria-pressed": on,
      onClick: () => onChange && onChange(o),
      style: {
        height: "22px",
        padding: "0 var(--sp-4)",
        borderRadius: "var(--radius-xs)",
        font: "var(--type-ui-sm)",
        fontSize: "var(--fs-11)",
        cursor: "pointer",
        transition: "var(--transition-control)",
        background: on ? "var(--surface-active)" : "transparent",
        color: on ? "var(--text-primary)" : "var(--text-faint)",
        border: `1px solid ${on ? "var(--border-strong)" : "var(--border-hairline)"}`
      }
    }, o);
  })));
}
Object.assign(__ds_scope, { DimensionAxis });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/controls/DimensionAxis.jsx", error: String((e && e.message) || e) }); }

// components/controls/SegmentedControl.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Mutually exclusive choice in one row — density (Minimal / Balanced / Full), summary tabs. */
function SegmentedControl({
  options = [],
  value,
  onChange,
  size = "md",
  full,
  style,
  ...rest
}) {
  const h = size === "sm" ? "var(--control-height-sm)" : "var(--control-height-md)";
  return /*#__PURE__*/React.createElement("div", _extends({
    role: "radiogroup",
    style: {
      display: full ? "flex" : "inline-flex",
      width: full ? "100%" : undefined,
      padding: "2px",
      gap: "2px",
      borderRadius: "var(--radius-md)",
      background: "var(--ink-700)",
      border: "1px solid var(--border-hairline)",
      ...style
    }
  }, rest), options.map(o => {
    const opt = typeof o === "string" ? {
      value: o,
      label: o
    } : o;
    const on = opt.value === value;
    return /*#__PURE__*/React.createElement("button", {
      key: opt.value,
      type: "button",
      role: "radio",
      "aria-checked": on,
      disabled: opt.disabled,
      onClick: () => onChange && onChange(opt.value),
      style: {
        flex: full ? 1 : "0 0 auto",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--sp-3)",
        height: h,
        padding: "0 var(--sp-5)",
        borderRadius: "var(--radius-sm)",
        border: "1px solid transparent",
        font: "var(--type-ui-sm)",
        cursor: opt.disabled ? "not-allowed" : "pointer",
        opacity: opt.disabled ? 0.42 : 1,
        transition: "var(--transition-control)",
        background: on ? "var(--ink-500)" : "transparent",
        color: on ? "var(--text-primary)" : "var(--text-faint)",
        borderColor: on ? "var(--border-subtle)" : "transparent"
      }
    }, opt.icon, opt.label);
  }));
}
Object.assign(__ds_scope, { SegmentedControl });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/controls/SegmentedControl.jsx", error: String((e && e.message) || e) }); }

// components/controls/Toggle.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Binary panel switch: "Stats panel", "Court minimap", "Show confidence". */
function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
  id,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("label", _extends({
    htmlFor: id,
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--sp-5)",
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.42 : 1,
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      minWidth: 0,
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      font: "var(--type-ui)",
      color: "var(--text-primary)"
    }
  }, label), description && /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      marginTop: "var(--sp-1)",
      font: "var(--type-ui-sm)",
      color: "var(--text-faint)"
    }
  }, description)), /*#__PURE__*/React.createElement("button", {
    id: id,
    type: "button",
    role: "switch",
    "aria-checked": !!checked,
    disabled: disabled,
    onClick: () => onChange && onChange(!checked),
    style: {
      position: "relative",
      width: "34px",
      height: "20px",
      flex: "0 0 auto",
      borderRadius: "var(--radius-pill)",
      border: `1px solid ${checked ? "var(--lime-600)" : "var(--border-subtle)"}`,
      background: checked ? "var(--lime-500)" : "var(--ink-600)",
      cursor: "inherit",
      transition: "var(--transition-control)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      top: "2px",
      left: checked ? "16px" : "2px",
      width: "14px",
      height: "14px",
      borderRadius: "var(--radius-pill)",
      background: checked ? "var(--text-on-accent)" : "var(--slate-200)",
      transition: "left var(--dur-fast) var(--ease-standard)"
    }
  })));
}
Object.assign(__ds_scope, { Toggle });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/controls/Toggle.jsx", error: String((e && e.message) || e) }); }

// components/core/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const TONES = {
  neutral: ["var(--surface-active)", "var(--text-muted)", "var(--border-subtle)"],
  accent: ["var(--lime-tint)", "var(--lime-500)", "rgba(200,240,74,.4)"],
  in: ["var(--signal-in-tint)", "var(--signal-in)", "rgba(63,212,139,.4)"],
  out: ["var(--signal-out-tint)", "var(--signal-out)", "rgba(255,107,90,.4)"],
  warn: ["var(--signal-warn-tint)", "var(--signal-warn)", "rgba(255,176,32,.4)"],
  info: ["var(--signal-info-tint)", "var(--signal-info)", "rgba(98,182,255,.4)"],
  unknown: ["var(--signal-unknown-tint)", "var(--signal-unknown)", "rgba(122,139,150,.4)"]
};

/** Small non-interactive status label: shot status, IN/OUT, `auto`/`manual` provenance. */
function Badge({
  tone = "neutral",
  uppercase = true,
  icon,
  children,
  style,
  ...rest
}) {
  const [bg, fg, bd] = TONES[tone] || TONES.neutral;
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: "var(--sp-2)",
      height: "18px",
      padding: "0 var(--sp-3)",
      borderRadius: "var(--radius-xs)",
      background: bg,
      color: fg,
      border: `1px solid ${bd}`,
      font: "var(--type-label)",
      letterSpacing: "var(--ls-caps)",
      textTransform: uppercase ? "uppercase" : "none",
      whiteSpace: "nowrap",
      ...style
    }
  }, rest), icon, children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const SIZES = {
  sm: {
    height: "var(--control-height-sm)",
    padding: "0 var(--sp-4)",
    font: "var(--type-ui-sm)",
    gap: "var(--sp-3)"
  },
  md: {
    height: "var(--control-height-md)",
    padding: "0 var(--sp-5)",
    font: "var(--type-ui)",
    gap: "var(--sp-3)"
  },
  lg: {
    height: "var(--control-height-lg)",
    padding: "0 var(--sp-6)",
    font: "var(--type-ui)",
    gap: "var(--sp-4)"
  }
};
const VARIANTS = {
  primary: {
    background: "var(--accent)",
    color: "var(--text-on-accent)",
    border: "1px solid var(--accent)"
  },
  secondary: {
    background: "var(--surface-raised)",
    color: "var(--text-primary)",
    border: "1px solid var(--border-subtle)"
  },
  ghost: {
    background: "transparent",
    color: "var(--text-muted)",
    border: "1px solid transparent"
  },
  danger: {
    background: "var(--signal-out-tint)",
    color: "var(--signal-out)",
    border: "1px solid rgba(255,107,90,.4)"
  }
};

/** The system's one text-action control. Exactly one `primary` per surface. */
function Button({
  variant = "secondary",
  size = "md",
  icon,
  iconRight,
  full,
  disabled,
  active,
  children,
  style,
  ...rest
}) {
  const s = SIZES[size] || SIZES.md;
  const v = VARIANTS[variant] || VARIANTS.secondary;
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    disabled: disabled,
    "data-variant": variant,
    style: {
      display: full ? "flex" : "inline-flex",
      width: full ? "100%" : undefined,
      alignItems: "center",
      justifyContent: "center",
      gap: s.gap,
      height: s.height,
      padding: s.padding,
      font: s.font,
      letterSpacing: "var(--ls-wide)",
      borderRadius: "var(--radius-sm)",
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.42 : 1,
      transition: "var(--transition-control)",
      whiteSpace: "nowrap",
      ...v,
      ...(active && variant === "ghost" ? {
        background: "var(--surface-active)",
        color: "var(--text-primary)"
      } : null),
      ...style
    },
    onMouseDown: e => !disabled && (e.currentTarget.style.transform = "translateY(1px)"),
    onMouseUp: e => e.currentTarget.style.transform = "none",
    onMouseLeave: e => e.currentTarget.style.transform = "none"
  }, rest), icon, children, iconRight);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Chip.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Selectable pill: shot-family filters, density presets, rally chips. */
function Chip({
  selected,
  disabled,
  icon,
  count,
  children,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    disabled: disabled,
    "aria-pressed": !!selected,
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: "var(--sp-3)",
      height: "var(--control-height-sm)",
      padding: "0 var(--sp-4)",
      borderRadius: "var(--radius-pill)",
      font: "var(--type-ui-sm)",
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.42 : 1,
      transition: "var(--transition-control)",
      background: selected ? "var(--lime-tint)" : "var(--surface-raised)",
      color: selected ? "var(--lime-500)" : "var(--text-muted)",
      border: `1px solid ${selected ? "rgba(200,240,74,.45)" : "var(--border-hairline)"}`,
      ...style
    }
  }, rest), icon, children, count != null && /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-mono)",
      fontSize: "var(--fs-11)",
      color: selected ? "var(--lime-400)" : "var(--text-faint)"
    }
  }, count));
}
Object.assign(__ds_scope, { Chip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Chip.jsx", error: String((e && e.message) || e) }); }

// components/core/Icon.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const PASCAL = n => String(n).replace(/(^|[-_ ])(\w)/g, (_, __, c) => c.toUpperCase());

/** Lucide wrapper. Lucide is loaded from CDN (see readme ICONOGRAPHY); this component
 *  reads the icon node spec off `window.lucide.icons` and renders it as a real React <svg>. */
function Icon({
  name,
  size = 16,
  strokeWidth = 1.75,
  color = "currentColor",
  style,
  ...rest
}) {
  const lib = typeof window !== "undefined" && window.lucide && window.lucide.icons;
  let spec = lib && (lib[PASCAL(name)] || lib[name]);
  if (spec && spec[0] === "svg") spec = spec[2];
  const children = Array.isArray(spec) ? spec.map((node, i) => {
    const [tag, attrs] = Array.isArray(node) ? node : ["path", node];
    return React.createElement(tag, {
      ...attrs,
      key: i
    });
  }) : [React.createElement("circle", {
    key: "f",
    cx: 12,
    cy: 12,
    r: 4
  })];
  return /*#__PURE__*/React.createElement("svg", _extends({
    xmlns: "http://www.w3.org/2000/svg",
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth: strokeWidth,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true",
    style: {
      display: "block",
      flex: "0 0 auto",
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Icon });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Icon.jsx", error: String((e && e.message) || e) }); }

// components/core/IconButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Square icon-only control for overlay chrome: collapse, drag, close, undo. */
function IconButton({
  icon,
  label,
  size = "md",
  variant = "ghost",
  active,
  disabled,
  style,
  ...rest
}) {
  const dim = size === "sm" ? "var(--control-height-sm)" : size === "lg" ? "var(--control-height-lg)" : "var(--control-height-md)";
  const tone = variant === "solid" ? {
    background: "var(--surface-raised)",
    border: "1px solid var(--border-subtle)",
    color: "var(--text-primary)"
  } : {
    background: active ? "var(--surface-active)" : "transparent",
    border: "1px solid transparent",
    color: active ? "var(--text-primary)" : "var(--text-muted)"
  };
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    "aria-label": label,
    title: label,
    disabled: disabled,
    style: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: dim,
      height: dim,
      borderRadius: "var(--radius-sm)",
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.42 : 1,
      transition: "var(--transition-control)",
      ...tone,
      ...style
    }
  }, rest), icon);
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/core/KeyHint.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Keyboard shortcut glyph. The labeling flow is keyboard-first, so shortcuts are shown, never hidden. */
function KeyHint({
  children,
  tone = "neutral",
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("kbd", _extends({
    style: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      minWidth: "18px",
      height: "18px",
      padding: "0 var(--sp-2)",
      borderRadius: "var(--radius-xs)",
      background: tone === "accent" ? "var(--lime-tint)" : "var(--ink-600)",
      color: tone === "accent" ? "var(--lime-500)" : "var(--text-faint)",
      border: `1px solid ${tone === "accent" ? "rgba(200,240,74,.35)" : "var(--border-subtle)"}`,
      boxShadow: "0 1px 0 rgba(0,0,0,.5)",
      font: "var(--type-mono)",
      fontSize: "var(--fs-10)",
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { KeyHint });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/KeyHint.jsx", error: String((e && e.message) || e) }); }

// components/controls/ShotPicker.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const SHOT_FAMILIES = ["Serve", "Clear", "Drop", "Smash", "Half Smash", "Lift", "Net Shot", "Net Kill", "Push", "Drive", "Block"];

/** The 11-shot taxonomy grid carried over from shuttle-insights. Keys 1–9 map to the first nine. */
function ShotPicker({
  value,
  onChange,
  suggested,
  columns = 4,
  showKeys = true,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: "grid",
      gridTemplateColumns: `repeat(${columns},1fr)`,
      gap: "var(--sp-3)",
      ...style
    }
  }, rest), SHOT_FAMILIES.map((shot, i) => {
    const on = value === shot;
    const isSuggested = !on && suggested === shot;
    return /*#__PURE__*/React.createElement("button", {
      key: shot,
      type: "button",
      "aria-pressed": on,
      onClick: () => onChange && onChange(shot),
      style: {
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--sp-3)",
        height: "var(--control-height-lg)",
        padding: "0 var(--sp-4)",
        borderRadius: "var(--radius-sm)",
        font: "var(--type-ui-sm)",
        cursor: "pointer",
        textAlign: "left",
        transition: "var(--transition-control)",
        background: on ? "var(--lime-500)" : "var(--surface-raised)",
        color: on ? "var(--text-on-accent)" : isSuggested ? "var(--lime-400)" : "var(--text-body)",
        border: `1px ${isSuggested ? "dashed" : "solid"} ${on ? "var(--lime-500)" : isSuggested ? "rgba(200,240,74,.55)" : "var(--border-hairline)"}`
      }
    }, shot, showKeys && i < 9 && /*#__PURE__*/React.createElement(__ds_scope.KeyHint, {
      tone: on ? "accent" : "neutral"
    }, i + 1));
  }));
}
Object.assign(__ds_scope, { SHOT_FAMILIES, ShotPicker });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/controls/ShotPicker.jsx", error: String((e && e.message) || e) }); }

// components/core/Panel.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const NUDGE = 16;
const RESIZE_NUDGE = 16;

/** The overlay's glass container. Every floating surface in the product is a Panel:
 *  header row (drag handle + title + actions), optional media-time stamp, body.
 *  `draggable` turns the header into a grab handle: pointer-drag it, or focus it and use
 *  the arrow keys (Home resets position). The panel keeps its layout slot and moves by
 *  transform, so dragging one panel never reflows the others. Every draggable panel also
 *  gets a header chevron that COLLAPSES it (header-only, content stays mounted) — distinct
 *  from a caller-supplied close/hide action, which unmounts the panel entirely. `resizable`
 *  (default true when draggable) adds a bottom-right grip handle: drag it, or focus it and
 *  use the arrow keys (Home resets size). */
function Panel({
  title,
  icon,
  mediaTime,
  stale,
  actions,
  collapsed,
  onToggleCollapse,
  collapsible = true,
  resizable,
  footer,
  tone = "glass",
  draggable,
  children,
  style,
  bodyStyle,
  ...rest
}) {
  const [offset, setOffset] = React.useState({
    x: 0,
    y: 0
  });
  const [size, setSize] = React.useState(null);
  const [dragging, setDragging] = React.useState(false);
  const [internalCollapsed, setInternalCollapsed] = React.useState(false);
  const from = React.useRef(null);
  const resizeFrom = React.useRef(null);
  const isCollapsed = collapsed != null ? collapsed : internalCollapsed;
  const canResize = resizable != null ? resizable : draggable;
  const setCollapsed = next => onToggleCollapse ? onToggleCollapse(next) : setInternalCollapsed(next);
  const onPointerDown = e => {
    if (!draggable || e.target.closest("button")) return;
    e.preventDefault();
    setDragging(true);
    from.current = {
      x: e.clientX - offset.x,
      y: e.clientY - offset.y
    };
    const move = ev => from.current && setOffset({
      x: ev.clientX - from.current.x,
      y: ev.clientY - from.current.y
    });
    const up = () => {
      from.current = null;
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const onKeyDown = e => {
    if (!draggable) return;
    const step = {
      ArrowLeft: [-NUDGE, 0],
      ArrowRight: [NUDGE, 0],
      ArrowUp: [0, -NUDGE],
      ArrowDown: [0, NUDGE]
    }[e.key];
    if (step) {
      e.preventDefault();
      setOffset(o => ({
        x: o.x + step[0],
        y: o.y + step[1]
      }));
    }
    if (e.key === "Home") {
      e.preventDefault();
      setOffset({
        x: 0,
        y: 0
      });
    }
  };
  const onResizePointerDown = e => {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.parentElement.getBoundingClientRect();
    resizeFrom.current = {
      x: e.clientX,
      y: e.clientY,
      w: size?.width ?? rect.width,
      h: size?.height ?? rect.height
    };
    const move = ev => resizeFrom.current && setSize({
      width: Math.max(160, resizeFrom.current.w + (ev.clientX - resizeFrom.current.x)),
      height: Math.max(96, resizeFrom.current.h + (ev.clientY - resizeFrom.current.y))
    });
    const up = () => {
      resizeFrom.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const onResizeKeyDown = e => {
    const step = {
      ArrowLeft: [-RESIZE_NUDGE, 0],
      ArrowRight: [RESIZE_NUDGE, 0],
      ArrowUp: [0, -RESIZE_NUDGE],
      ArrowDown: [0, RESIZE_NUDGE]
    }[e.key];
    if (step) {
      e.preventDefault();
      setSize(s => ({
        width: Math.max(160, (s?.width ?? 240) + step[0]),
        height: Math.max(96, (s?.height ?? 160) + step[1])
      }));
    }
    if (e.key === "Home") {
      e.preventDefault();
      setSize(null);
    }
  };
  return /*#__PURE__*/React.createElement("section", _extends({
    style: {
      width: size?.width ?? "100%",
      height: size?.height,
      transform: offset.x || offset.y ? `translate(${offset.x}px, ${offset.y}px)` : undefined,
      borderRadius: "var(--radius-lg)",
      background: tone === "solid" ? "var(--surface-panel-solid)" : "var(--surface-panel)",
      backdropFilter: tone === "solid" ? undefined : "var(--blur-panel)",
      WebkitBackdropFilter: tone === "solid" ? undefined : "var(--blur-panel)",
      border: "1px solid var(--border-hairline)",
      boxShadow: "var(--shadow-panel)",
      overflow: "hidden",
      position: draggable ? "relative" : undefined,
      ...style
    }
  }, rest), (title || actions || draggable && collapsible) && /*#__PURE__*/React.createElement("header", {
    onPointerDown: onPointerDown,
    onKeyDown: onKeyDown,
    tabIndex: draggable ? 0 : undefined,
    role: draggable ? "group" : undefined,
    "aria-label": draggable ? `${title || "Panel"} header; drag to move, or use arrow keys` : undefined,
    "aria-keyshortcuts": draggable ? "ArrowLeft ArrowRight ArrowUp ArrowDown Home" : undefined,
    "aria-grabbed": draggable ? dragging : undefined,
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--sp-4)",
      height: "32px",
      padding: "0 var(--sp-3) 0 var(--sp-5)",
      borderBottom: isCollapsed ? "none" : "1px solid var(--border-hairline)",
      background: "rgba(255,255,255,.02)",
      cursor: draggable ? dragging ? "grabbing" : "grab" : undefined,
      touchAction: draggable ? "none" : undefined,
      userSelect: draggable ? "none" : undefined
    }
  }, icon, /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      font: "var(--type-label)",
      letterSpacing: "var(--ls-caps)",
      textTransform: "uppercase",
      color: "var(--text-muted)"
    }
  }, title), mediaTime && !isCollapsed && /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-mono)",
      fontSize: "var(--fs-10)",
      color: stale ? "var(--signal-warn)" : "var(--text-faint)"
    }
  }, mediaTime, stale ? " · stale" : ""), /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: "auto",
      display: "flex",
      alignItems: "center",
      gap: "var(--sp-1)"
    }
  }, draggable && collapsible && /*#__PURE__*/React.createElement(__ds_scope.IconButton, {
    size: "sm",
    label: (isCollapsed ? "Expand " : "Collapse ") + (title || "panel").toLowerCase() + " panel",
    "aria-expanded": !isCollapsed,
    icon: /*#__PURE__*/React.createElement("svg", {
      width: "13",
      height: "13",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "1.75",
      strokeLinecap: "round",
      strokeLinejoin: "round"
    }, /*#__PURE__*/React.createElement("path", {
      d: isCollapsed ? "m6 9 6 6 6-6" : "m18 15-6-6-6 6"
    })),
    onClick: e => {
      e.stopPropagation();
      setCollapsed(!isCollapsed);
    }
  }), actions)), !isCollapsed && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "var(--sp-5)",
      minHeight: 0,
      ...bodyStyle
    }
  }, children), !isCollapsed && footer && /*#__PURE__*/React.createElement("footer", {
    style: {
      padding: "var(--sp-4) var(--sp-5)",
      borderTop: "1px solid var(--border-hairline)",
      background: "rgba(0,0,0,.18)"
    }
  }, footer), draggable && canResize && !isCollapsed && /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": `Resize ${(title || "panel").toLowerCase()} panel`,
    "aria-keyshortcuts": "ArrowLeft ArrowRight ArrowUp ArrowDown Home",
    title: "Drag to resize. Use arrow keys for precise sizing; Home resets the size.",
    onPointerDown: onResizePointerDown,
    onKeyDown: onResizeKeyDown,
    style: {
      position: "absolute",
      right: 2,
      bottom: 2,
      width: 18,
      height: 18,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 0,
      border: 0,
      borderRadius: "var(--radius-xs)",
      background: "transparent",
      color: "var(--text-faint)",
      cursor: "nwse-resize",
      touchAction: "none",
      opacity: 0.7
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "12",
    height: "12",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.75",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "9",
    cy: "5",
    r: "1",
    fill: "currentColor",
    stroke: "none"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "15",
    cy: "5",
    r: "1",
    fill: "currentColor",
    stroke: "none"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "9",
    cy: "12",
    r: "1",
    fill: "currentColor",
    stroke: "none"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "15",
    cy: "12",
    r: "1",
    fill: "currentColor",
    stroke: "none"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "9",
    cy: "19",
    r: "1",
    fill: "currentColor",
    stroke: "none"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "15",
    cy: "19",
    r: "1",
    fill: "currentColor",
    stroke: "none"
  }))));
}
Object.assign(__ds_scope, { Panel });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Panel.jsx", error: String((e && e.message) || e) }); }

// components/data/CourtDiagram.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Canonical BWF court (Laws of Badminton §4.1, Diagram A) drawn from real dimensions in metres:
 *  13.40 × 6.10 m, 40 mm lines, net at y=6.70, short service lines at 4.72 / 8.68,
 *  singles sidelines at 0.46 / 5.64, centre line at 3.05, doubles long service at 0.76 / 12.64.
 *  Coordinates are in metres; the component scales, never re-measures. */
function CourtDiagram({
  width = 240,
  players = [],
  trajectory,
  landing,
  landings,
  colorBy = "call",
  call,
  showLabels = false,
  style,
  ...rest
}) {
  const M = 0.55; // outside margin in metres
  const W = 6.1 + M * 2;
  const H = 13.4 + M * 2;
  const s = width / W;
  const lw = 0.04;
  const X = x => x + M;
  const Y = y => y + M;
  const line = (x1, y1, x2, y2, k, opts = {}) => /*#__PURE__*/React.createElement("line", _extends({
    key: k,
    x1: X(x1),
    y1: Y(y1),
    x2: X(x2),
    y2: Y(y2),
    stroke: "var(--court-line)",
    strokeWidth: lw,
    strokeLinecap: "square"
  }, opts));
  const callColor = call === "IN" ? "var(--signal-in)" : call === "OUT" ? "var(--signal-out)" : "var(--signal-unknown)";
  return /*#__PURE__*/React.createElement("svg", _extends({
    viewBox: `0 0 ${W} ${H}`,
    width: width,
    height: width * (H / W),
    style: {
      display: "block",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("rect", {
    x: "0",
    y: "0",
    width: W,
    height: H,
    rx: 0.35,
    fill: "var(--court-fill-alt)"
  }), /*#__PURE__*/React.createElement("rect", {
    x: X(0),
    y: Y(0),
    width: "6.10",
    height: "13.40",
    fill: "var(--court-fill)"
  }), [line(0, 0, 6.1, 0, "back-a"), line(0, 13.4, 6.1, 13.4, "back-b"), line(0, 0, 0, 13.4, "side-l"), line(6.1, 0, 6.1, 13.4, "side-r"), line(0.46, 0, 0.46, 13.4, "sgl-l", {
    opacity: 0.75
  }), line(5.64, 0, 5.64, 13.4, "sgl-r", {
    opacity: 0.75
  }), line(0, 4.72, 6.1, 4.72, "svc-a", {
    opacity: 0.75
  }), line(0, 8.68, 6.1, 8.68, "svc-b", {
    opacity: 0.75
  }), line(0, 0.76, 6.1, 0.76, "dls-a", {
    opacity: 0.55
  }), line(0, 12.64, 6.1, 12.64, "dls-b", {
    opacity: 0.55
  }), line(3.05, 0, 3.05, 4.72, "ctr-a", {
    opacity: 0.75
  }), line(3.05, 8.68, 3.05, 13.4, "ctr-b", {
    opacity: 0.75
  })], /*#__PURE__*/React.createElement("line", {
    x1: X(-0.28),
    y1: Y(6.7),
    x2: X(6.38),
    y2: Y(6.7),
    stroke: "var(--court-net)",
    strokeWidth: 0.07
  }), /*#__PURE__*/React.createElement("line", {
    x1: X(-0.28),
    y1: Y(6.7),
    x2: X(6.38),
    y2: Y(6.7),
    stroke: "var(--court-net)",
    strokeWidth: 0.24,
    strokeDasharray: "0.09 0.09",
    opacity: "0.35"
  }), trajectory && trajectory.length > 1 && /*#__PURE__*/React.createElement("polyline", {
    points: trajectory.map(p => `${X(p.x)},${Y(p.y)}`).join(" "),
    fill: "none",
    stroke: "var(--lime-500)",
    strokeWidth: 0.06,
    strokeLinecap: "round",
    strokeDasharray: "0.22 0.16",
    opacity: "0.9"
  }), landing && /*#__PURE__*/React.createElement("g", null, /*#__PURE__*/React.createElement("circle", {
    cx: X(landing.x),
    cy: Y(landing.y),
    r: 0.34,
    fill: "none",
    stroke: callColor,
    strokeWidth: 0.05,
    opacity: "0.55"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: X(landing.x),
    cy: Y(landing.y),
    r: 0.14,
    fill: callColor
  })), landings && landings.map((p, i) => {
    const c = colorBy === "player" ? p.side === "b" ? "var(--player-b)" : "var(--player-a)" : p.call === "IN" ? "var(--signal-in)" : p.call === "OUT" ? "var(--signal-out)" : "var(--signal-unknown)";
    return p.call === "UNKNOWN" ? /*#__PURE__*/React.createElement("circle", {
      key: i,
      cx: X(p.x),
      cy: Y(p.y),
      r: 0.13,
      fill: "none",
      stroke: c,
      strokeWidth: 0.045,
      strokeDasharray: "0.09 0.07"
    }) : /*#__PURE__*/React.createElement("circle", {
      key: i,
      cx: X(p.x),
      cy: Y(p.y),
      r: 0.13,
      fill: c,
      fillOpacity: 0.72
    });
  }), players.map((p, i) => /*#__PURE__*/React.createElement("g", {
    key: i
  }, /*#__PURE__*/React.createElement("circle", {
    cx: X(p.x),
    cy: Y(p.y),
    r: 0.36,
    fill: p.side === "b" ? "var(--player-b)" : "var(--player-a)",
    opacity: "0.22"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: X(p.x),
    cy: Y(p.y),
    r: 0.19,
    fill: p.side === "b" ? "var(--player-b)" : "var(--player-a)"
  }))), showLabels && /*#__PURE__*/React.createElement("g", {
    fill: "var(--text-faint)",
    fontSize: "0.34",
    fontFamily: "var(--font-mono)"
  }, /*#__PURE__*/React.createElement("text", {
    x: X(3.05),
    y: Y(-0.16),
    textAnchor: "middle"
  }, "6.10 m"), /*#__PURE__*/React.createElement("text", {
    x: X(6.44),
    y: Y(6.7),
    textAnchor: "start",
    dominantBaseline: "middle"
  }, "net")));
}
Object.assign(__ds_scope, { CourtDiagram });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/CourtDiagram.jsx", error: String((e && e.message) || e) }); }

// components/data/Legend.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Says what each colour means. Any coloured mark in this product — dots on the court,
 *  segments in a bar, player rules in the feed — must be explained by one of these. */
function Legend({
  items = [],
  size = 9,
  direction = "row",
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: "flex",
      flexDirection: direction,
      flexWrap: "wrap",
      gap: direction === "row" ? "8px 18px" : "6px",
      ...style
    }
  }, rest), items.map((it, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: "var(--sp-3)",
      font: "var(--type-ui-sm)",
      fontSize: "var(--fs-11)",
      color: "var(--text-muted)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: size,
      height: it.shape === "bar" ? 3 : size,
      flex: "0 0 auto",
      borderRadius: it.shape === "bar" ? 1 : "var(--radius-pill)",
      background: it.dashed ? "transparent" : it.color,
      border: it.dashed ? `1px dashed ${it.color}` : "none"
    }
  }), it.label, it.value != null && /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-mono)",
      fontSize: "var(--fs-10)",
      color: "var(--text-faint)"
    }
  }, it.value))));
}
Object.assign(__ds_scope, { Legend });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/Legend.jsx", error: String((e && e.message) || e) }); }

// components/data/MixBar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Horizontal proportion bar for shot mix / winner-error mix. Unknown share is always drawn. */
function MixBar({
  segments = [],
  height = 8,
  showLegend = true,
  style,
  ...rest
}) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--sp-4)",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "2px",
      height: `${height}px`,
      borderRadius: "var(--radius-xs)",
      overflow: "hidden"
    }
  }, segments.map((s, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    title: `${s.label}: ${s.value}`,
    style: {
      width: `${s.value / total * 100}%`,
      background: s.color || "var(--signal-unknown)"
    }
  }))), showLegend && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: "var(--sp-3) var(--sp-5)"
    }
  }, segments.map((s, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: "var(--sp-3)",
      font: "var(--type-ui-sm)",
      fontSize: "var(--fs-11)",
      color: "var(--text-muted)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: "7px",
      height: "7px",
      borderRadius: "2px",
      background: s.color || "var(--signal-unknown)"
    }
  }), s.label, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-mono)",
      fontSize: "var(--fs-10)",
      color: "var(--text-faint)"
    }
  }, Math.round(s.value / total * 100), "%")))));
}
Object.assign(__ds_scope, { MixBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/MixBar.jsx", error: String((e && e.message) || e) }); }

// components/data/RallyRow.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** A ranked rally row on the match summary: index score, shots, duration, outcome, review timestamp.
 *  The timestamp is a review affordance only — v1 never seeks the player. */
function RallyRow({
  rank,
  rallyId,
  index,
  shots,
  duration,
  outcome = "unclassified",
  timestamp,
  partial,
  onReview,
  style,
  ...rest
}) {
  const tone = outcome === "winner" ? "in" : outcome === "forced error" ? "warn" : outcome === "unforced error" ? "out" : "unknown";
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: "grid",
      gridTemplateColumns: "22px 44px 1fr auto auto",
      alignItems: "center",
      gap: "var(--sp-5)",
      padding: "var(--sp-4) var(--sp-5)",
      borderRadius: "var(--radius-sm)",
      border: "1px solid var(--border-hairline)",
      background: "rgba(255,255,255,.02)",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-mono)",
      fontSize: "var(--fs-11)",
      color: "var(--text-faint)"
    }
  }, rank), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      alignItems: "baseline",
      gap: "2px"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-mono)",
      fontSize: "var(--fs-18)",
      fontWeight: "var(--fw-semibold)",
      color: "var(--lime-500)"
    }
  }, index), partial && /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-mono)",
      fontSize: "var(--fs-10)",
      color: "var(--signal-warn)"
    }
  }, "*")), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--sp-1)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-ui)",
      color: "var(--text-primary)"
    }
  }, "Rally ", rallyId), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-mono)",
      fontSize: "var(--fs-10)",
      color: "var(--text-faint)"
    }
  }, shots, " shots \xB7 ", duration)), /*#__PURE__*/React.createElement(__ds_scope.Badge, {
    tone: tone
  }, outcome), /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onReview,
    style: {
      display: "inline-flex",
      alignItems: "center",
      height: "var(--control-height-sm)",
      padding: "0 var(--sp-4)",
      borderRadius: "var(--radius-sm)",
      background: "transparent",
      border: "1px solid var(--border-subtle)",
      color: "var(--text-muted)",
      font: "var(--type-mono)",
      fontSize: "var(--fs-11)",
      cursor: "pointer",
      transition: "var(--transition-control)"
    }
  }, timestamp));
}
Object.assign(__ds_scope, { RallyRow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/RallyRow.jsx", error: String((e && e.message) || e) }); }

// components/data/StatTile.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** A single statistic. Mono numerals, uppercase micro-label, optional unit and partial-data note. */
function StatTile({
  label,
  value,
  unit,
  note,
  tone = "default",
  align = "left",
  style,
  ...rest
}) {
  const color = tone === "accent" ? "var(--lime-500)" : tone === "muted" ? "var(--text-faint)" : "var(--text-primary)";
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--sp-2)",
      alignItems: align === "center" ? "center" : "flex-start",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-label)",
      letterSpacing: "var(--ls-caps)",
      textTransform: "uppercase",
      color: "var(--text-faint)"
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      alignItems: "baseline",
      gap: "var(--sp-2)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-mono)",
      fontSize: "var(--fs-22)",
      fontWeight: "var(--fw-semibold)",
      color,
      letterSpacing: "var(--ls-tight)"
    }
  }, value), unit && /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-ui-sm)",
      color: "var(--text-faint)"
    }
  }, unit)), note && /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-ui-sm)",
      fontSize: "var(--fs-11)",
      color: "var(--text-faint)"
    }
  }, note));
}
Object.assign(__ds_scope, { StatTile });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/StatTile.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Callout.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const TONES = {
  guide: ["var(--lime-tint)", "rgba(200,240,74,.35)", "var(--lime-500)", "lightbulb"],
  info: ["var(--signal-info-tint)", "rgba(98,182,255,.35)", "var(--signal-info)", "info"],
  warn: ["var(--signal-warn-tint)", "rgba(255,176,32,.35)", "var(--signal-warn)", "triangle-alert"],
  quiet: ["rgba(255,255,255,.03)", "var(--border-hairline)", "var(--text-faint)", "info"]
};
let tooltipSeq = 0;
function firstSentence(text) {
  const match = /^([\s\S]*?\.)\s+[\s\S]+$/.exec(String(text == null ? "" : text));
  return match ? match[1] : null;
}

/** A one-line explanation of what the user is looking at or what to do next.
 *  Used at the top of any surface a first-time user could misread.
 *  `tooltip` collapses multi-sentence body copy to its first sentence with an
 *  ellipsis, opening the full body in a tooltip on hover or keyboard focus — so a
 *  callout never grows into standing paragraph text. Nothing is lost for keyboard
 *  or screen-reader users: the summary is focusable and `aria-describedby` points
 *  at the tooltip node, which always holds the whole body. Single-sentence bodies
 *  have nothing to collapse and render plainly regardless of this prop. */
function Callout({
  tone = "guide",
  icon,
  title,
  children,
  action,
  onDismiss,
  tooltip,
  style,
  ...rest
}) {
  const [bg, bd, fg, defaultIcon] = TONES[tone] || TONES.guide;
  const fullText = typeof children === "string" ? children : null;
  const summary = tooltip && fullText ? firstSentence(fullText) : null;
  const compact = summary !== null && summary.length < (fullText || "").length;
  const tooltipId = React.useMemo(() => compact ? `bv-callout-tooltip-${++tooltipSeq}` : null, [compact]);
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: "flex",
      alignItems: "flex-start",
      gap: "var(--sp-4)",
      padding: "var(--sp-4) var(--sp-5)",
      borderRadius: "var(--radius-md)",
      background: bg,
      border: `1px solid ${bd}`,
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      color: fg,
      paddingTop: 1
    }
  }, icon || /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: defaultIcon,
    size: 14
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      minWidth: 0,
      display: "flex",
      flexDirection: "column",
      gap: 3,
      position: compact ? "relative" : undefined
    }
  }, title && /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-ui)",
      color: "var(--text-primary)"
    }
  }, title), compact ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
    tabIndex: 0,
    "aria-describedby": tooltipId,
    style: {
      display: "block",
      overflow: "hidden",
      whiteSpace: "nowrap",
      textOverflow: "ellipsis",
      cursor: "help",
      font: "var(--type-ui-sm)",
      fontSize: "var(--fs-12)",
      color: "var(--text-muted)"
    }
  }, summary), /*#__PURE__*/React.createElement("span", {
    role: "tooltip",
    id: tooltipId,
    style: {
      display: "none",
      position: "absolute",
      zIndex: 40,
      left: 0,
      top: "calc(100% + 6px)",
      width: 244,
      maxWidth: "70vw",
      boxSizing: "border-box",
      padding: "9px 11px",
      borderRadius: "var(--radius-md)",
      background: "var(--ink-800)",
      border: "1px solid var(--border-subtle)",
      boxShadow: "var(--shadow-raised)",
      textAlign: "left",
      whiteSpace: "normal",
      font: "var(--type-ui-sm)",
      fontSize: "var(--fs-12)",
      lineHeight: "var(--lh-normal)",
      color: "var(--text-body)"
    },
    className: "bv-ds-callout-tooltip"
  }, fullText)) : /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-ui-sm)",
      fontSize: "var(--fs-12)",
      lineHeight: "var(--lh-normal)",
      color: "var(--text-muted)",
      textWrap: "pretty"
    }
  }, children), action && /*#__PURE__*/React.createElement("span", {
    style: {
      marginTop: "var(--sp-3)"
    }
  }, action)), onDismiss && /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": "Dismiss",
    onClick: onDismiss,
    style: {
      background: "none",
      border: "none",
      padding: 2,
      cursor: "pointer",
      color: "var(--text-faint)"
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "x",
    size: 13
  })), compact && /*#__PURE__*/React.createElement("style", null, `.bv-ds-callout-tooltip{}
span:focus-within > .bv-ds-callout-tooltip, span:hover > .bv-ds-callout-tooltip{display:block !important}`));
}
Object.assign(__ds_scope, { Callout });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Callout.jsx", error: String((e && e.message) || e) }); }

// components/feedback/ConfidenceMeter.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const band = v => v == null ? "unknown" : v >= 0.75 ? "high" : v >= 0.45 ? "medium" : "low";
const COLORS = {
  high: "var(--conf-high)",
  medium: "var(--conf-medium)",
  low: "var(--conf-low)",
  unknown: "var(--conf-unknown)"
};
const WORDS = {
  high: "sure",
  medium: "fairly sure",
  low: "not sure",
  unknown: "unknown"
};

/** Confidence is shown as a 4-segment bar, never as a bare percentage that reads like certainty.
 *  `value == null` renders the honest "unknown" state required by the PRD. */
function ConfidenceMeter({
  value,
  label,
  showValue = true,
  showWord = false,
  size = "md",
  style,
  ...rest
}) {
  const b = band(value);
  const color = COLORS[b];
  const filled = value == null ? 0 : Math.max(1, Math.round(value * 4));
  const w = size === "sm" ? 6 : 9;
  const h = size === "sm" ? 3 : 4;
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: "var(--sp-3)",
      ...style
    },
    title: value == null ? "confidence unknown" : `confidence ${Math.round(value * 100)}%`
  }, rest), label && /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-label)",
      letterSpacing: "var(--ls-caps)",
      textTransform: "uppercase",
      color: "var(--text-faint)"
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      gap: "2px"
    }
  }, [0, 1, 2, 3].map(i => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      width: `${w}px`,
      height: `${h}px`,
      borderRadius: "1px",
      background: i < filled ? color : "var(--ink-500)"
    }
  }))), (showValue || showWord) && /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-mono)",
      fontSize: "var(--fs-10)",
      color: value == null ? "var(--conf-unknown)" : color
    }
  }, value == null ? "unknown" : `${showWord ? WORDS[b] + " " : ""}${showValue ? Math.round(value * 100) + "%" : ""}`.trim()));
}
Object.assign(__ds_scope, { ConfidenceMeter });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/ConfidenceMeter.jsx", error: String((e && e.message) || e) }); }

// components/data/StrokeFeedItem.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const STATUS_TONE = {
  suggested: "warn",
  accepted: "in",
  corrected: "info",
  unclassified: "unknown"
};

/** One observed (never predicted) event in the stroke feed. */
function StrokeFeedItem({
  sequence,
  player = "A",
  shot,
  time,
  status = "accepted",
  source = "auto",
  confidence,
  selected,
  onClick,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    onClick: onClick,
    style: {
      display: "grid",
      gridTemplateColumns: "18px 3px 1fr auto",
      alignItems: "center",
      gap: "var(--sp-4)",
      padding: "var(--sp-3) var(--sp-4)",
      borderRadius: "var(--radius-sm)",
      background: selected ? "var(--surface-active)" : "transparent",
      cursor: onClick ? "pointer" : "default",
      transition: "var(--transition-control)",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-mono)",
      fontSize: "var(--fs-10)",
      color: "var(--text-faint)",
      textAlign: "right"
    }
  }, sequence), /*#__PURE__*/React.createElement("span", {
    style: {
      width: "3px",
      height: "18px",
      borderRadius: "2px",
      background: player === "B" ? "var(--player-b)" : "var(--player-a)"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      minWidth: 0,
      display: "flex",
      alignItems: "baseline",
      gap: "var(--sp-4)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-ui)",
      color: status === "unclassified" ? "var(--text-faint)" : "var(--text-primary)",
      overflow: "hidden",
      textOverflow: "ellipsis"
    }
  }, status === "unclassified" ? "unclassified" : shot), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-mono)",
      fontSize: "var(--fs-10)",
      color: "var(--text-faint)"
    }
  }, time)), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--sp-3)"
    }
  }, confidence !== undefined && /*#__PURE__*/React.createElement(__ds_scope.ConfidenceMeter, {
    value: confidence,
    size: "sm",
    showValue: false
  }), /*#__PURE__*/React.createElement(__ds_scope.Badge, {
    tone: STATUS_TONE[status] || "neutral"
  }, source === "manual" ? "manual" : status)));
}
Object.assign(__ds_scope, { StrokeFeedItem });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/StrokeFeedItem.jsx", error: String((e && e.message) || e) }); }

// components/data/SuggestionRow.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Inline `suggested shot · confidence · accept / correct` row — labeling is inline-first. */
function SuggestionRow({
  shot,
  confidence,
  time,
  onAccept,
  onCorrect,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--sp-4)",
      padding: "var(--sp-4)",
      borderRadius: "var(--radius-sm)",
      background: "var(--lime-tint)",
      border: "1px dashed rgba(200,240,74,.5)",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      minWidth: 0,
      flex: 1,
      display: "flex",
      flexDirection: "column",
      gap: "var(--sp-2)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      alignItems: "baseline",
      gap: "var(--sp-3)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-label)",
      letterSpacing: "var(--ls-caps)",
      textTransform: "uppercase",
      color: "var(--lime-600)"
    }
  }, "looks like"), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-ui)",
      color: "var(--text-primary)"
    }
  }, shot), time && /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-mono)",
      fontSize: "var(--fs-10)",
      color: "var(--text-faint)"
    }
  }, time)), /*#__PURE__*/React.createElement(__ds_scope.ConfidenceMeter, {
    value: confidence,
    size: "sm",
    showWord: true
  })), /*#__PURE__*/React.createElement(__ds_scope.Button, {
    size: "sm",
    variant: "primary",
    onClick: onAccept,
    iconRight: /*#__PURE__*/React.createElement(__ds_scope.KeyHint, null, "\u21B5")
  }, "Looks right"), /*#__PURE__*/React.createElement(__ds_scope.Button, {
    size: "sm",
    variant: "ghost",
    onClick: onCorrect,
    iconRight: /*#__PURE__*/React.createElement(__ds_scope.KeyHint, null, "O")
  }, "Change it"));
}
Object.assign(__ds_scope, { SuggestionRow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/SuggestionRow.jsx", error: String((e && e.message) || e) }); }

// components/feedback/EmptyState.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Honest empty/blocked state: what is missing, why, and the one action that fixes it. */
function EmptyState({
  icon,
  title,
  body,
  action,
  compact,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      textAlign: "center",
      gap: "var(--sp-4)",
      padding: compact ? "var(--sp-6) var(--sp-5)" : "var(--sp-9) var(--sp-6)",
      ...style
    }
  }, rest), icon && /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--slate-400)"
    }
  }, icon), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-h3)",
      color: "var(--text-primary)"
    }
  }, title), body && /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-body-sm)",
      color: "var(--text-faint)",
      maxWidth: "34ch",
      textWrap: "pretty"
    }
  }, body), action && /*#__PURE__*/React.createElement("span", {
    style: {
      marginTop: "var(--sp-2)"
    }
  }, action));
}
Object.assign(__ds_scope, { EmptyState });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/EmptyState.jsx", error: String((e && e.message) || e) }); }

// components/feedback/InfoTip.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Explain-on-demand. A quiet (?) next to any term the product invented; hover or focus
 *  reveals one plain-English sentence. Never used to hide something the user must read. */
function InfoTip({
  term,
  children,
  side = "top",
  size = 13,
  style,
  ...rest
}) {
  const [open, setOpen] = React.useState(false);
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      position: "relative",
      display: "inline-flex",
      alignItems: "center",
      ...style
    },
    onMouseEnter: () => setOpen(true),
    onMouseLeave: () => setOpen(false)
  }, rest), /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": term ? `What is ${term}?` : "More information",
    onFocus: () => setOpen(true),
    onBlur: () => setOpen(false),
    onClick: () => setOpen(!open),
    style: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: size + 3,
      height: size + 3,
      padding: 0,
      borderRadius: "var(--radius-pill)",
      background: "transparent",
      border: "1px solid var(--border-subtle)",
      color: open ? "var(--lime-500)" : "var(--text-faint)",
      cursor: "help",
      transition: "var(--transition-control)",
      borderColor: open ? "rgba(200,240,74,.45)" : "var(--border-subtle)"
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "help-circle",
    size: size - 3
  })), open && /*#__PURE__*/React.createElement("span", {
    role: "tooltip",
    style: {
      position: "absolute",
      zIndex: 40,
      width: 244,
      left: "50%",
      transform: "translateX(-50%)",
      [side === "bottom" ? "top" : "bottom"]: "calc(100% + 8px)",
      padding: "9px 11px",
      borderRadius: "var(--radius-md)",
      background: "var(--ink-800)",
      border: "1px solid var(--border-subtle)",
      boxShadow: "var(--shadow-raised)",
      textAlign: "left",
      textWrap: "pretty"
    }
  }, term && /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      font: "var(--type-label)",
      letterSpacing: "var(--ls-caps)",
      textTransform: "uppercase",
      color: "var(--lime-500)",
      marginBottom: 4
    }
  }, term), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      font: "var(--type-ui-sm)",
      fontSize: "var(--fs-12)",
      lineHeight: "var(--lh-normal)",
      color: "var(--text-body)"
    }
  }, children)));
}
Object.assign(__ds_scope, { InfoTip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/InfoTip.jsx", error: String((e && e.message) || e) }); }

// components/feedback/StatusChip.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const STATES = {
  ready: ["var(--signal-in)", "Ready"],
  live: ["var(--lime-500)", "Live"],
  waiting: ["var(--signal-warn)", "Waiting"],
  stale: ["var(--signal-warn)", "Stale"],
  error: ["var(--signal-out)", "Error"],
  off: ["var(--signal-unknown)", "Off"]
};

/** The always-present quiet status chip — Minimal density's entire visible footprint. */
function StatusChip({
  state = "off",
  label,
  detail,
  pulse,
  onClick,
  style,
  ...rest
}) {
  const [color, fallback] = STATES[state] || STATES.off;
  return /*#__PURE__*/React.createElement("div", _extends({
    onClick: onClick,
    role: onClick ? "button" : undefined,
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: "var(--sp-4)",
      height: "26px",
      padding: "0 var(--sp-5)",
      borderRadius: "var(--radius-pill)",
      background: "var(--surface-panel)",
      backdropFilter: "var(--blur-chip)",
      WebkitBackdropFilter: "var(--blur-chip)",
      border: "1px solid var(--border-hairline)",
      boxShadow: "var(--shadow-chip)",
      cursor: onClick ? "pointer" : "default",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      position: "relative",
      display: "inline-flex",
      width: "7px",
      height: "7px"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      inset: 0,
      borderRadius: "999px",
      background: color
    }
  }), (pulse || state === "live") && /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      inset: "-3px",
      borderRadius: "999px",
      border: `1px solid ${color}`,
      opacity: 0.45
    }
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-ui-sm)",
      color: "var(--text-primary)"
    }
  }, label || fallback), detail && /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-mono)",
      fontSize: "var(--fs-11)",
      color: "var(--text-faint)"
    }
  }, detail));
}
Object.assign(__ds_scope, { StatusChip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/StatusChip.jsx", error: String((e && e.message) || e) }); }

// components/feedback/StepDots.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Progress rail for the four numbered court-seed clicks. */
function StepDots({
  total = 4,
  current = 0,
  labels,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--sp-3)",
      ...style
    }
  }, rest), Array.from({
    length: total
  }, (_, i) => {
    const done = i < current;
    const active = i === current;
    return /*#__PURE__*/React.createElement("span", {
      key: i,
      title: labels && labels[i],
      style: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "20px",
        height: "20px",
        borderRadius: "var(--radius-pill)",
        font: "var(--type-mono)",
        fontSize: "var(--fs-10)",
        background: done ? "var(--lime-500)" : active ? "var(--lime-tint)" : "var(--ink-600)",
        color: done ? "var(--text-on-accent)" : active ? "var(--lime-500)" : "var(--text-faint)",
        border: `1px solid ${done ? "var(--lime-500)" : active ? "rgba(200,240,74,.5)" : "var(--border-hairline)"}`
      }
    }, i + 1);
  }));
}
Object.assign(__ds_scope, { StepDots });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/StepDots.jsx", error: String((e && e.message) || e) }); }

// ui_kits/extension/App.jsx
try { (() => {
const NS = window.BadmintonVisionDesignSystem_0ab536;
const {
  Button,
  Icon,
  EmptyState
} = NS;

/** Click-through of the whole extension: badge → popup → seed → live overlay → labeling → summary. */
function App() {
  const [view, setView] = React.useState("video");
  const [popup, setPopup] = React.useState(true);
  const [seeding, setSeeding] = React.useState(false);
  const [labeling, setLabeling] = React.useState(false);
  const [density, setDensity] = React.useState("minimal");
  const [panels, setPanels] = React.useState({
    feed: true,
    stats: true,
    map: true
  });
  const [state, setState] = React.useState({
    enabled: false,
    seeded: false,
    stale: false,
    rally: 14,
    time: "12:04.320"
  });
  const [strokes, setStrokes] = React.useState(window.BVDATA.strokes);
  const [suggestion, setSuggestion] = React.useState(window.BVDATA.suggestion);
  const accept = shot => {
    const s = shot || suggestion.shot;
    setStrokes(prev => [...prev.slice(-5), {
      sequence: prev[prev.length - 1].sequence + 1,
      player: "A",
      shot: s,
      time: suggestion.time,
      status: shot ? "corrected" : "accepted",
      source: shot ? "manual" : "auto",
      confidence: shot ? null : suggestion.confidence
    }]);
    setSuggestion(null);
    setLabeling(false);
    setTimeout(() => setSuggestion({
      shot: "Net Kill",
      confidence: 0.44,
      time: "12:06.940"
    }), 900);
  };
  React.useEffect(() => {
    if (window.lucide) window.lucide.createIcons && null;
  }, []);
  if (view === "summary") return /*#__PURE__*/React.createElement(Summary, {
    onBack: () => setView("video")
  });
  const popupEl = popup && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "fixed",
      right: 18,
      top: 58,
      zIndex: 60
    }
  }, /*#__PURE__*/React.createElement(Popup, {
    state: state,
    density: density,
    setDensity: setDensity,
    panels: panels,
    setPanels: setPanels,
    onClose: () => setPopup(false),
    onEnable: () => {
      setPopup(false);
      state.seeded ? setState({
        ...state,
        enabled: true
      }) : setSeeding(true);
    },
    onSeed: () => {
      setPopup(false);
      setSeeding(true);
    },
    onManual: () => {
      setPopup(false);
      setState({
        ...state,
        enabled: true
      });
      setLabeling(true);
    },
    onSummary: () => {
      setPopup(false);
      setView("summary");
    }
  }));
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(VideoStage, {
    badgeActive: state.enabled,
    onToggleBadge: () => setPopup(!popup)
  }, state.enabled && !seeding && /*#__PURE__*/React.createElement(LiveOverlay, {
    density: density,
    panels: panels,
    setPanels: setPanels,
    strokes: strokes,
    suggestion: suggestion,
    state: state,
    onAccept: () => accept(),
    onCorrect: () => setLabeling(true),
    onOpenPanel: () => setLabeling(true)
  }), seeding && /*#__PURE__*/React.createElement(SeedFlow, {
    onDone: () => {
      setSeeding(false);
      setState({
        ...state,
        seeded: true,
        enabled: true
      });
      setDensity("balanced");
    },
    onSkip: () => {
      setSeeding(false);
      setState({
        ...state,
        enabled: true
      });
      setLabeling(true);
    },
    onCancel: () => setSeeding(false)
  }), labeling && /*#__PURE__*/React.createElement(LabelingPanel, {
    suggestion: suggestion || {
      shot: "Smash",
      confidence: 0.61
    },
    onClose: () => setLabeling(false),
    onSave: s => accept(s)
  }), !state.enabled && !seeding && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      left: "50%",
      top: "50%",
      transform: "translate(-50%,-50%)",
      pointerEvents: "auto",
      borderRadius: "var(--radius-lg)",
      background: "var(--surface-panel)",
      backdropFilter: "var(--blur-panel)",
      border: "1px solid var(--border-hairline)",
      boxShadow: "var(--shadow-panel)"
    }
  }, /*#__PURE__*/React.createElement(EmptyState, {
    compact: true,
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "mouse-pointer-click",
      size: 20
    }),
    title: "Overlay off",
    body: popup ? "Use the popup at the top right: Enable overlay starts the one-time court seed." : "Open the toolbar badge to enable analysis for this match.",
    action: /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      size: "sm",
      onClick: () => {
        if (popup) {
          setPopup(false);
          setSeeding(true);
        } else setPopup(true);
      }
    }, popup ? "Seed court now" : "Open Badminton Vision")
  })), state.enabled && !seeding && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      right: "var(--overlay-gutter)",
      bottom: 56,
      display: "flex",
      gap: 8,
      pointerEvents: "auto",
      zIndex: 2
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "secondary",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "sliders-horizontal",
      size: 13
    }),
    style: window.OVER_VIDEO_BUTTON,
    onClick: () => setDensity(density === "minimal" ? "balanced" : density === "balanced" ? "full" : "minimal")
  }, "Density: ", density), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "secondary",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "clock",
      size: 13
    }),
    style: window.OVER_VIDEO_BUTTON,
    onClick: () => setState({
      ...state,
      stale: !state.stale
    })
  }, state.stale ? "Caught up" : "Simulate lag"), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "secondary",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "table",
      size: 13
    }),
    style: window.OVER_VIDEO_BUTTON,
    onClick: () => setView("summary")
  }, "Summary"))), popupEl);
}
Object.assign(window, {
  App
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/extension/App.jsx", error: String((e && e.message) || e) }); }

// ui_kits/extension/LabelingPanel.jsx
try { (() => {
const NS = window.BadmintonVisionDesignSystem_0ab536;
const {
  Panel,
  Button,
  IconButton,
  Icon,
  Badge,
  KeyHint,
  ShotPicker,
  DimensionAxis,
  ConfidenceMeter,
  Callout,
  InfoTip
} = NS;

/** Hybrid manual labeling panel (§4.4). Keyboard-first, playback never pauses. */
function LabelingPanel({
  suggestion,
  onClose,
  onSave
}) {
  const [shot, setShot] = React.useState(null);
  const [axes, setAxes] = React.useState(() => Object.fromEntries(window.BVDATA.axes.map(a => [a.label, a.value])));
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      right: "var(--overlay-gutter)",
      top: "var(--overlay-gutter)",
      bottom: "var(--overlay-gutter)",
      width: "min(380px, calc(100% - 32px))",
      pointerEvents: "auto"
    }
  }, /*#__PURE__*/React.createElement(Panel, {
    draggable: true,
    title: "Label this shot",
    mediaTime: "12:04.120",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "pencil-line",
      size: 13,
      color: "var(--text-faint)"
    }),
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        marginRight: 4
      }
    }, /*#__PURE__*/React.createElement(KeyHint, null, "Esc")), /*#__PURE__*/React.createElement(IconButton, {
      size: "sm",
      label: "Close",
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: "x",
        size: 13
      }),
      onClick: onClose
    })),
    style: {
      height: "100%",
      display: "flex",
      flexDirection: "column"
    },
    bodyStyle: {
      overflow: "auto",
      flex: 1
    },
    footer: /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 8
      }
    }, /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "ghost",
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: "download",
        size: 13
      })
    }, "Export CSV"), /*#__PURE__*/React.createElement("span", {
      style: {
        marginLeft: "auto",
        display: "flex",
        gap: 8
      }
    }, /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "ghost",
      onClick: onClose
    }, "Cancel"), /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "primary",
      onClick: () => onSave(shot || suggestion.shot),
      disabled: !shot && !suggestion
    }, "Save shot")))
  }, /*#__PURE__*/React.createElement(Callout, {
    tone: "guide",
    title: "Tell it what you just saw"
  }, "Mark where the shot starts and ends, pick the stroke, then save. The video keeps playing throughout."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      marginTop: 12,
      padding: "8px 10px",
      borderRadius: "var(--radius-sm)",
      background: "var(--ink-700)",
      border: "1px solid var(--border-hairline)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-mono)",
      fontSize: "var(--fs-11)",
      color: "var(--text-muted)"
    }
  }, "12:03.980 \u2192 12:04.420"), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: "auto",
      display: "flex",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "ghost",
    iconRight: /*#__PURE__*/React.createElement(KeyHint, null, "S")
  }, "Start"), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "ghost",
    iconRight: /*#__PURE__*/React.createElement(KeyHint, null, "E")
  }, "End"))), suggestion && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    tone: "warn"
  }, "its guess"), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-ui)",
      color: shot ? "var(--text-faint)" : "var(--text-primary)",
      textDecoration: shot ? "line-through" : "none"
    }
  }, suggestion.shot), /*#__PURE__*/React.createElement(ConfidenceMeter, {
    value: suggestion.confidence,
    size: "sm"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: "auto",
      font: "var(--type-ui-sm)",
      fontSize: "var(--fs-11)",
      color: "var(--text-faint)",
      display: "inline-flex",
      gap: 5,
      alignItems: "center"
    }
  }, "accept ", /*#__PURE__*/React.createElement(KeyHint, {
    tone: "accent"
  }, "\u21B5"))), /*#__PURE__*/React.createElement("div", {
    style: {
      font: "var(--type-label)",
      letterSpacing: "var(--ls-caps)",
      textTransform: "uppercase",
      color: "var(--text-faint)",
      margin: "16px 0 8px"
    }
  }, "Which stroke was it?"), /*#__PURE__*/React.createElement(ShotPicker, {
    value: shot,
    suggested: suggestion && suggestion.shot,
    onChange: setShot,
    columns: 3
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      font: "var(--type-label)",
      letterSpacing: "var(--ls-caps)",
      textTransform: "uppercase",
      color: "var(--text-faint)",
      margin: "16px 0 10px"
    }
  }, "How was it played? ", /*#__PURE__*/React.createElement("span", {
    style: {
      textTransform: "none",
      letterSpacing: 0
    }
  }, /*#__PURE__*/React.createElement(InfoTip, {
    term: "How was it played?"
  }, "Optional detail \u2014 side of the body, height, intent. Skip any row you are unsure about; blank is better than a guess."))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 8
    }
  }, window.BVDATA.axes.map(a => /*#__PURE__*/React.createElement(DimensionAxis, {
    key: a.label,
    label: a.label,
    options: a.options,
    value: axes[a.label],
    onChange: v => setAxes({
      ...axes,
      [a.label]: v
    })
  }))), /*#__PURE__*/React.createElement("p", {
    style: {
      font: "var(--type-ui-sm)",
      fontSize: "var(--fs-11)",
      color: "var(--text-faint)",
      margin: "14px 0 0"
    }
  }, "Your label replaces the guess for this shot \u2014 it never adds a duplicate, and the summary counts it as confirmed.")));
}
Object.assign(window, {
  LabelingPanel
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/extension/LabelingPanel.jsx", error: String((e && e.message) || e) }); }

// ui_kits/extension/LiveOverlay.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const NS = window.BadmintonVisionDesignSystem_0ab536;
const {
  Panel,
  IconButton,
  Icon,
  Badge,
  StatusChip,
  StrokeFeedItem,
  SuggestionRow,
  StatTile,
  MixBar,
  CourtDiagram,
  ConfidenceMeter,
  Button
} = NS;

/* src/styles.css `.bv-overlay-root .bv-panel` — over video the panels go OPAQUE rather than
   translucent, so text stays legible against bright court footage. */
const OVER_VIDEO = {
  background: "var(--ink-900)",
  borderColor: "var(--border-subtle)",
  boxShadow: "0 8px 24px rgba(0,0,0,.68)"
};
const OVER_VIDEO_CHIP = {
  background: "var(--ink-900)",
  borderColor: "var(--border-subtle)",
  backdropFilter: "none",
  boxShadow: "0 4px 16px rgba(0,0,0,.6)"
};
/* exported for App.jsx's overlay action row */
const OVER_VIDEO_BUTTON = {
  color: "var(--text-primary)",
  borderColor: "var(--border-subtle)",
  background: "var(--ink-900)",
  boxShadow: "0 4px 14px rgba(0,0,0,.55)"
};

/** Live overlay (§4.3): independent, collapsible sibling panels anchored to the video rect. */
function LiveOverlay({
  density,
  panels,
  setPanels,
  strokes,
  suggestion,
  state,
  onAccept,
  onCorrect,
  onOpenPanel
}) {
  const minimal = density === "minimal";
  const showStats = !minimal && panels.stats;
  const showMap = !minimal && panels.map;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      pointerEvents: "none"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      left: "var(--overlay-gutter)",
      top: "var(--overlay-gutter)",
      bottom: "var(--overlay-gutter)",
      width: "var(--overlay-panel-width)",
      display: "flex",
      flexDirection: "column",
      gap: 10,
      minHeight: 0,
      overflow: "hidden",
      pointerEvents: "auto"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      flex: "0 0 auto",
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement(StatusChip, {
    state: state.stale ? "stale" : "live",
    label: state.stale ? "Analysis behind" : `Rally ${state.rally}`,
    detail: state.stale ? "+1.2s" : state.time,
    onClick: onOpenPanel,
    style: OVER_VIDEO_CHIP
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      maxWidth: 280,
      padding: "4px 7px",
      border: "1px solid var(--border-subtle)",
      borderRadius: "var(--radius-xs)",
      background: "var(--ink-900)",
      color: "var(--text-body)",
      font: "var(--type-mono)",
      fontSize: "var(--fs-10)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "cpu",
    size: 11
  }), "local only")), showStats && /*#__PURE__*/React.createElement(Panel, {
    draggable: true,
    title: "Stats",
    mediaTime: state.time,
    stale: state.stale,
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "activity",
      size: 13,
      color: "var(--text-faint)"
    }),
    style: {
      width: "var(--overlay-panel-width)",
      ...OVER_VIDEO,
      minHeight: 96,
      flex: "0 1 auto",
      display: "flex",
      flexDirection: "column"
    },
    bodyStyle: {
      minHeight: 0,
      overflow: "auto"
    },
    actions: /*#__PURE__*/React.createElement(IconButton, {
      size: "sm",
      label: "Close stats",
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: "x",
        size: 13
      }),
      onClick: () => setPanels({
        ...panels,
        stats: false
      })
    })
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr 1fr",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(StatTile, {
    label: "Rally",
    value: state.rally
  }), /*#__PURE__*/React.createElement(StatTile, {
    label: "Shots",
    value: strokes.length
  }), /*#__PURE__*/React.createElement(StatTile, {
    label: "Length",
    value: "28.4",
    unit: "s"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      margin: "12px 0"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-mono)",
      fontSize: "var(--fs-12)",
      color: "var(--text-muted)"
    }
  }, "21\u201318 \xB7 14\u201311"), /*#__PURE__*/React.createElement(Badge, {
    tone: "warn"
  }, "score OCR partial")), /*#__PURE__*/React.createElement(MixBar, {
    segments: [{
      label: "Clear",
      value: 5,
      color: "var(--player-a)"
    }, {
      label: "Drop",
      value: 4,
      color: "#2f8f77"
    }, {
      label: "Smash",
      value: 3,
      color: "var(--lime-500)"
    }, {
      label: "Net",
      value: 3,
      color: "var(--player-b)"
    }, {
      label: "Unclassified",
      value: 2
    }]
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      marginTop: 12,
      paddingTop: 10,
      borderTop: "1px solid var(--border-hairline)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-ui-sm)",
      color: "var(--text-faint)"
    }
  }, "Last rally end"), /*#__PURE__*/React.createElement(Badge, {
    tone: "unknown"
  }, "unclassified"), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: "auto"
    }
  }, /*#__PURE__*/React.createElement(ConfidenceMeter, {
    value: null,
    size: "sm"
  })))), showMap && /*#__PURE__*/React.createElement(Panel, {
    draggable: true,
    title: "Court",
    mediaTime: state.time,
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "crosshair",
      size: 13,
      color: "var(--text-faint)"
    }),
    style: {
      width: 150,
      ...OVER_VIDEO,
      flex: "0 0 auto",
      marginTop: "auto"
    },
    bodyStyle: {
      padding: 10
    },
    actions: /*#__PURE__*/React.createElement(IconButton, {
      size: "sm",
      label: "Close minimap",
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: "x",
        size: 13
      }),
      onClick: () => setPanels({
        ...panels,
        map: false
      })
    })
  }, /*#__PURE__*/React.createElement(CourtDiagram, {
    width: 128,
    players: [{
      x: 3.1,
      y: 9.7
    }, {
      x: 2.5,
      y: 4.1,
      side: "b"
    }],
    trajectory: [{
      x: 2.5,
      y: 4.3
    }, {
      x: 3.5,
      y: 8.4
    }, {
      x: 4.8,
      y: 12.9
    }],
    landing: {
      x: 4.8,
      y: 12.9
    },
    call: "IN"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      marginTop: 8
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    tone: "in"
  }, "IN"), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-mono)",
      fontSize: "var(--fs-10)",
      color: "var(--text-faint)"
    }
  }, "0.11 m inside")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 6
    }
  }, /*#__PURE__*/React.createElement(ConfidenceMeter, {
    value: 0.52,
    label: "geo",
    size: "sm"
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      right: "var(--overlay-gutter)",
      top: "var(--overlay-gutter)",
      bottom: 88,
      width: "var(--overlay-panel-width)",
      display: "flex",
      flexDirection: "column",
      minHeight: 0,
      pointerEvents: "auto"
    }
  }, panels.feed && /*#__PURE__*/React.createElement(Panel, {
    draggable: true,
    title: "Stroke feed",
    mediaTime: state.time,
    stale: state.stale,
    style: {
      ...OVER_VIDEO,
      minHeight: 0,
      display: "flex",
      flexDirection: "column"
    },
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "list",
      size: 13,
      color: "var(--text-faint)"
    }),
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(IconButton, {
      size: "sm",
      label: "Open labeling panel (O)",
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: "pencil-line",
        size: 13
      }),
      onClick: onOpenPanel
    }), /*#__PURE__*/React.createElement(IconButton, {
      size: "sm",
      label: "Close feed",
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: "x",
        size: 13
      }),
      onClick: () => setPanels({
        ...panels,
        feed: false
      })
    })),
    bodyStyle: {
      padding: "6px",
      minHeight: 0,
      overflow: "auto"
    },
    footer: /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 8
      }
    }, /*#__PURE__*/React.createElement(Badge, {
      tone: "accent"
    }, "rally 13 \xB7 index 74"), /*#__PURE__*/React.createElement("span", {
      style: {
        marginLeft: "auto"
      }
    }, /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "ghost",
      onClick: onOpenPanel,
      iconRight: /*#__PURE__*/React.createElement(Icon, {
        name: "chevron-right",
        size: 12
      })
    }, "Older rallies")))
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 1,
      maxHeight: 212,
      overflow: "hidden"
    }
  }, strokes.map(s => /*#__PURE__*/React.createElement(StrokeFeedItem, _extends({
    key: s.sequence
  }, s)))), suggestion && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 6
    }
  }, /*#__PURE__*/React.createElement(SuggestionRow, {
    shot: suggestion.shot,
    confidence: suggestion.confidence,
    time: suggestion.time,
    onAccept: onAccept,
    onCorrect: onCorrect
  })))));
}
Object.assign(window, {
  LiveOverlay,
  OVER_VIDEO_CHIP,
  OVER_VIDEO_BUTTON
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/extension/LiveOverlay.jsx", error: String((e && e.message) || e) }); }

// ui_kits/extension/Popup.jsx
try { (() => {
const NS = window.BadmintonVisionDesignSystem_0ab536;
const {
  Button,
  IconButton,
  Badge,
  Icon,
  Toggle,
  SegmentedControl,
  StatusChip,
  Callout,
  InfoTip
} = NS;
const HEALTH = {
  ok: "var(--signal-in)",
  degraded: "var(--signal-warn)",
  off: "var(--signal-unknown)",
  unavailable: "var(--ink-400)"
};
const MiniSwitch = ({
  on,
  disabled,
  onClick
}) => /*#__PURE__*/React.createElement("button", {
  type: "button",
  role: "switch",
  "aria-checked": !!on,
  disabled: disabled,
  onClick: onClick,
  style: {
    position: "relative",
    width: 28,
    height: 16,
    flex: "0 0 auto",
    borderRadius: "var(--radius-pill)",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.42 : 1,
    transition: "var(--transition-control)",
    background: on ? "var(--lime-500)" : "var(--ink-600)",
    border: `1px solid ${on ? "var(--lime-600)" : "var(--border-subtle)"}`
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    position: "absolute",
    top: 1,
    left: on ? 13 : 1,
    width: 12,
    height: 12,
    borderRadius: "var(--radius-pill)",
    background: on ? "var(--text-on-accent)" : "var(--slate-200)",
    transition: "left var(--dur-fast) var(--ease-standard)"
  }
}));
const TrackerRow = ({
  t,
  onToggle
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "6px 0"
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    width: 6,
    height: 6,
    borderRadius: 999,
    flex: "0 0 auto",
    background: t.on ? HEALTH[t.health] : HEALTH.off
  }
}), /*#__PURE__*/React.createElement("span", {
  style: {
    font: "var(--type-ui-sm)",
    color: t.health === "unavailable" ? "var(--text-faint)" : "var(--text-primary)"
  }
}, t.label), /*#__PURE__*/React.createElement("span", {
  style: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 8
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    font: "var(--type-mono)",
    fontSize: "var(--fs-10)",
    color: t.on && t.health === "degraded" ? "var(--signal-warn)" : "var(--text-faint)"
  }
}, t.on ? t.note : "off"), /*#__PURE__*/React.createElement(MiniSwitch, {
  on: t.on,
  disabled: t.health === "unavailable",
  onClick: () => onToggle(t.id)
})));
const Section = ({
  title,
  aside,
  children
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    padding: "12px 16px",
    borderTop: "1px solid var(--border-hairline)"
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    font: "var(--type-label)",
    letterSpacing: "var(--ls-caps)",
    textTransform: "uppercase",
    color: "var(--text-faint)",
    marginBottom: 10
  }
}, title, /*#__PURE__*/React.createElement("span", {
  style: {
    marginLeft: "auto",
    textTransform: "none",
    letterSpacing: 0
  }
}, aside)), children);

/** Toolbar popup — the control center (§4.1). Fixed 360px. */
function Popup({
  state,
  onEnable,
  onSeed,
  onManual,
  onSummary,
  density,
  setDensity,
  panels,
  setPanels,
  onClose
}) {
  const seeded = state.seeded;
  const [open, setOpen] = React.useState(false);
  const [trackers, setTrackers] = React.useState([{
    id: "court",
    label: "Court",
    health: seeded ? "ok" : "degraded",
    note: seeded ? "seeded" : "not seeded",
    on: true
  }, {
    id: "players",
    label: "Players",
    health: "ok",
    note: "2 tracked",
    on: true
  }, {
    id: "body",
    label: "Body pose",
    health: "ok",
    note: "17 keypoints",
    on: true
  }, {
    id: "shuttle",
    label: "Shuttle",
    health: "degraded",
    note: "low light",
    on: true
  }, {
    id: "score",
    label: "Score OCR",
    health: "degraded",
    note: "partial",
    on: true
  }, {
    id: "racket",
    label: "Racket",
    health: "unavailable",
    note: "not in MVP",
    on: false
  }]);
  const toggleTracker = id => setTrackers(prev => prev.map(t => t.id === id ? {
    ...t,
    on: !t.on
  } : t));
  const active = trackers.filter(t => t.on).length;
  const degraded = trackers.some(t => t.on && t.health === "degraded");
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: "var(--popup-width)",
      borderRadius: "var(--radius-lg)",
      overflow: "hidden",
      background: "var(--surface-panel-solid)",
      border: "1px solid var(--border-subtle)",
      boxShadow: "var(--shadow-modal)"
    }
  }, /*#__PURE__*/React.createElement("header", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "12px 14px 12px 16px"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-display)",
      fontWeight: 700,
      fontSize: 15,
      letterSpacing: "-0.02em",
      color: "var(--lime-500)"
    }
  }, "Badminton Vision"), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: "auto"
    }
  }, /*#__PURE__*/React.createElement(IconButton, {
    size: "sm",
    label: "Settings",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "settings",
      size: 14
    })
  })), /*#__PURE__*/React.createElement(IconButton, {
    size: "sm",
    label: "Close",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "x",
      size: 14
    }),
    onClick: onClose
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "0 16px 14px",
      display: "flex",
      flexDirection: "column",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(StatusChip, {
    state: state.enabled ? state.stale ? "stale" : "live" : "ready",
    label: state.enabled ? state.stale ? "Analysis behind" : `Rally ${state.rally}` : "Badminton match found on this page",
    detail: state.enabled ? state.time : undefined,
    style: {
      width: "100%",
      justifyContent: "flex-start"
    }
  }), !state.enabled && /*#__PURE__*/React.createElement(Callout, {
    tone: "guide",
    title: "Three steps to get going"
  }, "Turn the overlay on, click the four court corners once, then keep watching \u2014 the video is never paused or moved.")), /*#__PURE__*/React.createElement(Section, {
    title: "Panels on the video",
    aside: "the video's own Panels button offers these as quick shortcuts"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(Toggle, {
    id: "p-feed",
    label: "Shots this rally",
    description: "Every stroke as it happens",
    checked: panels.feed,
    onChange: v => setPanels({
      ...panels,
      feed: v
    })
  }), /*#__PURE__*/React.createElement(Toggle, {
    id: "p-stats",
    label: "Rally stats",
    checked: panels.stats,
    onChange: v => setPanels({
      ...panels,
      stats: v
    })
  }), /*#__PURE__*/React.createElement(Toggle, {
    id: "p-map",
    label: "Court map",
    description: "Where players and the shuttle are",
    checked: panels.map,
    onChange: v => setPanels({
      ...panels,
      map: v
    })
  }), /*#__PURE__*/React.createElement(Toggle, {
    id: "p-pro",
    label: "Compare with the pros",
    description: "Coming later \u2014 needs a licensed benchmark",
    disabled: true
  }))), /*#__PURE__*/React.createElement(Section, {
    title: /*#__PURE__*/React.createElement("span", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 8
      }
    }, "What's being tracked", /*#__PURE__*/React.createElement("span", {
      style: {
        display: "inline-flex",
        gap: 2
      }
    }, trackers.map(t => /*#__PURE__*/React.createElement("span", {
      key: t.id,
      style: {
        width: 10,
        height: 3,
        borderRadius: 1,
        background: t.on ? HEALTH[t.health] : "var(--ink-500)"
      }
    })))),
    aside: /*#__PURE__*/React.createElement("button", {
      type: "button",
      onClick: () => setOpen(!open),
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        background: "none",
        border: "none",
        cursor: "pointer",
        color: "var(--text-muted)",
        font: "var(--type-ui-sm)",
        fontSize: "var(--fs-11)",
        padding: 0
      }
    }, active, " of ", trackers.length, " on", /*#__PURE__*/React.createElement(Icon, {
      name: open ? "chevron-up" : "chevron-down",
      size: 12
    }))
  }, !open ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    tone: degraded ? "warn" : "in"
  }, degraded ? "some parts unsure" : "all working"), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-ui-sm)",
      fontSize: "var(--fs-11)",
      color: "var(--text-faint)"
    }
  }, "runs on your machine \xB7 nothing uploaded")) : /*#__PURE__*/React.createElement(React.Fragment, null, trackers.map(t => /*#__PURE__*/React.createElement(TrackerRow, {
    key: t.id,
    t: t,
    onToggle: toggleTracker
  })), /*#__PURE__*/React.createElement("p", {
    style: {
      font: "var(--type-ui-sm)",
      fontSize: "var(--fs-11)",
      color: "var(--text-faint)",
      margin: "8px 0 0"
    }
  }, "Turn something off and it stops being analysed \u2014 anything that depended on it is left blank rather than guessed."))), /*#__PURE__*/React.createElement(Section, {
    title: /*#__PURE__*/React.createElement("span", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 7
      }
    }, "How much to show", /*#__PURE__*/React.createElement(InfoTip, {
      term: "How much to show"
    }, "Changes only what appears on the video. Everything is still analysed either way."))
  }, /*#__PURE__*/React.createElement(SegmentedControl, {
    full: true,
    value: density,
    onChange: setDensity,
    options: [{
      value: "minimal",
      label: "Just a chip"
    }, {
      value: "balanced",
      label: "Shots + stats"
    }, {
      value: "full",
      label: "Everything"
    }]
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 8,
      padding: "14px 16px",
      borderTop: "1px solid var(--border-hairline)",
      background: "rgba(0,0,0,.2)"
    }
  }, !state.enabled ? /*#__PURE__*/React.createElement(Button, {
    full: true,
    variant: "primary",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "play"
    }),
    onClick: onEnable
  }, "Turn on \u2014 step 1 of 3") : /*#__PURE__*/React.createElement(Button, {
    full: true,
    variant: "primary",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "layout-dashboard"
    }),
    onClick: onClose
  }, "Back to the match"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Button, {
    style: {
      flex: 1
    },
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "crosshair"
    }),
    onClick: onSeed
  }, seeded ? "Set up court again" : "Set up court"), /*#__PURE__*/React.createElement(Button, {
    style: {
      flex: 1
    },
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "pencil-line"
    }),
    onClick: onManual
  }, "Label it myself")), /*#__PURE__*/React.createElement(Button, {
    full: true,
    variant: "ghost",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "table"
    }),
    onClick: onSummary
  }, "See match summary \xB7 download data")));
}
Object.assign(window, {
  Popup
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/extension/Popup.jsx", error: String((e && e.message) || e) }); }

// ui_kits/extension/SeedFlow.jsx
try { (() => {
const NS = window.BadmintonVisionDesignSystem_0ab536;
const {
  Button,
  Icon,
  StepDots,
  Badge,
  Callout
} = NS;
const CORNERS = ["Near left", "Near right", "Far right", "Far left"];
/* Approximate image positions of the four outer doubles corners on the stage backdrop, in %. */
const TARGETS = [{
  x: 22,
  y: 82
}, {
  x: 78,
  y: 82
}, {
  x: 63,
  y: 33
}, {
  x: 37,
  y: 33
}];

/** Court seed — the only modal step (§4.2). Playback continues behind it. */
const CARD_MARGIN = 12,
  CARD_NUDGE = 16,
  TOP_RATIO = 0.35;
function SeedFlow({
  onDone,
  onSkip,
  onCancel
}) {
  const [pts, setPts] = React.useState([]);
  /* Card position as a 0–1 fraction of the stage, clamped to a 12px margin — the
     model in src/seed-card.js. Default: horizontally centred, 35% down. */
  const [pos, setPos] = React.useState({
    x: null,
    y: TOP_RATIO
  });
  const stageRef = React.useRef(null),
    cardRef = React.useRef(null),
    dragRef = React.useRef(null);
  const done = pts.length === 4;
  const clamp = next => {
    const st = stageRef.current,
      cd = cardRef.current;
    if (!st || !cd) return next;
    const sw = st.offsetWidth,
      sh = st.offsetHeight,
      cw = cd.offsetWidth,
      ch = cd.offsetHeight;
    const maxLeft = Math.max(CARD_MARGIN, sw - cw - CARD_MARGIN),
      maxTop = Math.max(CARD_MARGIN, sh - ch - CARD_MARGIN);
    return {
      x: Math.max(CARD_MARGIN, Math.min(maxLeft, next.x * sw)) / sw,
      y: Math.max(CARD_MARGIN, Math.min(maxTop, next.y * sh)) / sh
    };
  };
  const onHandleDown = e => {
    const st = stageRef.current,
      cd = cardRef.current;
    if (!st || !cd) return;
    e.preventDefault();
    const sr = st.getBoundingClientRect(),
      cr = cd.getBoundingClientRect();
    dragRef.current = {
      dx: e.clientX - cr.left,
      dy: e.clientY - cr.top,
      sr
    };
    const move = ev => {
      const d = dragRef.current;
      if (!d) return;
      setPos(clamp({
        x: (ev.clientX - d.dx - d.sr.left) / d.sr.width,
        y: (ev.clientY - d.dy - d.sr.top) / d.sr.height
      }));
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const onHandleKey = e => {
    const step = {
      ArrowLeft: [-CARD_NUDGE, 0],
      ArrowRight: [CARD_NUDGE, 0],
      ArrowUp: [0, -CARD_NUDGE],
      ArrowDown: [0, CARD_NUDGE]
    }[e.key];
    if (!step) return;
    e.preventDefault();
    const st = stageRef.current,
      cd = cardRef.current;
    if (!st || !cd) return;
    const left = pos.x === null ? (st.offsetWidth - cd.offsetWidth) / 2 : pos.x * st.offsetWidth;
    setPos(clamp({
      x: (left + step[0]) / st.offsetWidth,
      y: (pos.y * st.offsetHeight + step[1]) / st.offsetHeight
    }));
  };
  /* src/seed-card.js clamps the DEFAULT too — without this the card can hang past the
     bottom edge on a short stage. Runs once the card has a measured height. */
  React.useEffect(() => {
    const st = stageRef.current,
      cd = cardRef.current;
    if (!st || !cd) return;
    const left = (st.offsetWidth - cd.offsetWidth) / 2;
    setPos(clamp({
      x: left / st.offsetWidth,
      y: TOP_RATIO
    }));
  }, []);
  const add = e => {
    if (done) return;
    const r = e.currentTarget.getBoundingClientRect();
    setPts(prev => prev.length === 4 ? prev : [...prev, {
      x: (e.clientX - r.left) / r.width * 100,
      y: (e.clientY - r.top) / r.height * 100
    }]);
  };
  return /*#__PURE__*/React.createElement("div", {
    ref: stageRef,
    style: {
      position: "absolute",
      inset: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    onClick: add,
    style: {
      position: "absolute",
      inset: 0,
      cursor: done ? "default" : "crosshair",
      background: "rgba(6,9,11,.42)"
    }
  }, /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 100 100",
    preserveAspectRatio: "none",
    style: {
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
      pointerEvents: "none"
    }
  }, pts.length > 1 && /*#__PURE__*/React.createElement("polyline", {
    points: pts.map(p => `${p.x},${p.y}`).join(" ") + (done ? ` ${pts[0].x},${pts[0].y}` : ""),
    fill: done ? "rgba(200,240,74,.1)" : "none",
    stroke: "var(--lime-500)",
    strokeWidth: "0.25",
    vectorEffect: "non-scaling-stroke"
  }), done && /*#__PURE__*/React.createElement("g", {
    stroke: "rgba(233,245,240,.7)",
    strokeWidth: "0.15",
    vectorEffect: "non-scaling-stroke",
    fill: "none"
  }, [0.07, 0.35, 0.5, 0.65, 0.93].map((t, i) => {
    const l = {
      x: pts[0].x + (pts[3].x - pts[0].x) * t,
      y: pts[0].y + (pts[3].y - pts[0].y) * t
    };
    const r = {
      x: pts[1].x + (pts[2].x - pts[1].x) * t,
      y: pts[1].y + (pts[2].y - pts[1].y) * t
    };
    return /*#__PURE__*/React.createElement("line", {
      key: i,
      x1: l.x,
      y1: l.y,
      x2: r.x,
      y2: r.y,
      strokeWidth: t === 0.5 ? 0.3 : 0.15,
      vectorEffect: "non-scaling-stroke"
    });
  }), [0.075, 0.5, 0.925].map((t, i) => {
    const a = {
      x: pts[0].x + (pts[1].x - pts[0].x) * t,
      y: pts[0].y + (pts[1].y - pts[0].y) * t
    };
    const b = {
      x: pts[3].x + (pts[2].x - pts[3].x) * t,
      y: pts[3].y + (pts[2].y - pts[3].y) * t
    };
    return /*#__PURE__*/React.createElement("line", {
      key: i,
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y
    });
  }))), !done && /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      left: `${TARGETS[pts.length].x}%`,
      top: `${TARGETS[pts.length].y}%`,
      transform: "translate(-50%,-50%)",
      width: 26,
      height: 26,
      borderRadius: 999,
      border: "1px dashed var(--lime-500)",
      background: "var(--lime-tint)",
      pointerEvents: "none"
    }
  }), pts.map((p, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      position: "absolute",
      left: `${p.x}%`,
      top: `${p.y}%`,
      transform: "translate(-50%,-50%)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: 20,
      height: 20,
      borderRadius: 999,
      background: "var(--lime-500)",
      color: "var(--text-on-accent)",
      font: "var(--type-mono)",
      fontSize: 10,
      boxShadow: "0 2px 8px rgba(0,0,0,.5)"
    }
  }, i + 1))), /*#__PURE__*/React.createElement("div", {
    ref: cardRef,
    style: {
      position: "absolute",
      left: pos.x === null ? "50%" : `${pos.x * 100}%`,
      top: `${pos.y * 100}%`,
      transform: pos.x === null ? "translateX(-50%)" : "none",
      boxSizing: "border-box",
      width: "min(560px, calc(100% - 24px))",
      maxHeight: "calc(100% - 24px)",
      overflow: "auto",
      zIndex: 3,
      borderRadius: "var(--radius-lg)",
      background: "var(--ink-900)",
      border: "2px solid var(--lime-500)",
      boxShadow: "0 8px 28px rgba(0,0,0,.72)",
      padding: "var(--sp-5)",
      cursor: "default"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      flexWrap: "wrap",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    role: "button",
    tabIndex: 0,
    "aria-label": "Move this card",
    onPointerDown: onHandleDown,
    onKeyDown: onHandleKey,
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      minHeight: 30,
      padding: "0 var(--sp-3)",
      border: "1px solid var(--lime-500)",
      borderRadius: "var(--radius-sm)",
      background: "var(--lime-tint)",
      color: "var(--lime-500)",
      font: "var(--type-label)",
      letterSpacing: "var(--ls-caps)",
      cursor: "grab",
      touchAction: "none"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "grip-vertical",
    size: 12
  }), "Move"), /*#__PURE__*/React.createElement(StepDots, {
    total: 4,
    current: pts.length,
    labels: CORNERS
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-ui)",
      color: "var(--text-primary)"
    }
  }, done ? "Court locked" : `Click the ${CORNERS[pts.length].toLowerCase()} outer corner`), done && /*#__PURE__*/React.createElement(Badge, {
    tone: "in"
  }, "homography ok"), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: "auto",
      display: "flex",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "ghost",
    onClick: () => setPts(pts.slice(0, -1)),
    disabled: !pts.length
  }, "Undo"), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "ghost",
    onClick: onSkip
  }, "Skip to manual"), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "primary",
    disabled: !done,
    onClick: onDone
  }, "Lock court"))), /*#__PURE__*/React.createElement("p", {
    style: {
      font: "var(--type-body-sm)",
      fontSize: "var(--fs-12)",
      color: "var(--text-faint)",
      margin: "10px 0 0",
      textWrap: "pretty"
    }
  }, "Your four clicks are the outer doubles corners only. Service lines, centre lines and the net come from the official 13.40 \xD7 6.10 m court and are projected in \u2014 they never adapt to the image."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "flex-start",
      gap: 8,
      marginTop: "var(--sp-4)",
      paddingTop: "var(--sp-4)",
      borderTop: "1px solid var(--border-subtle)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "info",
    size: 13,
    color: "var(--slate-300)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-ui-sm)",
      fontSize: "var(--fs-11)",
      color: "var(--text-body)"
    }
  }, "Playback keeps running. Drag ", /*#__PURE__*/React.createElement("b", {
    style: {
      color: "var(--lime-500)",
      fontWeight: 500
    }
  }, "Move"), " or use the arrow keys if this card covers a corner."), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: "auto"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "ghost",
    onClick: onCancel
  }, "Cancel")))));
}
Object.assign(window, {
  SeedFlow
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/extension/SeedFlow.jsx", error: String((e && e.message) || e) }); }

// ui_kits/extension/Summary.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const NS = window.BadmintonVisionDesignSystem_0ab536;
const {
  Button,
  IconButton,
  Icon,
  Badge,
  StatTile,
  MixBar,
  RallyRow,
  Chip,
  SegmentedControl,
  CourtDiagram,
  Legend,
  Callout,
  InfoTip
} = NS;
const Block = ({
  title,
  meta,
  children
}) => /*#__PURE__*/React.createElement("section", {
  style: {
    borderRadius: "var(--radius-lg)",
    border: "1px solid var(--border-hairline)",
    background: "var(--surface-panel-solid)",
    padding: 16
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    marginBottom: 14
  }
}, /*#__PURE__*/React.createElement("h2", {
  style: {
    font: "var(--type-h3)",
    color: "var(--text-primary)",
    margin: 0
  }
}, title), meta && /*#__PURE__*/React.createElement("span", {
  style: {
    font: "var(--type-mono)",
    fontSize: "var(--fs-10)",
    color: "var(--text-faint)"
  }
}, meta)), children);

/** Match summary & export (§4.5). Opens in a tab; never seeks the player. */
function Summary({
  onBack
}) {
  const d = window.BVDATA;
  const [filter, setFilter] = React.useState("all");
  const [mapMode, setMapMode] = React.useState("call");
  const L = d.landings;
  const n = fn => L.filter(fn).length;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: "100%",
      background: "var(--ink-900)",
      padding: "28px 32px 48px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 1080,
      margin: "0 auto",
      display: "flex",
      flexDirection: "column",
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("header", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(IconButton, {
    variant: "solid",
    label: "Back to video",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "arrow-left",
      size: 15
    }),
    onClick: onBack
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
    style: {
      font: "var(--type-h1)",
      color: "var(--text-primary)",
      margin: 0
    }
  }, "Match summary"), /*#__PURE__*/React.createElement("p", {
    style: {
      font: "var(--type-body-sm)",
      color: "var(--text-faint)",
      margin: "4px 0 0"
    }
  }, d.video.title, " \xB7 local data only, nothing uploaded")), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: "auto",
      display: "flex",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Button, {
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "download"
    })
  }, "Shots CSV"), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "download"
    })
  }, "Rallies CSV"))), /*#__PURE__*/React.createElement(Callout, {
    tone: "guide",
    title: "Everything below came from this one video"
  }, "Nothing was uploaded and nothing is compared against other matches yet. Where the system could not tell, it says so rather than filling the gap."), /*#__PURE__*/React.createElement(Block, {
    title: "At a glance",
    meta: "42 rallies \xB7 249 shots \xB7 analysed on your machine"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(5,1fr)",
      gap: 20
    }
  }, /*#__PURE__*/React.createElement(StatTile, {
    label: "Match duration",
    value: "1:12:40"
  }), /*#__PURE__*/React.createElement(StatTile, {
    label: "Rallies",
    value: "42"
  }), /*#__PURE__*/React.createElement(StatTile, {
    label: "Shots",
    value: "249"
  }), /*#__PURE__*/React.createElement(StatTile, {
    label: "Avg rally",
    value: "8.4",
    unit: "shots",
    note: "42 rallies"
  }), /*#__PURE__*/React.createElement(StatTile, {
    label: "Longest rally",
    value: "31",
    unit: "shots",
    note: "rally 23 \xB7 18:42",
    tone: "accent"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(Block, {
    title: "Shot mix",
    meta: "18 unclassified"
  }, /*#__PURE__*/React.createElement(MixBar, {
    segments: d.shotMix,
    height: 10
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: 8,
      marginTop: 16
    }
  }, ["All", "Player A", "Player B"].map(l => /*#__PURE__*/React.createElement(Chip, {
    key: l,
    selected: filter === l.toLowerCase(),
    onClick: () => setFilter(l.toLowerCase())
  }, l)))), /*#__PURE__*/React.createElement(Block, {
    title: "How points ended",
    meta: "12 could not be told"
  }, /*#__PURE__*/React.createElement(MixBar, {
    segments: d.outcomeMix,
    height: 10
  }), /*#__PURE__*/React.createElement("p", {
    style: {
      font: "var(--type-ui-sm)",
      fontSize: "var(--fs-11)",
      color: "var(--text-faint)",
      margin: "16px 0 0"
    }
  }, "Attribution needs a known final landing and player identity. Where either is missing the rally stays unclassified rather than being guessed."))), /*#__PURE__*/React.createElement(Block, {
    title: "Best rallies",
    meta: "ranked from this match only"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 6
    }
  }, d.rallies.map(r => /*#__PURE__*/React.createElement(RallyRow, _extends({
    key: r.rallyId
  }, r)))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      marginTop: 14,
      paddingTop: 12,
      borderTop: "1px solid var(--border-hairline)"
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    tone: "warn"
  }, "*partial"), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-ui-sm)",
      fontSize: "var(--fs-11)",
      color: "var(--text-faint)"
    }
  }, "Score = 0.40 length percentile + 0.25 variety + 0.20 outcome pressure + 0.15 mean tracking confidence. Score OCR unavailable on starred rallies, so outcome pressure used the ordinary-state value."))), /*#__PURE__*/React.createElement(Block, {
    title: "Where the shuttle landed",
    meta: `${n(p => p.call !== "UNKNOWN")} of ${L.length} shots located · ${n(p => p.call === "UNKNOWN")} unknown`
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 28,
      alignItems: "flex-start"
    }
  }, /*#__PURE__*/React.createElement(CourtDiagram, {
    width: 190,
    showLabels: true,
    landings: d.landings,
    colorBy: mapMode
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: "flex",
      flexDirection: "column",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(SegmentedControl, {
    value: mapMode,
    onChange: setMapMode,
    options: [{
      value: "call",
      label: "By line call"
    }, {
      value: "player",
      label: "By player"
    }, {
      value: "pro",
      label: "Compare to pro",
      disabled: true
    }]
  }), /*#__PURE__*/React.createElement("p", {
    style: {
      font: "var(--type-body-sm)",
      color: "var(--text-body)",
      margin: 0,
      maxWidth: "58ch",
      textWrap: "pretty"
    }
  }, "One dot per shot: the point on the court where the shuttle came down, for every rally in this match. Dots are projected through the court seed onto the canonical 13.40 \xD7 6.10 m court, so they are comparable across camera angles and across videos."), /*#__PURE__*/React.createElement(Legend, {
    items: mapMode === "player" ? [{
      color: "var(--player-a)",
      label: "Player A hit it",
      value: n(p => p.side === "a")
    }, {
      color: "var(--player-b)",
      label: "Player B hit it",
      value: n(p => p.side === "b")
    }] : [{
      color: "var(--signal-in)",
      label: "Landed in",
      value: n(p => p.call === "IN")
    }, {
      color: "var(--signal-out)",
      label: "Landed out",
      value: n(p => p.call === "OUT")
    }, {
      color: "var(--signal-unknown)",
      label: "Not located",
      value: n(p => p.call === "UNKNOWN"),
      dashed: true
    }]
  }), /*#__PURE__*/React.createElement("p", {
    style: {
      font: "var(--type-ui-sm)",
      fontSize: "var(--fs-11)",
      color: "var(--text-faint)",
      margin: 0,
      maxWidth: "58ch"
    }
  }, "A 40 mm line belongs to the area it bounds (BWF Law 1.3), so a shuttle touching the line reads IN. Shots the shuttle tracker could not locate stay dashed and are never placed on the court \u2014 they are excluded from the counts above, not spread across them."))))));
}
Object.assign(window, {
  Summary
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/extension/Summary.jsx", error: String((e && e.message) || e) }); }

// ui_kits/extension/VideoStage.jsx
try { (() => {
const {
  Icon
} = window.BadmintonVisionDesignSystem_0ab536;

/* A deliberately generic video-page shell. It stands in for the host page so the overlay can be
   shown in context; it is not a recreation of any specific site's interface. */
function VideoStage({
  children,
  playing = true,
  onToggleBadge,
  badgeActive,
  time = "12:04"
}) {
  const d = window.BVDATA.video;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: "100%",
      background: "#0e1113",
      padding: "0 0 40px"
    }
  }, /*#__PURE__*/React.createElement("header", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 16,
      height: 52,
      padding: "0 20px",
      borderBottom: "1px solid rgba(255,255,255,.06)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 96,
      height: 12,
      borderRadius: 3,
      background: "rgba(255,255,255,.12)"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      maxWidth: 420,
      height: 30,
      borderRadius: 999,
      border: "1px solid rgba(255,255,255,.1)",
      margin: "0 auto"
    }
  }), /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onToggleBadge,
    title: "Badminton Vision",
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 7,
      height: 30,
      padding: "0 12px",
      cursor: "pointer",
      borderRadius: "var(--radius-pill)",
      border: `1px solid ${badgeActive ? "var(--lime-600)" : "rgba(255,255,255,.14)"}`,
      background: badgeActive ? "var(--lime-tint)" : "transparent",
      color: badgeActive ? "var(--lime-500)" : "var(--slate-200)",
      font: "var(--type-ui-sm)",
      fontFamily: "var(--font-display)",
      letterSpacing: "-0.01em"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 7,
      height: 7,
      borderRadius: 999,
      background: badgeActive ? "var(--lime-500)" : "var(--slate-400)"
    }
  }), "BV"), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 26,
      height: 26,
      borderRadius: 999,
      background: "rgba(255,255,255,.12)"
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1280px minmax(0,300px)",
      gap: 24,
      padding: "20px",
      minWidth: 1320,
      margin: "0 auto"
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      width: 1280,
      height: 720,
      borderRadius: "var(--radius-lg)",
      overflow: "hidden",
      background: "#07110f"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      background: "radial-gradient(120% 80% at 50% 12%,#1b4a3c 0%,#123830 42%,#0a1f1d 78%,#07110f 100%)"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      left: "50%",
      top: "18%",
      width: "78%",
      height: "68%",
      transform: "translateX(-50%) perspective(700px) rotateX(52deg)",
      background: "linear-gradient(#1f6b52,#17513f)",
      border: "2px solid rgba(233,245,240,.55)",
      boxShadow: "inset 0 0 0 1px rgba(233,245,240,.18)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      borderTop: "2px solid rgba(233,245,240,.4)",
      borderBottom: "2px solid rgba(233,245,240,.4)",
      top: "35%",
      height: "30%"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      left: "50%",
      top: 0,
      bottom: 0,
      width: 2,
      background: "rgba(233,245,240,.32)"
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      left: "50%",
      top: "34%",
      width: "82%",
      height: 3,
      transform: "translateX(-50%)",
      background: "rgba(240,248,245,.85)"
    }
  }), children, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      height: 64,
      background: "var(--scrim-bottom)",
      display: "flex",
      alignItems: "flex-end",
      gap: 12,
      padding: "0 14px 10px"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: playing ? "pause" : "play",
    size: 18,
    color: "#fff"
  }), /*#__PURE__*/React.createElement(Icon, {
    name: "volume-2",
    size: 18,
    color: "#fff"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-mono)",
      fontSize: 11,
      color: "#e8eef0"
    }
  }, time, " / ", d.duration), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      height: 3,
      borderRadius: 2,
      background: "rgba(255,255,255,.25)",
      marginBottom: 7
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: "17%",
      height: "100%",
      borderRadius: 2,
      background: "#ff3b30"
    }
  })), /*#__PURE__*/React.createElement(Icon, {
    name: "settings",
    size: 18,
    color: "#fff"
  }), /*#__PURE__*/React.createElement(Icon, {
    name: "maximize",
    size: 18,
    color: "#fff"
  }))), /*#__PURE__*/React.createElement("h1", {
    style: {
      font: "var(--type-h2)",
      color: "#f1f5f6",
      margin: "14px 0 6px"
    }
  }, d.title), /*#__PURE__*/React.createElement("p", {
    style: {
      font: "var(--type-body-sm)",
      color: "var(--text-faint)",
      margin: 0
    }
  }, d.channel, " \xB7 ", d.views, " \xB7 ", d.posted)), /*#__PURE__*/React.createElement("aside", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 12
    }
  }, [0, 1, 2, 3, 4].map(i => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: "flex",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 108,
      height: 62,
      borderRadius: 6,
      background: "linear-gradient(140deg,#173a31,#0d201d)",
      flex: "0 0 auto"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: "flex",
      flexDirection: "column",
      gap: 6,
      paddingTop: 2
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      height: 9,
      borderRadius: 3,
      background: "rgba(255,255,255,.12)"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      height: 9,
      width: "70%",
      borderRadius: 3,
      background: "rgba(255,255,255,.08)"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      height: 8,
      width: "45%",
      borderRadius: 3,
      background: "rgba(255,255,255,.06)"
    }
  })))))));
}
Object.assign(window, {
  VideoStage
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/extension/VideoStage.jsx", error: String((e && e.message) || e) }); }

// ui_kits/extension/data.js
try { (() => {
window.BVDATA = {
  video: {
    title: "Men's Singles Final — full match",
    channel: "Court Side Archive",
    views: "412K views",
    posted: "3 weeks ago",
    duration: "1:12:40"
  },
  strokes: [{
    sequence: 1,
    player: "A",
    shot: "Serve",
    time: "12:01.020",
    status: "accepted",
    source: "auto",
    confidence: 0.94
  }, {
    sequence: 2,
    player: "B",
    shot: "Lift",
    time: "12:01.760",
    status: "accepted",
    source: "auto",
    confidence: 0.81
  }, {
    sequence: 3,
    player: "A",
    shot: "Clear",
    time: "12:02.140",
    status: "accepted",
    source: "auto",
    confidence: 0.91
  }, {
    sequence: 4,
    player: "B",
    shot: "Drop",
    time: "12:03.020",
    status: "corrected",
    source: "manual",
    confidence: null
  }, {
    sequence: 5,
    player: "A",
    shot: "Net Shot",
    time: "12:03.560",
    status: "accepted",
    source: "auto",
    confidence: 0.72
  }, {
    sequence: 6,
    player: "B",
    shot: null,
    time: "12:03.980",
    status: "unclassified",
    source: "auto",
    confidence: 0.22
  }],
  suggestion: {
    shot: "Smash",
    confidence: 0.61,
    time: "12:04.120"
  },
  rallies: [{
    rank: 1,
    rallyId: 23,
    index: 87,
    shots: 31,
    duration: "42.6s",
    outcome: "winner",
    timestamp: "18:42",
    partial: true
  }, {
    rank: 2,
    rallyId: 9,
    index: 81,
    shots: 27,
    duration: "36.1s",
    outcome: "forced error",
    timestamp: "07:15"
  }, {
    rank: 3,
    rallyId: 14,
    index: 74,
    shots: 24,
    duration: "31.9s",
    outcome: "winner",
    timestamp: "12:01"
  }, {
    rank: 4,
    rallyId: 31,
    index: 66,
    shots: 19,
    duration: "24.4s",
    outcome: "unforced error",
    timestamp: "26:58"
  }, {
    rank: 5,
    rallyId: 5,
    index: 58,
    shots: 16,
    duration: "21.0s",
    outcome: "unclassified",
    timestamp: "04:33",
    partial: true
  }],
  shotMix: [{
    label: "Clear",
    value: 84,
    color: "var(--player-a)"
  }, {
    label: "Drop",
    value: 61,
    color: "#2f8f77"
  }, {
    label: "Smash",
    value: 47,
    color: "var(--lime-500)"
  }, {
    label: "Net",
    value: 39,
    color: "var(--player-b)"
  }, {
    label: "Unclassified",
    value: 18
  }],
  outcomeMix: [{
    label: "Winner",
    value: 31,
    color: "var(--signal-in)"
  }, {
    label: "Forced error",
    value: 22,
    color: "var(--signal-warn)"
  }, {
    label: "Unforced error",
    value: 27,
    color: "var(--signal-out)"
  }, {
    label: "Unclassified",
    value: 12
  }],
  landings: [{
    "x": 0.94,
    "y": 10,
    "side": "a",
    "call": "IN"
  }, {
    "x": 1.55,
    "y": 2.04,
    "side": "b",
    "call": "IN"
  }, {
    "x": 0.73,
    "y": 11.83,
    "side": "a",
    "call": "IN"
  }, {
    "x": 1.95,
    "y": -0.59,
    "side": "b",
    "call": "OUT"
  }, {
    "x": 3.52,
    "y": 9.76,
    "side": "a",
    "call": "IN"
  }, {
    "x": 2.77,
    "y": 6.06,
    "side": "b",
    "call": "IN"
  }, {
    "x": 2.49,
    "y": 11.59,
    "side": "a",
    "call": "IN"
  }, {
    "x": 3.39,
    "y": 3.67,
    "side": "b",
    "call": "IN"
  }, {
    "x": 5.48,
    "y": 13.96,
    "side": "a",
    "call": "UNKNOWN"
  }, {
    "x": 6.64,
    "y": 1.15,
    "side": "b",
    "call": "UNKNOWN"
  }, {
    "x": 6.61,
    "y": 11.56,
    "side": "a",
    "call": "OUT"
  }, {
    "x": 1.9,
    "y": -0.6,
    "side": "b",
    "call": "OUT"
  }, {
    "x": 2.99,
    "y": 11.8,
    "side": "a",
    "call": "UNKNOWN"
  }, {
    "x": 4.29,
    "y": 4.38,
    "side": "b",
    "call": "UNKNOWN"
  }, {
    "x": 0.52,
    "y": 10.34,
    "side": "a",
    "call": "IN"
  }, {
    "x": 2.83,
    "y": 2.55,
    "side": "b",
    "call": "IN"
  }, {
    "x": 2.72,
    "y": 9.37,
    "side": "a",
    "call": "IN"
  }, {
    "x": 2.4,
    "y": 2.1,
    "side": "b",
    "call": "IN"
  }, {
    "x": 3.42,
    "y": 10.26,
    "side": "a",
    "call": "IN"
  }, {
    "x": 0.94,
    "y": 4.26,
    "side": "b",
    "call": "IN"
  }, {
    "x": -0.28,
    "y": 10.86,
    "side": "a",
    "call": "UNKNOWN"
  }, {
    "x": 6.52,
    "y": 0.59,
    "side": "b",
    "call": "OUT"
  }, {
    "x": 2.78,
    "y": 12.74,
    "side": "a",
    "call": "UNKNOWN"
  }, {
    "x": 5.21,
    "y": 2.5,
    "side": "b",
    "call": "IN"
  }, {
    "x": 2.93,
    "y": 10.12,
    "side": "a",
    "call": "IN"
  }, {
    "x": 2.85,
    "y": -0.52,
    "side": "b",
    "call": "OUT"
  }, {
    "x": 3.51,
    "y": 13.81,
    "side": "a",
    "call": "OUT"
  }, {
    "x": 5.81,
    "y": 5.03,
    "side": "b",
    "call": "IN"
  }, {
    "x": 3.55,
    "y": 9.68,
    "side": "a",
    "call": "IN"
  }, {
    "x": 3.68,
    "y": -0.27,
    "side": "b",
    "call": "OUT"
  }, {
    "x": -0.38,
    "y": 9.35,
    "side": "a",
    "call": "OUT"
  }, {
    "x": 3.1,
    "y": 1.88,
    "side": "b",
    "call": "IN"
  }, {
    "x": 2.46,
    "y": 13.96,
    "side": "a",
    "call": "OUT"
  }, {
    "x": 1.33,
    "y": 3.44,
    "side": "b",
    "call": "IN"
  }, {
    "x": 3.1,
    "y": 12.38,
    "side": "a",
    "call": "IN"
  }, {
    "x": 3.38,
    "y": 3.54,
    "side": "b",
    "call": "IN"
  }, {
    "x": 2.96,
    "y": 9.59,
    "side": "a",
    "call": "IN"
  }, {
    "x": 3.28,
    "y": 1.93,
    "side": "b",
    "call": "IN"
  }, {
    "x": 3.62,
    "y": 14,
    "side": "a",
    "call": "OUT"
  }, {
    "x": 2.19,
    "y": 2.09,
    "side": "b",
    "call": "IN"
  }, {
    "x": -0.31,
    "y": 8.81,
    "side": "a",
    "call": "OUT"
  }, {
    "x": 4.12,
    "y": -0.16,
    "side": "b",
    "call": "UNKNOWN"
  }, {
    "x": 1.73,
    "y": 11.15,
    "side": "a",
    "call": "UNKNOWN"
  }, {
    "x": 4.47,
    "y": 5.7,
    "side": "b",
    "call": "IN"
  }, {
    "x": 3.43,
    "y": 9.7,
    "side": "a",
    "call": "IN"
  }, {
    "x": 5.45,
    "y": 1.56,
    "side": "b",
    "call": "IN"
  }, {
    "x": 4.49,
    "y": 10.64,
    "side": "a",
    "call": "IN"
  }, {
    "x": 4.43,
    "y": -0.52,
    "side": "b",
    "call": "OUT"
  }, {
    "x": 3.94,
    "y": 12.19,
    "side": "a",
    "call": "IN"
  }, {
    "x": 3.51,
    "y": 1.19,
    "side": "b",
    "call": "IN"
  }, {
    "x": 3.81,
    "y": 11.7,
    "side": "a",
    "call": "IN"
  }, {
    "x": 1.27,
    "y": 2.9,
    "side": "b",
    "call": "IN"
  }, {
    "x": 6.32,
    "y": 11.65,
    "side": "a",
    "call": "OUT"
  }, {
    "x": 5.28,
    "y": 6.17,
    "side": "b",
    "call": "IN"
  }, {
    "x": 5.02,
    "y": 14,
    "side": "a",
    "call": "OUT"
  }, {
    "x": 5.1,
    "y": 0.27,
    "side": "b",
    "call": "IN"
  }, {
    "x": 3.86,
    "y": 12.16,
    "side": "a",
    "call": "IN"
  }, {
    "x": 2,
    "y": 2.13,
    "side": "b",
    "call": "IN"
  }, {
    "x": 1.76,
    "y": 9.72,
    "side": "a",
    "call": "IN"
  }, {
    "x": 3.23,
    "y": 1.74,
    "side": "b",
    "call": "UNKNOWN"
  }, {
    "x": 3.53,
    "y": 11.93,
    "side": "a",
    "call": "IN"
  }, {
    "x": 5.44,
    "y": -0.59,
    "side": "b",
    "call": "UNKNOWN"
  }, {
    "x": 3.78,
    "y": 11.98,
    "side": "a",
    "call": "IN"
  }, {
    "x": 0.11,
    "y": 4.87,
    "side": "b",
    "call": "IN"
  }, {
    "x": 2.31,
    "y": 9.72,
    "side": "a",
    "call": "IN"
  }, {
    "x": 1.82,
    "y": -0.34,
    "side": "b",
    "call": "OUT"
  }, {
    "x": 3.5,
    "y": 13.54,
    "side": "a",
    "call": "OUT"
  }, {
    "x": 2.67,
    "y": 2.47,
    "side": "b",
    "call": "IN"
  }, {
    "x": 1.99,
    "y": 12.36,
    "side": "a",
    "call": "IN"
  }, {
    "x": 3.47,
    "y": 2.1,
    "side": "b",
    "call": "IN"
  }, {
    "x": 4.2,
    "y": 11.58,
    "side": "a",
    "call": "IN"
  }, {
    "x": 3.49,
    "y": 4.22,
    "side": "b",
    "call": "IN"
  }, {
    "x": 1.42,
    "y": 10.39,
    "side": "a",
    "call": "IN"
  }, {
    "x": 3.01,
    "y": 0.78,
    "side": "b",
    "call": "IN"
  }, {
    "x": 4.7,
    "y": 11.74,
    "side": "a",
    "call": "IN"
  }, {
    "x": 3.45,
    "y": 1.28,
    "side": "b",
    "call": "IN"
  }, {
    "x": 2.91,
    "y": 9.62,
    "side": "a",
    "call": "IN"
  }, {
    "x": 1.67,
    "y": 2.22,
    "side": "b",
    "call": "UNKNOWN"
  }, {
    "x": 1.76,
    "y": 11.94,
    "side": "a",
    "call": "UNKNOWN"
  }, {
    "x": 1.81,
    "y": 3.65,
    "side": "b",
    "call": "IN"
  }, {
    "x": 3.1,
    "y": 13.86,
    "side": "a",
    "call": "OUT"
  }, {
    "x": 4.15,
    "y": 1.48,
    "side": "b",
    "call": "IN"
  }, {
    "x": 0.04,
    "y": 10.64,
    "side": "a",
    "call": "IN"
  }, {
    "x": 4.6,
    "y": 1.16,
    "side": "b",
    "call": "IN"
  }, {
    "x": 2.37,
    "y": 8.51,
    "side": "a",
    "call": "IN"
  }, {
    "x": 3.02,
    "y": 2.26,
    "side": "b",
    "call": "IN"
  }, {
    "x": 3.72,
    "y": 10.53,
    "side": "a",
    "call": "IN"
  }, {
    "x": 6.37,
    "y": 2.04,
    "side": "b",
    "call": "OUT"
  }, {
    "x": 6.38,
    "y": 8.24,
    "side": "a",
    "call": "OUT"
  }, {
    "x": 3.66,
    "y": 2.51,
    "side": "b",
    "call": "IN"
  }, {
    "x": 3.61,
    "y": 9.81,
    "side": "a",
    "call": "IN"
  }, {
    "x": 3.45,
    "y": 3.48,
    "side": "b",
    "call": "IN"
  }, {
    "x": 1.56,
    "y": 13.88,
    "side": "a",
    "call": "OUT"
  }, {
    "x": 4.2,
    "y": 3.37,
    "side": "b",
    "call": "IN"
  }, {
    "x": 2.4,
    "y": 9.96,
    "side": "a",
    "call": "IN"
  }, {
    "x": 2.59,
    "y": -0.6,
    "side": "b",
    "call": "OUT"
  }, {
    "x": 5.28,
    "y": 14,
    "side": "a",
    "call": "UNKNOWN"
  }, {
    "x": 3.2,
    "y": 4.87,
    "side": "b",
    "call": "IN"
  }, {
    "x": 0.9,
    "y": 9.34,
    "side": "a",
    "call": "IN"
  }, {
    "x": 3.53,
    "y": 4.36,
    "side": "b",
    "call": "IN"
  }, {
    "x": 4.97,
    "y": 12.25,
    "side": "a",
    "call": "IN"
  }, {
    "x": 1.36,
    "y": 1.67,
    "side": "b",
    "call": "IN"
  }, {
    "x": -0.5,
    "y": 8.25,
    "side": "a",
    "call": "OUT"
  }, {
    "x": 1.67,
    "y": 4.39,
    "side": "b",
    "call": "IN"
  }, {
    "x": 2.91,
    "y": 13.56,
    "side": "a",
    "call": "UNKNOWN"
  }, {
    "x": 1.72,
    "y": 4.18,
    "side": "b",
    "call": "IN"
  }, {
    "x": 1.45,
    "y": 13.65,
    "side": "a",
    "call": "OUT"
  }, {
    "x": 4.18,
    "y": 2.96,
    "side": "b",
    "call": "UNKNOWN"
  }, {
    "x": 2.12,
    "y": 13.84,
    "side": "a",
    "call": "OUT"
  }, {
    "x": 4,
    "y": 0.55,
    "side": "b",
    "call": "IN"
  }, {
    "x": 0.49,
    "y": 9.33,
    "side": "a",
    "call": "IN"
  }, {
    "x": 1.11,
    "y": 2.54,
    "side": "b",
    "call": "IN"
  }, {
    "x": 3.56,
    "y": 9.3,
    "side": "a",
    "call": "UNKNOWN"
  }, {
    "x": 2.88,
    "y": -0.38,
    "side": "b",
    "call": "OUT"
  }, {
    "x": 2.99,
    "y": 13.97,
    "side": "a",
    "call": "OUT"
  }, {
    "x": 2.83,
    "y": 1.31,
    "side": "b",
    "call": "IN"
  }, {
    "x": 2.66,
    "y": 13.33,
    "side": "a",
    "call": "IN"
  }, {
    "x": 2.55,
    "y": 3.44,
    "side": "b",
    "call": "UNKNOWN"
  }, {
    "x": 3.38,
    "y": 10.5,
    "side": "a",
    "call": "IN"
  }, {
    "x": 0.52,
    "y": 2.43,
    "side": "b",
    "call": "IN"
  }, {
    "x": 2.62,
    "y": 13.98,
    "side": "a",
    "call": "OUT"
  }, {
    "x": 3.89,
    "y": 2.9,
    "side": "b",
    "call": "IN"
  }, {
    "x": 5.07,
    "y": 10.7,
    "side": "a",
    "call": "IN"
  }, {
    "x": 6.47,
    "y": 2.56,
    "side": "b",
    "call": "UNKNOWN"
  }, {
    "x": 2.29,
    "y": 8.36,
    "side": "a",
    "call": "IN"
  }, {
    "x": -0.13,
    "y": 0.04,
    "side": "b",
    "call": "UNKNOWN"
  }, {
    "x": 1.05,
    "y": 9.63,
    "side": "a",
    "call": "IN"
  }, {
    "x": 3.29,
    "y": 3.88,
    "side": "b",
    "call": "IN"
  }, {
    "x": -0.17,
    "y": 13.07,
    "side": "a",
    "call": "OUT"
  }, {
    "x": 6.02,
    "y": 3.17,
    "side": "b",
    "call": "IN"
  }, {
    "x": 3.41,
    "y": 8.19,
    "side": "a",
    "call": "IN"
  }, {
    "x": 4.21,
    "y": -0.06,
    "side": "b",
    "call": "OUT"
  }, {
    "x": 4.58,
    "y": 10.34,
    "side": "a",
    "call": "IN"
  }, {
    "x": 0.74,
    "y": 4.03,
    "side": "b",
    "call": "IN"
  }, {
    "x": -0.47,
    "y": 8.98,
    "side": "a",
    "call": "OUT"
  }, {
    "x": 6.6,
    "y": 1.66,
    "side": "b",
    "call": "OUT"
  }, {
    "x": 3.72,
    "y": 9.14,
    "side": "a",
    "call": "IN"
  }, {
    "x": 4.6,
    "y": 3.2,
    "side": "b",
    "call": "IN"
  }, {
    "x": 2.93,
    "y": 8.58,
    "side": "a",
    "call": "UNKNOWN"
  }, {
    "x": 2.62,
    "y": 3.92,
    "side": "b",
    "call": "IN"
  }, {
    "x": 3.87,
    "y": 10.09,
    "side": "a",
    "call": "IN"
  }, {
    "x": 2.17,
    "y": 5.73,
    "side": "b",
    "call": "IN"
  }, {
    "x": 2.9,
    "y": 9.57,
    "side": "a",
    "call": "IN"
  }, {
    "x": 1.54,
    "y": 3.53,
    "side": "b",
    "call": "IN"
  }, {
    "x": 2.56,
    "y": 13.98,
    "side": "a",
    "call": "OUT"
  }, {
    "x": 2.22,
    "y": 0.11,
    "side": "b",
    "call": "IN"
  }, {
    "x": 3.71,
    "y": 13.68,
    "side": "a",
    "call": "UNKNOWN"
  }, {
    "x": 6.29,
    "y": 4.35,
    "side": "b",
    "call": "UNKNOWN"
  }, {
    "x": 1.04,
    "y": 10.15,
    "side": "a",
    "call": "IN"
  }, {
    "x": 2,
    "y": 0.35,
    "side": "b",
    "call": "IN"
  }, {
    "x": 1.88,
    "y": 12.3,
    "side": "a",
    "call": "IN"
  }, {
    "x": 3.76,
    "y": 4.21,
    "side": "b",
    "call": "IN"
  }, {
    "x": 2.93,
    "y": 8.85,
    "side": "a",
    "call": "UNKNOWN"
  }, {
    "x": 2.25,
    "y": 4.99,
    "side": "b",
    "call": "IN"
  }, {
    "x": 3.81,
    "y": 10.01,
    "side": "a",
    "call": "IN"
  }, {
    "x": 5.49,
    "y": 0.94,
    "side": "b",
    "call": "IN"
  }, {
    "x": 2.86,
    "y": 11.22,
    "side": "a",
    "call": "IN"
  }, {
    "x": 1.33,
    "y": 1.22,
    "side": "b",
    "call": "IN"
  }, {
    "x": 4.5,
    "y": 11.8,
    "side": "a",
    "call": "IN"
  }, {
    "x": 1.48,
    "y": -0.6,
    "side": "b",
    "call": "OUT"
  }, {
    "x": 2.76,
    "y": 10.05,
    "side": "a",
    "call": "IN"
  }, {
    "x": 1.92,
    "y": 3.37,
    "side": "b",
    "call": "IN"
  }, {
    "x": 3.47,
    "y": 13.7,
    "side": "a",
    "call": "UNKNOWN"
  }, {
    "x": 6.39,
    "y": 2.31,
    "side": "b",
    "call": "OUT"
  }, {
    "x": 0.94,
    "y": 8.68,
    "side": "a",
    "call": "IN"
  }, {
    "x": 3.16,
    "y": 4.05,
    "side": "b",
    "call": "IN"
  }, {
    "x": 3.11,
    "y": 13.76,
    "side": "a",
    "call": "OUT"
  }, {
    "x": 2.26,
    "y": 2.9,
    "side": "b",
    "call": "IN"
  }, {
    "x": 2.59,
    "y": 9.93,
    "side": "a",
    "call": "IN"
  }, {
    "x": 3.76,
    "y": 2.23,
    "side": "b",
    "call": "IN"
  }, {
    "x": 1.53,
    "y": 10.98,
    "side": "a",
    "call": "UNKNOWN"
  }, {
    "x": -0.26,
    "y": 3.62,
    "side": "b",
    "call": "UNKNOWN"
  }, {
    "x": 3.98,
    "y": 8.86,
    "side": "a",
    "call": "IN"
  }, {
    "x": 3.27,
    "y": 4.38,
    "side": "b",
    "call": "UNKNOWN"
  }, {
    "x": 6.26,
    "y": 10.03,
    "side": "a",
    "call": "OUT"
  }, {
    "x": 2.76,
    "y": 4.68,
    "side": "b",
    "call": "IN"
  }, {
    "x": 3.08,
    "y": 9.29,
    "side": "a",
    "call": "IN"
  }, {
    "x": 3.2,
    "y": 4.05,
    "side": "b",
    "call": "UNKNOWN"
  }, {
    "x": 2.51,
    "y": 12.77,
    "side": "a",
    "call": "IN"
  }, {
    "x": 3.53,
    "y": 2.38,
    "side": "b",
    "call": "IN"
  }, {
    "x": 1.21,
    "y": 8.59,
    "side": "a",
    "call": "IN"
  }, {
    "x": 2.53,
    "y": 4.45,
    "side": "b",
    "call": "IN"
  }, {
    "x": 6.33,
    "y": 6.68,
    "side": "a",
    "call": "OUT"
  }, {
    "x": -0.38,
    "y": 3.63,
    "side": "b",
    "call": "OUT"
  }, {
    "x": 3.05,
    "y": 9.65,
    "side": "a",
    "call": "UNKNOWN"
  }, {
    "x": 4.36,
    "y": 4.78,
    "side": "b",
    "call": "IN"
  }, {
    "x": 6.23,
    "y": 9.67,
    "side": "a",
    "call": "OUT"
  }, {
    "x": 2.04,
    "y": -0.6,
    "side": "b",
    "call": "OUT"
  }, {
    "x": 3.15,
    "y": 13.51,
    "side": "a",
    "call": "OUT"
  }, {
    "x": 1.97,
    "y": 3.23,
    "side": "b",
    "call": "IN"
  }, {
    "x": -0.27,
    "y": 9.32,
    "side": "a",
    "call": "OUT"
  }, {
    "x": 3.69,
    "y": 3.93,
    "side": "b",
    "call": "IN"
  }, {
    "x": 1.3,
    "y": 13.7,
    "side": "a",
    "call": "OUT"
  }, {
    "x": 1.62,
    "y": -0.25,
    "side": "b",
    "call": "OUT"
  }, {
    "x": 2.6,
    "y": 14,
    "side": "a",
    "call": "UNKNOWN"
  }, {
    "x": 3.09,
    "y": -0.38,
    "side": "b",
    "call": "OUT"
  }, {
    "x": 6.29,
    "y": 13.81,
    "side": "a",
    "call": "OUT"
  }, {
    "x": -0.37,
    "y": 3.37,
    "side": "b",
    "call": "OUT"
  }, {
    "x": 4.02,
    "y": 12.05,
    "side": "a",
    "call": "IN"
  }, {
    "x": 1.43,
    "y": 4.28,
    "side": "b",
    "call": "IN"
  }, {
    "x": 1.14,
    "y": 11.52,
    "side": "a",
    "call": "IN"
  }, {
    "x": 4.01,
    "y": 3.72,
    "side": "b",
    "call": "IN"
  }, {
    "x": 0.54,
    "y": 10.1,
    "side": "a",
    "call": "IN"
  }, {
    "x": 5.34,
    "y": 4.28,
    "side": "b",
    "call": "IN"
  }, {
    "x": 1.81,
    "y": 12.2,
    "side": "a",
    "call": "IN"
  }, {
    "x": 3.85,
    "y": 2.96,
    "side": "b",
    "call": "IN"
  }, {
    "x": 2.77,
    "y": 10.15,
    "side": "a",
    "call": "IN"
  }, {
    "x": 2.83,
    "y": 3.45,
    "side": "b",
    "call": "UNKNOWN"
  }, {
    "x": 1.39,
    "y": 13.67,
    "side": "a",
    "call": "UNKNOWN"
  }, {
    "x": -0.55,
    "y": 1.86,
    "side": "b",
    "call": "OUT"
  }, {
    "x": 2.05,
    "y": 9.19,
    "side": "a",
    "call": "IN"
  }, {
    "x": 1.55,
    "y": -0.3,
    "side": "b",
    "call": "OUT"
  }],
  axes: [{
    label: "Longitudinal",
    options: ["rear", "mid", "front"],
    value: "rear"
  }, {
    label: "Lateral",
    options: ["forehand", "centre", "backhand"],
    value: "forehand"
  }, {
    label: "Timing",
    options: ["early", "normal", "late"],
    value: "normal"
  }, {
    label: "Intention",
    options: ["offensive", "neutral", "defensive"],
    value: "offensive"
  }, {
    label: "Impact",
    options: ["above", "shoulder", "below"],
    value: "above"
  }, {
    label: "Direction",
    options: ["straight", "cross", "centre"],
    value: "cross"
  }]
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/extension/data.js", error: String((e && e.message) || e) }); }

__ds_ns.DimensionAxis = __ds_scope.DimensionAxis;

__ds_ns.SegmentedControl = __ds_scope.SegmentedControl;

__ds_ns.SHOT_FAMILIES = __ds_scope.SHOT_FAMILIES;

__ds_ns.ShotPicker = __ds_scope.ShotPicker;

__ds_ns.Toggle = __ds_scope.Toggle;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Chip = __ds_scope.Chip;

__ds_ns.Icon = __ds_scope.Icon;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.KeyHint = __ds_scope.KeyHint;

__ds_ns.Panel = __ds_scope.Panel;

__ds_ns.CourtDiagram = __ds_scope.CourtDiagram;

__ds_ns.Legend = __ds_scope.Legend;

__ds_ns.MixBar = __ds_scope.MixBar;

__ds_ns.RallyRow = __ds_scope.RallyRow;

__ds_ns.StatTile = __ds_scope.StatTile;

__ds_ns.StrokeFeedItem = __ds_scope.StrokeFeedItem;

__ds_ns.SuggestionRow = __ds_scope.SuggestionRow;

__ds_ns.Callout = __ds_scope.Callout;

__ds_ns.ConfidenceMeter = __ds_scope.ConfidenceMeter;

__ds_ns.EmptyState = __ds_scope.EmptyState;

__ds_ns.InfoTip = __ds_scope.InfoTip;

__ds_ns.StatusChip = __ds_scope.StatusChip;

__ds_ns.StepDots = __ds_scope.StepDots;

})();

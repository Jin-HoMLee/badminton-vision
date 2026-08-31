/*
 * Small DOM implementations of the supplied design-system primitives.
 * The source components remain in design-system/components; these counterparts
 * keep the unpacked MV3 build dependency-free while consuming the same tokens.
 */
(function (root) {
  var iconPaths = {
    activity: [["path", { d: "M22 12h-4l-3 9L9 3l-3 9H2" }]],
    "arrow-left": [["path", { d: "m12 19-7-7 7-7" }], ["path", { d: "M19 12H5" }]],
    check: [["path", { d: "m5 12 4 4L19 6" }]],
    clock: [["circle", { cx: "12", cy: "12", r: "10" }], ["polyline", { points: "12 6 12 12 16 14" }]],
    "chevron-down": [["path", { d: "m6 9 6 6 6-6" }]],
    "chevron-right": [["path", { d: "m9 18 6-6-6-6" }]],
    "chevron-up": [["path", { d: "m18 15-6-6-6 6" }]],
    crosshair: [["circle", { cx: "12", cy: "12", r: "10" }], ["line", { x1: "22", y1: "12", x2: "18", y2: "12" }], ["line", { x1: "6", y1: "12", x2: "2", y2: "12" }], ["line", { x1: "12", y1: "6", x2: "12", y2: "2" }], ["line", { x1: "12", y1: "22", x2: "12", y2: "18" }]],
    download: [["path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }], ["polyline", { points: "7 10 12 15 17 10" }], ["line", { x1: "12", y1: "15", x2: "12", y2: "3" }]],
    external: [["path", { d: "M15 3h6v6" }], ["path", { d: "M10 14 21 3" }], ["path", { d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" }]],
    filter: [["polygon", { points: "22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" }]],
    grip: [["circle", { cx: "9", cy: "5", r: "1" }], ["circle", { cx: "15", cy: "5", r: "1" }], ["circle", { cx: "9", cy: "12", r: "1" }], ["circle", { cx: "15", cy: "12", r: "1" }], ["circle", { cx: "9", cy: "19", r: "1" }], ["circle", { cx: "15", cy: "19", r: "1" }]],
    help: [["circle", { cx: "12", cy: "12", r: "10" }], ["path", { d: "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" }], ["line", { x1: "12", y1: "17", x2: "12.01", y2: "17" }]],
    info: [["circle", { cx: "12", cy: "12", r: "10" }], ["line", { x1: "12", y1: "16", x2: "12", y2: "12" }], ["line", { x1: "12", y1: "8", x2: "12.01", y2: "8" }]],
    layout: [["rect", { x: "3", y: "3", width: "7", height: "7" }], ["rect", { x: "14", y: "3", width: "7", height: "7" }], ["rect", { x: "14", y: "14", width: "7", height: "7" }], ["rect", { x: "3", y: "14", width: "7", height: "7" }]],
    list: [["line", { x1: "8", y1: "6", x2: "21", y2: "6" }], ["line", { x1: "8", y1: "12", x2: "21", y2: "12" }], ["line", { x1: "8", y1: "18", x2: "21", y2: "18" }], ["line", { x1: "3", y1: "6", x2: "3.01", y2: "6" }], ["line", { x1: "3", y1: "12", x2: "3.01", y2: "12" }], ["line", { x1: "3", y1: "18", x2: "3.01", y2: "18" }]],
    maximize: [["path", { d: "M8 3H5a2 2 0 0 0-2 2v3" }], ["path", { d: "M21 8V5a2 2 0 0 0-2-2h-3" }], ["path", { d: "M3 16v3a2 2 0 0 0 2 2h3" }], ["path", { d: "M16 21h3a2 2 0 0 0 2-2v-3" }]],
    pause: [["rect", { x: "6", y: "4", width: "4", height: "16" }], ["rect", { x: "14", y: "4", width: "4", height: "16" }]],
    pencil: [["path", { d: "M12 20h9" }], ["path", { d: "M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z" }]],
    play: [["polygon", { points: "6 3 20 12 6 21 6 3" }]],
    settings: [["path", { d: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" }], ["circle", { cx: "12", cy: "12", r: "3" }]],
    sliders: [["line", { x1: "4", y1: "21", x2: "4", y2: "14" }], ["line", { x1: "4", y1: "10", x2: "4", y2: "3" }], ["line", { x1: "12", y1: "21", x2: "12", y2: "12" }], ["line", { x1: "12", y1: "8", x2: "12", y2: "3" }], ["line", { x1: "20", y1: "21", x2: "20", y2: "16" }], ["line", { x1: "20", y1: "12", x2: "20", y2: "3" }], ["line", { x1: "2", y1: "14", x2: "6", y2: "14" }], ["line", { x1: "10", y1: "8", x2: "14", y2: "8" }], ["line", { x1: "18", y1: "16", x2: "22", y2: "16" }]],
    table: [["path", { d: "M3 3h18v18H3zM3 9h18M3 15h18M9 3v18" }]],
    volume: [["polygon", { points: "11 5 6 9 2 9 2 15 6 15 11 19 11 5" }], ["path", { d: "M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" }]],
    x: [["line", { x1: "18", y1: "6", x2: "6", y2: "18" }], ["line", { x1: "6", y1: "6", x2: "18", y2: "18" }]],
    "triangle-alert": [["path", { d: "m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" }], ["line", { x1: "12", y1: "9", x2: "12", y2: "13" }], ["line", { x1: "12", y1: "17", x2: "12.01", y2: "17" }]]
  };

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (key) {
      var value = attrs[key];
      if (value == null || value === false) return;
      if (key === "className") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key === "style" && typeof value === "object") Object.assign(node.style, value);
      else if (key === "dataset") Object.keys(value).forEach(function (dataKey) { node.dataset[dataKey] = value[dataKey]; });
      else if (key.slice(0, 2) === "on" && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key === "checked") node.checked = Boolean(value);
      else if (key === "disabled") node.disabled = Boolean(value);
      else if (key === "html") node.innerHTML = value;
      else node.setAttribute(key, value === true ? "" : value);
    });
    (Array.isArray(children) ? children : [children]).forEach(function (child) {
      if (child == null || child === false) return;
      node.appendChild(child.nodeType ? child : document.createTextNode(String(child)));
    });
    return node;
  }

  function svgEl(tag, attrs) {
    var node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.keys(attrs || {}).forEach(function (key) { node.setAttribute(key, attrs[key]); });
    return node;
  }

  function icon(name, size) {
    var svg = svgEl("svg", { xmlns: "http://www.w3.org/2000/svg", width: size || 16, height: size || 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.75", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" });
    (iconPaths[name] || iconPaths.info).forEach(function (item) { var child = svgEl(item[0], item[1]); svg.appendChild(child); });
    return svg;
  }

  function button(label, opts) {
    opts = opts || {};
    var children = [];
    if (opts.icon) children.push(icon(opts.icon, opts.iconSize || 16));
    children.push(label);
    if (opts.iconRight) children.push(icon(opts.iconRight, opts.iconSize || 13));
    var attrs = { className: "bv-button " + (opts.variant || "secondary") + (opts.size ? " " + opts.size : "") + (opts.full ? " full" : ""), type: "button", disabled: opts.disabled, title: opts.title, "aria-pressed": opts.pressed, onClick: opts.onClick, style: opts.style };
    return el("button", attrs, children);
  }

  function iconButton(name, label, opts) {
    opts = opts || {};
    return el("button", { className: "bv-icon-button " + (opts.size || "") + (opts.variant || "") + (opts.active ? " active" : ""), type: "button", "aria-label": label, title: label, disabled: opts.disabled, onClick: opts.onClick }, [icon(name, opts.iconSize || 14)]);
  }

  var badgeTone = { neutral: "neutral", accent: "accent", in: "in", out: "out", warn: "warn", info: "info", unknown: "unknown" };
  function badge(text, tone, uppercase) { return el("span", { className: "bv-badge " + (badgeTone[tone] || "neutral"), style: uppercase === false ? { textTransform: "none", letterSpacing: "0" } : null }, [text]); }
  function kbd(text, accent) { return el("kbd", { className: "bv-kbd" + (accent ? " accent" : "") }, [text]); }

  function confidence(value, opts) {
    opts = opts || {};
    var band = value == null ? "unknown" : value >= .75 ? "high" : value >= .45 ? "medium" : "low";
    var count = value == null ? 0 : Math.max(1, Math.round(value * 4));
    var segments = el("span", { className: "bv-confidence-segments " + band });
    for (var i = 0; i < 4; i += 1) segments.appendChild(el("i", { className: i < count ? "filled" : "" }));
    var label = opts.label ? el("span", { className: "bv-label" }, [opts.label]) : null;
    var word = band === "high" ? "sure" : band === "medium" ? "fairly sure" : band === "low" ? "not sure" : "unknown";
    var valueText = value == null ? "unknown" : (opts.showWord ? word + " " : "") + Math.round(value * 100) + "%";
    return el("span", { className: "bv-confidence " + band, title: value == null ? "confidence unknown" : "confidence " + Math.round(value * 100) + "%" }, [label, segments, (opts.showValue !== false || opts.showWord) ? el("span", { className: "bv-confidence-value" }, [valueText]) : null]);
  }

  function statusChip(state, label, detail, onClick) {
    var className = "bv-status-chip " + (state || "off");
    var node = el("div", { className: className, role: onClick ? "button" : null, tabindex: onClick ? "0" : null, onClick: onClick }, [el("span", { className: "bv-status-dot" }), el("span", { className: "bv-status-label" }, [label || (state === "live" ? "Live" : state === "ready" ? "Ready" : "Off")]), detail ? el("span", { className: "bv-status-detail" }, [detail]) : null]);
    if (onClick) node.addEventListener("keydown", function (event) { if (event.key === "Enter" || event.key === " ") onClick(event); });
    return node;
  }

  function panel(title, opts, children) {
    opts = opts || {};
    var section = el("section", { className: "bv-panel" + (opts.solid ? " solid" : "") + (opts.className ? " " + opts.className : ""), style: opts.style, "aria-label": title });
    if (title || opts.actions) {
      var heading = el("header", { className: "bv-panel-header" }, [opts.icon ? icon(opts.icon, 13) : null, title ? el("h2", {}, [title]) : null, opts.mediaTime ? el("span", { className: "bv-panel-time" + (opts.stale ? " stale" : "") }, [opts.mediaTime + (opts.stale ? " · stale" : "")]) : null, el("span", { className: "bv-panel-actions" }, opts.actions || [])]);
      section.appendChild(heading);
    }
    if (!opts.collapsed) section.appendChild(el("div", { className: "bv-panel-body", style: opts.bodyStyle }, children || []));
    if (!opts.collapsed && opts.footer) section.appendChild(el("footer", { className: "bv-panel-footer" }, opts.footer));
    return section;
  }

  function callout(tone, title, body, opts) {
    opts = opts || {};
    var iconName = tone === "warn" ? "triangle-alert" : tone === "info" ? "info" : "help";
    var content = [el("span", { className: "bv-callout-icon" }, [icon(iconName, 14)]), el("span", { className: "bv-callout-copy" }, [title ? el("strong", {}, [title]) : null, el("span", {}, [body])])];
    if (opts.onDismiss) content.push(iconButton("x", "Dismiss", { size: "sm", onClick: opts.onDismiss }));
    return el("div", { className: "bv-callout " + (tone || "guide"), role: tone === "warn" ? "status" : null }, content);
  }

  function stepDots(current, labels) {
    var node = el("div", { className: "bv-step-dots", "aria-label": "Court seed step " + Math.min(current + 1, 4) + " of 4" });
    for (var i = 0; i < 4; i += 1) node.appendChild(el("span", { className: "bv-step-dot " + (i < current ? "done" : i === current ? "active" : ""), title: labels && labels[i] }, [i + 1]));
    return node;
  }

  function segmented(options, value, onChange, full) {
    var node = el("div", { className: "bv-segmented" + (full ? " full" : ""), role: "radiogroup" });
    options.forEach(function (option) {
      option = typeof option === "string" ? { value: option, label: option } : option;
      node.appendChild(el("button", { type: "button", role: "radio", "aria-checked": option.value === value, disabled: option.disabled, onClick: function () { if (onChange && !option.disabled) onChange(option.value); } }, [option.label]));
    });
    return node;
  }

  function toggle(label, description, checked, onChange, opts) {
    opts = opts || {};
    var sw = el("button", { className: "bv-toggle-switch", id: opts.id, type: "button", role: "switch", "aria-checked": Boolean(checked), disabled: opts.disabled, "aria-label": "Toggle " + label, onClick: function () { if (onChange && !opts.disabled) onChange(!checked); } }, [el("i")]);
    return el("label", { className: "bv-toggle" + (opts.disabled ? " disabled" : ""), for: opts.id }, [el("span", { className: "bv-toggle-copy" }, [el("strong", {}, [label]), description ? el("span", {}, [description]) : null]), sw]);
  }

  function chip(text, selected, onClick, count) { return el("button", { className: "bv-chip", type: "button", "aria-pressed": Boolean(selected), onClick: onClick }, [text, count == null ? null : el("span", { className: "bv-mono", style: { fontSize: "var(--fs-11)" } }, [count])]); }

  function stat(label, value, unit, note, accent) { return el("div", { className: "bv-stat" }, [el("span", { className: "bv-stat-label" }, [label]), el("span", { className: "bv-stat-value" + (accent ? " accent" : "") }, [value, unit ? el("small", { className: "bv-stat-unit" }, [unit]) : null]), note ? el("span", { className: "bv-stat-note" }, [note]) : null]); }

  function mixBar(segments) {
    var total = segments.reduce(function (sum, item) { return sum + item.value; }, 0) || 1;
    var bar = el("div", { className: "bv-mix-bar", role: "img", "aria-label": segments.map(function (item) { return item.label + " " + item.value; }).join(", ") });
    segments.forEach(function (item) { bar.appendChild(el("i", { style: { flex: String(item.value) + " 1 0", background: item.color || "var(--signal-unknown)" }, title: item.label + ": " + Math.round(item.value / total * 100) + "%" })); });
    var legend = el("div", { className: "bv-mix-legend" });
    segments.forEach(function (item) { legend.appendChild(el("span", { className: "bv-mix-item" }, [el("i", { className: "bv-mix-dot", style: { background: item.color || "var(--signal-unknown)" } }), item.label, el("b", {}, [Math.round(item.value / total * 100) + "%"])])); });
    return el("div", { className: "bv-mix" }, [bar, legend]);
  }

  function strokeFeedItem(stroke, onClick) {
    var unknown = stroke.status === "unclassified";
    var sourceTone = stroke.status === "corrected" ? "info" : stroke.status === "unclassified" ? "unknown" : "in";
    var sourceLabel = stroke.fixtureRow ? "fixture" : stroke.source === "manual" ? "manual" : stroke.source === "auto" ? "suggestion" : stroke.status;
    if (stroke.fixtureRow) sourceTone = "neutral";
    var row = el("div", { className: "bv-feed-row" + (stroke.selected ? " selected" : "") + (stroke.source === "manual" && !stroke.fixtureRow ? " manual" : ""), role: onClick ? "button" : null, tabindex: onClick ? "0" : null, "data-bso-event-id": stroke.eventId, "data-bso-label-source": stroke.fixtureRow ? "fixture" : stroke.source || "unknown", onClick: onClick }, [el("span", { className: "bv-feed-seq" }, [stroke.sequence]), el("span", { className: "bv-feed-player " + (stroke.player === "B" || stroke.playerId === "B" ? "b" : "") }), el("span", { className: "bv-feed-copy" }, [el("span", { className: "bv-feed-shot" + (unknown ? " unknown" : "") }, [unknown ? "unclassified" : stroke.shot]), el("span", { className: "bv-feed-time" }, [stroke.time || "—"]) ]), el("span", { className: "bv-feed-meta" }, [stroke.confidence !== undefined && stroke.confidence !== null ? confidence(stroke.confidence, { showValue: false }) : null, badge(sourceLabel, sourceTone)] )]);
    if (onClick) row.addEventListener("keydown", function (event) { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onClick(event); } });
    return row;
  }

  function suggestionRow(suggestion, onAccept, onCorrect) {
    return el("div", { className: "bv-suggestion" }, [el("span", { className: "bv-suggestion-copy" }, [el("span", { className: "bv-suggestion-line" }, [el("span", { className: "bv-suggestion-label" }, ["looks like"]), el("span", { className: "bv-suggestion-shot" }, [suggestion.shot]), el("span", { className: "bv-suggestion-time" }, [suggestion.time])]), confidence(suggestion.confidence, { showWord: true })]), button("Looks right", { variant: "primary", size: "sm", iconRight: null, onClick: onAccept }), button("Change it", { variant: "ghost", size: "sm", onClick: onCorrect })]);
  }

  function dimensionAxis(label, options, value, onChange) {
    return el("div", { className: "bv-axis" }, [el("span", { className: "bv-axis-label" }, [label]), el("span", { className: "bv-axis-options" }, options.map(function (option) { return el("button", { className: "bv-axis-option" + (option === value ? " selected" : ""), type: "button", "aria-pressed": option === value, onClick: function () { onChange(option); } }, [option]); }))]);
  }

  function shotPicker(value, suggested, onChange) {
    var shots = ["Serve", "Clear", "Drop", "Smash", "Half Smash", "Lift", "Net Shot", "Net Kill", "Push", "Drive", "Block"];
    return el("div", { className: "bv-shot-picker" }, shots.map(function (shot, i) { var selected = value === shot; return el("button", { className: "bv-shot" + (selected ? " selected" : suggested === shot ? " suggested" : ""), type: "button", "aria-pressed": selected, onClick: function () { onChange(shot); } }, [shot, i < 9 ? kbd(i + 1, selected) : null]); }));
  }

  function courtDiagram(opts) {
    opts = opts || {};
    var margin = .55, width = 6.1 + margin * 2, height = 13.4 + margin * 2, svg = svgEl("svg", { viewBox: "0 0 " + width + " " + height, width: opts.renderWidth || 200, height: (opts.renderWidth || 200) * height / width, class: "bv-court", role: "img", "aria-label": opts.ariaLabel || "Canonical badminton court" });
    var X = function (x) { return x + margin; }, Y = function (y) { return y + margin; };
    svg.appendChild(svgEl("rect", { x: 0, y: 0, width: width, height: height, fill: "var(--court-fill-alt)" }));
    svg.appendChild(svgEl("rect", { x: X(0), y: Y(0), width: 6.1, height: 13.4, fill: "var(--court-fill)" }));
    function line(x1, y1, x2, y2, opacity) { svg.appendChild(svgEl("line", { x1: X(x1), y1: Y(y1), x2: X(x2), y2: Y(y2), stroke: "var(--court-line)", "stroke-width": .04, "stroke-linecap": "square", opacity: opacity == null ? 1 : opacity })); }
    line(0, 0, 6.1, 0); line(0, 13.4, 6.1, 13.4); line(0, 0, 0, 13.4); line(6.1, 0, 6.1, 13.4); line(.46, 0, .46, 13.4, .75); line(5.64, 0, 5.64, 13.4, .75); line(0, 4.72, 6.1, 4.72, .75); line(0, 8.68, 6.1, 8.68, .75); line(0, .76, 6.1, .76, .55); line(0, 12.64, 6.1, 12.64, .55); line(3.05, 0, 3.05, 4.72, .75); line(3.05, 8.68, 3.05, 13.4, .75);
    svg.appendChild(svgEl("line", { x1: X(-.28), y1: Y(6.7), x2: X(6.38), y2: Y(6.7), stroke: "var(--court-net)", "stroke-width": .07 }));
    if (opts.trajectory && opts.trajectory.length > 1) svg.appendChild(svgEl("polyline", { points: opts.trajectory.map(function (p) { return X(p.x) + "," + Y(p.y); }).join(" "), fill: "none", stroke: "var(--lime-500)", "stroke-width": .06, "stroke-linecap": "round", "stroke-dasharray": ".22 .16" }));
    if (opts.landing) { var landingColor = opts.call === "IN" ? "var(--signal-in)" : opts.call === "OUT" ? "var(--signal-out)" : "var(--signal-unknown)"; svg.appendChild(svgEl("circle", { cx: X(opts.landing.x), cy: Y(opts.landing.y), r: .34, fill: "none", stroke: landingColor, "stroke-width": .05, opacity: .55 })); svg.appendChild(svgEl("circle", { cx: X(opts.landing.x), cy: Y(opts.landing.y), r: .14, fill: landingColor })); }
    (opts.landings || []).forEach(function (p) { var color = opts.colorBy === "player" ? p.side === "b" ? "var(--player-b)" : "var(--player-a)" : p.call === "IN" ? "var(--signal-in)" : p.call === "OUT" ? "var(--signal-out)" : "var(--signal-unknown)"; svg.appendChild(svgEl("circle", { cx: X(p.x), cy: Y(p.y), r: .13, fill: p.call === "UNKNOWN" ? "transparent" : color, stroke: p.call === "UNKNOWN" ? color : "none", "stroke-width": .045, "stroke-dasharray": p.call === "UNKNOWN" ? ".09 .07" : "none", "fill-opacity": .72 })); });
    (opts.players || []).forEach(function (p) { var color = p.side === "b" ? "var(--player-b)" : "var(--player-a)"; svg.appendChild(svgEl("circle", { cx: X(p.x), cy: Y(p.y), r: .36, fill: color, opacity: .22 })); svg.appendChild(svgEl("circle", { cx: X(p.x), cy: Y(p.y), r: .19, fill: color })); });
    if (opts.labels) { var text = svgEl("text", { x: X(3.05), y: Y(-.16), "text-anchor": "middle", fill: "var(--text-faint)", "font-size": ".34", "font-family": "var(--font-mono)" }); text.textContent = "6.10 m"; svg.appendChild(text); }
    return svg;
  }

  function legend(items) { return el("div", { className: "bv-legend" }, items.map(function (item) { return el("span", { className: "bv-legend-item" }, [el("i", { className: "bv-legend-dot" + (item.dashed ? " dashed" : ""), style: item.dashed ? null : { background: item.color } }), item.label, item.value == null ? null : el("b", {}, [item.value])]); })); }

  function rallyRow(rally, rank, onReview) {
    return el("div", { className: "bv-rally-row" }, [el("span", { className: "bv-rally-rank" }, [rank]), el("span", { className: "bv-rally-index-wrap" }, [el("span", { className: "bv-rally-index" }, [rally.index == null ? "—" : rally.index]), rally.partial ? el("span", { className: "bv-mono", style: { color: "var(--signal-warn)", fontSize: "var(--fs-10)" } }, ["*"]) : null]), el("span", { className: "bv-rally-copy" }, [el("strong", {}, ["Rally " + rally.rallyId]), el("span", { className: "bv-rally-meta" }, [rally.shots + " shots · " + rally.duration])]), badge(rally.outcome, rally.outcome === "winner" ? "in" : rally.outcome === "forced error" ? "warn" : rally.outcome === "unforced error" ? "out" : "unknown"), el("button", { className: "bv-review", type: "button", onClick: function () { onReview(rally); } }, [rally.timestamp])]);
  }

  function emptyState(title, body, action, iconName) { return el("div", { className: "bv-empty" }, [el("span", { className: "bv-empty-icon" }, [icon(iconName || "info", 20)]), el("strong", {}, [title]), el("p", {}, [body]), action]); }

  function infoTip(term, body) {
    var wrapper = el("span", { style: { position: "relative", display: "inline-flex" } });
    var trigger = iconButton("help", term ? "What is " + term + "?" : "More information", { size: "sm" });
    var tooltip = el("span", { role: "tooltip", style: { display: "none", position: "absolute", zIndex: 40, width: "244px", left: "50%", bottom: "calc(100% + 8px)", transform: "translateX(-50%)", padding: "9px 11px", borderRadius: "var(--radius-md)", background: "var(--ink-800)", border: "1px solid var(--border-subtle)", boxShadow: "var(--shadow-raised)", textAlign: "left" } }, [term ? el("strong", { className: "bv-label", style: { color: "var(--lime-500)" } }, [term]) : null, el("span", { style: { display: "block", marginTop: "4px", font: "var(--type-ui-sm)", fontSize: "var(--fs-12)", color: "var(--text-body)" } }, [body])]);
    function setOpen(open) { tooltip.style.display = open ? "block" : "none"; }
    trigger.addEventListener("mouseenter", function () { setOpen(true); }); trigger.addEventListener("mouseleave", function () { setOpen(false); }); trigger.addEventListener("focus", function () { setOpen(true); }); trigger.addEventListener("blur", function () { setOpen(false); }); trigger.addEventListener("click", function () { setOpen(tooltip.style.display === "none"); }); wrapper.appendChild(trigger); wrapper.appendChild(tooltip); return wrapper;
  }

  root.BVUI = { el: el, icon: icon, button: button, iconButton: iconButton, badge: badge, kbd: kbd, confidence: confidence, statusChip: statusChip, panel: panel, callout: callout, stepDots: stepDots, segmented: segmented, toggle: toggle, chip: chip, stat: stat, mixBar: mixBar, strokeFeedItem: strokeFeedItem, suggestionRow: suggestionRow, dimensionAxis: dimensionAxis, shotPicker: shotPicker, courtDiagram: courtDiagram, legend: legend, rallyRow: rallyRow, emptyState: emptyState, infoTip: infoTip };
})(typeof globalThis !== "undefined" ? globalThis : window);

import React from "react";

const PASCAL = (n) => String(n).replace(/(^|[-_ ])(\w)/g, (_, __, c) => c.toUpperCase());

/** Lucide wrapper. Lucide is loaded from CDN (see readme ICONOGRAPHY); this component
 *  reads the icon node spec off `window.lucide.icons` and renders it as a real React <svg>. */
export function Icon({ name, size = 16, strokeWidth = 1.75, color = "currentColor", style, ...rest }) {
  const lib = typeof window !== "undefined" && window.lucide && window.lucide.icons;
  let spec = lib && (lib[PASCAL(name)] || lib[name]);
  if (spec && spec[0] === "svg") spec = spec[2];
  const children = Array.isArray(spec)
    ? spec.map((node, i) => {
        const [tag, attrs] = Array.isArray(node) ? node : ["path", node];
        return React.createElement(tag, { ...attrs, key: i });
      })
    : [React.createElement("circle", { key: "f", cx: 12, cy: 12, r: 4 })];
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block", flex: "0 0 auto", ...style }}
      {...rest}
    >
      {children}
    </svg>
  );
}

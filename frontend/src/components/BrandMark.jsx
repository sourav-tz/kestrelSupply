import React from "react";
import { statusBadgeClass, formatLabel } from "../utils/format";

export function BrandMark({ size = 34 }) {
  return (
    <img
      src="/icon.png"
      alt="Kestrel"
      width={size}
      height={size}
      style={{
        width: size,
        height: size,
        borderRadius: Math.max(7, Math.round(size * 0.24)),
        objectFit: "cover",
        display: "block",
        border: "1px solid rgba(247, 243, 234, 0.2)",
        boxShadow: "0 2px 8px rgba(15, 22, 18, 0.22)",
        flexShrink: 0,
      }}
    />
  );
}

export function StatusBadge({ value, prefix }) {
  return (
    <span className={statusBadgeClass(value)}>
      {prefix ? `${prefix}: ` : ""}
      {formatLabel(value)}
    </span>
  );
}

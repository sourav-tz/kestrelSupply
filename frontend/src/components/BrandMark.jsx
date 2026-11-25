import React from "react";
import { statusBadgeClass, formatLabel } from "../utils/format";

export function BrandMark({ size = 32, inverted = false }) {
  const stroke = inverted ? "#F7F3EA" : "#1E2722";
  const accent = "#CC4F23";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="2" y="2" width="32" height="32" rx="7" stroke={stroke} strokeWidth="1.8" />
      <path d="M10 26L18 10L26 26" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.5 20.5H22.5" stroke={accent} strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="18" cy="10" r="2" fill={accent} />
    </svg>
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

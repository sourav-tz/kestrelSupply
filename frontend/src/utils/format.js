export function formatINR(amount) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatDateTime(isoString) {
  if (!isoString) return "Pending";
  const d = new Date(isoString);
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatShortDate(isoString) {
  if (!isoString) return "Pending";
  const d = new Date(isoString);
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatLabel(raw) {
  return raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function statusBadgeClass(status) {
  const s = status.toLowerCase();
  if (["resolved", "processed", "approved", "delivered"].includes(s)) {
    return "badge badge-pine";
  }
  if (["escalated", "pending_review", "pending", "more_info_requested", "awaiting_customer", "high", "urgent"].includes(s)) {
    return "badge badge-ochre";
  }
  if (["rejected", "closed"].includes(s)) {
    return "badge badge-crimson";
  }
  if (["open", "shipped"].includes(s)) {
    return "badge badge-copper";
  }
  return "badge badge-slate";
}

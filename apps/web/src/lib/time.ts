export const relTime = (ts: number): string => {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
};

export const statusLabel = (status: string): string =>
  status === "running"
    ? "Running"
    : status === "done"
      ? "Done"
      : status === "error"
        ? "Error"
        : "Stopped";

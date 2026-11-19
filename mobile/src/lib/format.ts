// Money is stored in paisa (1 taka = 100 paisa). Screens show taka.
export function tk(paisa: number | string | null | undefined) {
  const n = Number(paisa || 0) / 100;
  const s = n.toLocaleString('en-IN', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  return `৳${s}`;
}

export function toDate(v: string | number | Date | null | undefined) {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function timeAgo(v: string | number | Date | null | undefined) {
  const d = toDate(v);
  if (!d) return '';
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function dateTime(v: string | number | Date | null | undefined) {
  const d = toDate(v);
  if (!d) return '';
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function clock(v: string | number | Date | null | undefined) {
  const d = toDate(v);
  if (!d) return '';
  return d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' });
}

export function initials(name: string) {
  return (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

export const pct = (n: number | null | undefined) => (n == null ? '' : `${Math.round(Number(n) * 100)}%`);

export const titleCase = (s: string) => (s || '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

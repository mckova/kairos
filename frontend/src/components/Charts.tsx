/** Small dependency-free SVG charts. */
import { fmtDate } from "../util";

export function LineChart({ series, height = 220 }: { series: { date: string; ideal: number; remaining?: number }[]; height?: number }) {
  const W = 640, H = height, P = { l: 36, r: 24, t: 12, b: 26 };
  if (!series.length) return null;
  const max = Math.max(1, ...series.map((p) => Math.max(p.ideal, p.remaining ?? 0)));
  const x = (i: number) => P.l + (i / Math.max(series.length - 1, 1)) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - v / max) * (H - P.t - P.b);
  const ideal = series.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.ideal)}`).join("");
  const actualPts = series.map((p, i) => [i, p.remaining] as const).filter(([, v]) => v !== undefined) as [number, number][];
  const actual = actualPts.map(([i, v], k) => `${k ? "L" : "M"}${x(i)},${y(v)}`).join("");
  const area = actualPts.length ? `${actual}L${x(actualPts[actualPts.length - 1][0])},${y(0)}L${x(0)},${y(0)}Z` : "";
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));
  const step = Math.ceil(series.length / 7);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Burndown chart">
      {ticks.map((t) => <g key={t}><line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} className="grid" /><text x={P.l - 6} y={y(t) + 4} textAnchor="end" className="axis">{t}</text></g>)}
      {series.map((p, i) => i % step === 0 && <text key={p.date} x={x(i)} y={H - 6} textAnchor="middle" className="axis">{fmtDate(p.date)}</text>)}
      <path d={area} className="area" />
      <path d={ideal} className="ideal" />
      <path d={actual} className="actual" />
      {actualPts.map(([i, v]) => <circle key={i} cx={x(i)} cy={y(v)} r={3} className="dot"><title>{`${fmtDate(series[i].date)}: ${v} pts left`}</title></circle>)}
    </svg>
  );
}

export function Bars({ data, height = 160 }: { data: { label: string; value: number }[]; height?: number }) {
  const W = 640, H = height, P = { l: 28, r: 8, t: 14, b: 22 };
  const max = Math.max(1, ...data.map((d) => d.value));
  const bw = (W - P.l - P.r) / data.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Bar chart">
      <line x1={P.l} x2={W - P.r} y1={H - P.b} y2={H - P.b} className="grid" />
      {data.map((d, i) => {
        const h = (d.value / max) * (H - P.t - P.b);
        return (
          <g key={i}>
            <rect x={P.l + i * bw + bw * 0.22} y={H - P.b - Math.max(h, 1)} width={bw * 0.56} height={Math.max(h, 1)} className={`bar-rect${d.value ? "" : " zero"}`}><title>{`${d.label}: ${d.value}`}</title></rect>
            <text x={P.l + i * bw + bw / 2} y={H - P.b - h - 4} textAnchor="middle" className="axis">{d.value || ""}</text>
            <text x={P.l + i * bw + bw / 2} y={H - 6} textAnchor="middle" className="axis">{d.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function Gauge({ value, label }: { value: number | null; label: string }) {
  const v = value ?? 0, r = 52, c = 2 * Math.PI * r;
  const color = value == null ? "var(--muted)" : v >= 0.7 ? "var(--ok)" : v >= 0.4 ? "var(--warn)" : "var(--bad)";
  return (
    <svg viewBox="0 0 140 140" className="gauge" role="img" aria-label={label}>
      <circle cx="70" cy="70" r={r} className="gauge-track" />
      <circle cx="70" cy="70" r={r} stroke={color} className="gauge-val" strokeDasharray={`${c * v} ${c}`} transform="rotate(-90 70 70)" />
      <text x="70" y="70" textAnchor="middle" className="gauge-num" fill={color}>{value == null ? "n/a" : `${Math.round(v * 100)}%`}</text>
      <text x="70" y="92" textAnchor="middle" className="axis">{label}</text>
    </svg>
  );
}

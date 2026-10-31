/** Small dependency-free SVG charts: thin marks, a recessive grid, a label where it helps and a tooltip for the rest. */
import { useLayoutEffect, useRef, useState } from "react";
import { fmtDate } from "../util";

const DAY = 864e5;
const t = (d: string) => new Date(d + "T00:00:00").getTime();

/** Hover state for a chart: which x the pointer is over, and where to put the tooltip. */
function useHover<T>() {
  const [hover, setHover] = useState<{ item: T; x: number; y: number } | null>(null);
  return { hover, setHover };
}

/** Draw at the container's real width so text and strokes stay at their true size. */
function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function Tip({ at, children }: { at: { x: number; y: number }; children: React.ReactNode }) {
  return <div className="chart-tip" role="status" style={{ left: `${at.x}%`, top: `${at.y}%` }}>{children}</div>;
}

interface Point { date: string; ideal: number; remaining?: number }
interface Projection { p50: string | null; p85: string | null; deadline: string | null }

/** Points remaining per day, the plan, and the simulated finish projected past today. */
export function Burndown({ series, forecast, height = 230 }: { series: Point[]; forecast?: Projection | null; height?: number }) {
  const [box, W] = useWidth(760);
  const H = height, P = { l: 28, r: 24, t: 18, b: 28 };
  const ref = useRef<SVGSVGElement>(null);
  const { hover, setHover } = useHover<number>();
  if (!series.length) return null;
  const actual = series.map((p, i) => [i, p.remaining] as const).filter(([, v]) => v !== undefined) as [number, number][];
  const t0 = t(series[0].date);
  const end = forecast?.deadline ?? series[series.length - 1].date;
  const last = Math.max(t(series[series.length - 1].date), forecast?.p85 ? t(forecast.p85) : 0, t(end));
  const max = Math.max(1, ...series.map((p) => Math.max(p.ideal, p.remaining ?? 0)));
  const x = (ms: number) => P.l + ((ms - t0) / Math.max(last - t0, DAY)) * (W - P.l - P.r);
  const xd = (d: string) => x(t(d));
  const y = (v: number) => P.t + (1 - v / max) * (H - P.t - P.b);
  const base = y(0);
  const line = (pts: [number, number][]) => pts.map(([px, py], k) => `${k ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join("");
  const actualPts = actual.map(([i, v]) => [xd(series[i].date), y(v)] as [number, number]);
  const plan = line([[xd(series[0].date), y(series[0].ideal)], [xd(end), base]]);
  const tail = actual.length ? actualPts[actualPts.length - 1] : null;
  const tailV = actual.length ? actual[actual.length - 1][1] : 0;
  const ticks = [0, Math.round(max / 2), max];
  const marks = [
    { d: series[0].date, label: fmtDate(series[0].date), anchor: "start" as const },
    { d: end, label: fmtDate(end), anchor: "middle" as const },
    ...(forecast?.p50 ? [{ d: forecast.p50, label: fmtDate(forecast.p50), anchor: "middle" as const }] : []),
    ...(forecast?.p85 && forecast.p85 !== forecast.p50 ? [{ d: forecast.p85, label: fmtDate(forecast.p85), anchor: "end" as const }] : []),
  ];
  // Drop an x label that would collide with the one before it.
  const shown = marks.filter((m, i) => i === 0 || Math.abs(xd(m.d) - xd(marks[i - 1].d)) > 46);

  const move = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    series.forEach((p, i) => { if (Math.abs(xd(p.date) - vx) < Math.abs(xd(series[best].date) - vx)) best = i; });
    const p = series[best];
    setHover({ item: best, x: (xd(p.date) / W) * 100, y: (y(p.remaining ?? p.ideal) / (H)) * 100 });
  };
  const hp = hover ? series[hover.item] : null;

  return (
    <div className="chart-wrap" ref={box}>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="chart" role="img" onPointerMove={move} onPointerLeave={() => setHover(null)}
        aria-label={`Burndown: ${tailV} points left${forecast?.p50 ? `, likely finish ${fmtDate(forecast.p50)}` : ""}`}>
        <defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" className="hatch-line" opacity=".45" /></pattern></defs>
        {ticks.map((v) => <g key={v}><line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} className={v ? "grid" : "baseline"} /><text x={P.l - 8} y={y(v) + 4} textAnchor="end" className="axis">{v}</text></g>)}
        <line x1={xd(end)} x2={xd(end)} y1={P.t - 6} y2={base} className="deadline" />
        {tail && forecast?.p50 && forecast.p85 && <path d={`M${tail[0]},${tail[1]}L${xd(forecast.p85)},${base}L${xd(forecast.p50)},${base}Z`} className="band" />}
        <path d={plan} className="plan" />
        {tail && forecast?.p50 && <path d={line([tail, [xd(forecast.p50), base]])} className="projection" />}
        <path d={line(actualPts)} className="actual" />
        {tail && <><circle cx={tail[0]} cy={tail[1]} r={4} className="end" /><text x={tail[0] + 9} y={tail[1] - 8} className="direct">{tailV} left</text></>}
        <text x={xd(end)} y={P.t - 8} textAnchor="middle" className="note">Sprint ends</text>
        {forecast?.p50 && <text x={xd(forecast.p50)} y={base - 14} textAnchor="middle" className="note">50%</text>}
        {forecast?.p85 && forecast.p85 !== forecast.p50 && <text x={xd(forecast.p85)} y={base - 14} textAnchor="end" className="note">85%</text>}
        {shown.map((m) => <text key={m.label} x={xd(m.d)} y={H - 8} textAnchor={m.anchor} className="axis">{m.label}</text>)}
        {hp && <line x1={xd(hp.date)} x2={xd(hp.date)} y1={P.t} y2={base} className="cross" />}
      </svg>
      {hp && hover && (
        <Tip at={hover}><b>{fmtDate(hp.date)}</b>{hp.remaining !== undefined ? <span>{hp.remaining} pts left</span> : <span>Not reached yet</span>}<span className="faint">Plan {Math.round(hp.ideal)} pts</span></Tip>
      )}
    </div>
  );
}

/** One thin column per week; the latest week carries its value, the rest show on hover. */
export function WeekBars({ data, height = 150 }: { data: { label: string; value: number }[]; height?: number }) {
  const [box, W] = useWidth(480);
  const H = height, P = { l: 4, r: 4, t: 22, b: 24 };
  const { hover, setHover } = useHover<number>();
  const max = Math.max(1, ...data.map((d) => d.value));
  const band = (W - P.l - P.r) / Math.max(data.length, 1);
  const bw = Math.min(22, band * 0.45);
  const base = H - P.b;
  const col = (i: number, v: number) => {
    const h = Math.max((v / max) * (H - P.t - P.b), v ? 4 : 0), x0 = P.l + i * band + (band - bw) / 2, r = Math.min(4, h, bw / 2);
    return `M${x0},${base}V${base - h + r}Q${x0},${base - h} ${x0 + r},${base - h}H${x0 + bw - r}Q${x0 + bw},${base - h} ${x0 + bw},${base - h + r}V${base}Z`;
  };
  const li = data.length - 1;
  return (
    <div className="chart-wrap" ref={box}>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={`Points completed per week: ${data.map((d) => `${d.label} ${d.value}`).join(", ")}`} onPointerLeave={() => setHover(null)}>
        <defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" className="hatch-line" opacity=".45" /></pattern></defs>
        <line x1={P.l} x2={W - P.r} y1={base} y2={base} className="baseline" />
        {data.map((d, i) => (
          <g key={d.label}>
            <path d={col(i, d.value)} className={`col${i === li ? " now" : ""}${hover?.item === i ? " on" : ""}`} />
            <rect x={P.l + i * band} y={P.t - 10} width={band} height={base - P.t + 10} fill="transparent" onPointerEnter={() => setHover({ item: i, x: ((P.l + i * band + band / 2) / W) * 100, y: ((base - (d.value / max) * (H - P.t - P.b)) / H) * 100 })} />
            <text x={P.l + i * band + band / 2} y={H - 8} textAnchor="middle" className="axis">{d.label}</text>
          </g>
        ))}
        {li >= 0 && hover?.item !== li && <text x={P.l + li * band + band / 2} y={base - (data[li].value / max) * (H - P.t - P.b) - 8} textAnchor="middle" className="direct">{data[li].value}</text>}
      </svg>
      {hover && <Tip at={hover}><b>Week to {data[hover.item].label}</b><span>{data[hover.item].value} pts done</span></Tip>}
    </div>
  );
}

/** A part-to-whole bar: segments with a 2 px gap, and a legend that carries every count. */
export function Composition({ parts, label }: { parts: { key: string; label: string; value: number; color: string }[]; label: string }) {
  const total = parts.reduce((n, p) => n + p.value, 0);
  const shown = parts.filter((p) => p.value > 0);
  return (
    <div className="composition">
      <div className="comp-bar" role="img" aria-label={`${label}: ${parts.map((p) => `${p.label} ${p.value}`).join(", ")}`}>
        {shown.map((p) => <i key={p.key} className={p.color === "hatch" ? "hatched" : ""} title={`${p.label}: ${p.value}`} style={{ flexGrow: p.value, background: p.color === "hatch" ? undefined : p.color }} />)}
        {!total && <i style={{ flexGrow: 1 }} />}
      </div>
      <ul className="comp-legend">
        {parts.map((p) => <li key={p.key} className={p.value ? "" : "zero"}><i className={p.color === "hatch" ? "hatched" : ""} style={{ background: p.color === "hatch" ? undefined : p.color }} />{p.label}<b>{p.value}</b></li>)}
      </ul>
    </div>
  );
}

/** Load against capacity: the part within capacity in Harbor, anything past it in coral, a tick at 100%. */
export function Capacity({ load, capacity }: { load: number; capacity: number }) {
  const scale = Math.max(capacity * 1.5, load, 1);
  const within = Math.min(load, capacity), over = Math.max(0, load - capacity);
  return (
    <div className="cap" role="img" aria-label={`${load} of ${capacity} points${over ? `, ${Math.round(over * 10) / 10} over` : ""}`}>
      <i className="in" style={{ width: `${(within / scale) * 100}%` }} />
      {over > 0 && <i className="over" style={{ left: `calc(${(capacity / scale) * 100}% + 2px)`, width: `calc(${(over / scale) * 100}% - 2px)` }} />}
      <b style={{ left: `${(capacity / scale) * 100}%` }} />
    </div>
  );
}

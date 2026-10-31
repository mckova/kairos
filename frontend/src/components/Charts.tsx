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

/** Points remaining, one thin line per day: solid for days that happened, faded for the projection to the likely finish. */
export function Burndown({ series, forecast, height = 230 }: { series: Point[]; forecast?: Projection | null; height?: number }) {
  const [box, W] = useWidth(760);
  const H = height, P = { l: 8, r: 12, t: 22, b: 30 };
  const ref = useRef<SVGSVGElement>(null);
  const { hover, setHover } = useHover<number>();
  if (!series.length) return null;
  const t0 = t(series[0].date);
  const end = forecast?.deadline ?? series[series.length - 1].date;
  const actual = series.filter((p) => p.remaining !== undefined);
  const tail = actual.length ? actual[actual.length - 1] : null;
  const todayMs = tail ? t(tail.date) : t0;
  const finish = forecast?.p50 ? t(forecast.p50) : t(end);
  const last = Math.max(t(series[series.length - 1].date), t(end), finish);
  const days = Math.max(1, Math.round((last - t0) / DAY) + 1);
  const max = Math.max(1, ...series.map((p) => Math.max(p.ideal, p.remaining ?? 0)));
  const step = (W - P.l - P.r) / days;
  const bw = Math.max(2, Math.min(4, step * 0.5));
  const base = H - P.b, top = P.t;
  const hOf = (v: number) => Math.max(0, (v / max) * (base - top));
  const byDay = new Map(series.map((p) => [Math.round((t(p.date) - t0) / DAY), p]));
  const tailV = tail?.remaining ?? 0;
  const bars = Array.from({ length: days }, (_, i) => {
    const p = byDay.get(i);
    if (p && p.remaining !== undefined) return { i, v: p.remaining, real: true, date: p.date };
    const todayI0 = Math.round((todayMs - t0) / DAY);
    if (tail && i <= todayI0) {
      let j = i; while (j >= 0 && byDay.get(j)?.remaining === undefined) j--;
      return { i, v: j >= 0 ? byDay.get(j)!.remaining! : tailV, real: true, date: "" };
    }
    const todayI = Math.round((todayMs - t0) / DAY), finI = Math.max(todayI + 1, Math.round((finish - t0) / DAY));
    if (!tail || i <= todayI) return { i, v: p ? p.ideal : 0, real: false, date: p?.date ?? "" };
    return { i, v: Math.max(0, tailV * (1 - (i - todayI) / (finI - todayI))), real: false, date: "" };
  });
  const xi = (i: number) => P.l + i * step + step / 2;
  const todayI = Math.round((todayMs - t0) / DAY);
  const endI = Math.round((t(end) - t0) / DAY);
  const planNow = series.find((p) => p.date === tail?.date)?.ideal ?? 0;
  const behind = !!tail && tailV > planNow + 0.5;
  const dayLabel = (i: number) => fmtDate(new Date(t0 + i * DAY).toISOString().slice(0, 10));
  const labelIdx = Array.from(new Set([0, Math.round(days * 0.25), Math.round(days * 0.5), Math.round(days * 0.75), days - 1])).filter((i, k, a) => k === 0 || xi(i) - xi(a[k - 1]) > 56);

  const move = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * W;
    const i = Math.min(days - 1, Math.max(0, Math.floor((vx - P.l) / step)));
    setHover({ item: i, x: (xi(i) / W) * 100, y: ((base - hOf(bars[i].v)) / H) * 100 });
  };
  const hb = hover ? bars[hover.item] : null;

  return (
    <div className="chart-wrap" ref={box}>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="chart burn" role="img" onPointerMove={move} onPointerLeave={() => setHover(null)}
        aria-label={`Burndown: ${tailV} points left${forecast?.p50 ? `, likely finish ${fmtDate(forecast.p50)}` : ""}`}>
        <line x1={P.l} x2={W - P.r} y1={base} y2={base} className="baseline" />
        {bars.map((b) => {
          const h = hOf(b.v);
          return <rect key={b.i} x={xi(b.i) - bw / 2} y={base - h} width={bw} height={Math.max(h, b.v > 0 ? 2 : 0)} rx={bw / 2} className={`day${b.real ? "" : " ahead"}${hover?.item === b.i ? " on" : ""}`} />;
        })}
        {endI < days && <line x1={xi(endI)} x2={xi(endI)} y1={base - 56} y2={base} className="deadline" />}
        {endI < days && <text x={xi(endI)} y={base - 62} textAnchor="middle" className="note">Sprint ends</text>}
        {tail && <><line x1={xi(todayI)} x2={xi(todayI)} y1={top - 8} y2={base} className="today" /><circle cx={xi(todayI)} cy={base - hOf(tailV)} r={5} className="end" />
          <text x={xi(todayI) + 10} y={top + 4} className="late-note">{behind ? "Behind plan" : "On plan"}</text></>}
        {forecast?.p50 && <text x={Math.min(W - P.r, xi(Math.round((finish - t0) / DAY)))} y={base - 10} textAnchor="end" className="late-note">{fmtDate(forecast.p50)} likely</text>}
        {labelIdx.map((i, k) => <text key={i} x={xi(i)} y={H - 8} textAnchor={k === 0 ? "start" : i === days - 1 ? "end" : "middle"} className="axis">{dayLabel(i)}</text>)}
      </svg>
      {hb && hover && (
        <Tip at={hover}><b>{dayLabel(hb.i)}</b><span>{Math.round(hb.v * 10) / 10} pts {hb.real ? "left" : "projected"}</span></Tip>
      )}
    </div>
  );
}

/** Weekly output as rounded tiles: hatched, the latest week solid, a low week in coral. The value sits inside the tile. */
export function WeekBars({ data }: { data: { label: string; value: number }[]; height?: number }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const avg = data.reduce((n, d) => n + d.value, 0) / Math.max(data.length, 1);
  return (
    <div className="weeks" role="img" aria-label={`Points completed per week: ${data.map((d) => `${d.label} ${d.value}`).join(", ")}`}>
      {data.map((d, i) => {
        const latest = i === data.length - 1, low = !latest && d.value < avg * 0.6;
        return (
          <div key={d.label} className="week">
            <div className={`tile${latest ? " now" : ""}${low ? " low" : ""}`} style={{ height: `${Math.max(18, (d.value / max) * 100)}%` }} title={`Week to ${d.label}: ${d.value} pts`}><b>{d.value}</b></div>
            <span>{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Part-to-whole as a segmented ring with the total in the middle, and a legend that carries every count. */
export function Composition({ parts, label, centre }: { parts: { key: string; label: string; value: number; color: string }[]; label: string; centre?: string }) {
  const total = parts.reduce((n, p) => n + p.value, 0);
  const R = 62, C = 2 * Math.PI * R;
  let off = 0;
  return (
    <div className="composition">
      <svg viewBox="0 0 160 160" className="ring" role="img" aria-label={`${label}: ${parts.map((p) => `${p.label} ${p.value}`).join(", ")}`}>
        <defs><pattern id="ring-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" className="hatch-line" /></pattern></defs>
        <circle r={R} cx="80" cy="80" className="ring-track" />
        {parts.filter((p) => p.value > 0).map((p) => {
          const len = (p.value / Math.max(total, 1)) * C, gap = Math.min(5, len * 0.4);
          const el = <circle key={p.key} r={R} cx="80" cy="80" fill="none" strokeWidth="20" stroke={p.color === "hatch" ? "url(#ring-hatch)" : p.color} strokeDasharray={`${Math.max(len - gap, 0.5)} ${C - len + gap}`} strokeDashoffset={-off} transform="rotate(-90 80 80)"><title>{`${p.label}: ${p.value}`}</title></circle>;
          off += len; return el;
        })}
        <text x="80" y="79" textAnchor="middle" className="ring-n">{total}</text>
        <text x="80" y="98" textAnchor="middle" className="axis">{centre ?? "tasks"}</text>
      </svg>
      <ul className="comp-legend">
        {parts.map((p) => <li key={p.key} className={p.value ? "" : "zero"}><i className={p.color === "hatch" ? "hatched" : ""} style={{ background: p.color === "hatch" ? undefined : p.color }} />{p.label}<b>{p.value}</b></li>)}
      </ul>
    </div>
  );
}

/** Load against capacity as a row of ticks, three per point: Harbor within capacity, coral past it, faint for what is left. */
export function Capacity({ load, capacity }: { load: number; capacity: number }) {
  const total = Math.max(Math.round(Math.max(load, capacity) * 3), 3);
  const over = load > capacity;
  return (
    <div className="ticks" role="img" aria-label={`${load} of ${capacity} points${over ? `, ${Math.round((load - capacity) * 10) / 10} over` : ""}`}>
      {Array.from({ length: total }, (_, i) => {
        const v = i / 3, filled = v < load, past = filled && v >= capacity;
        return <i key={i} className={past ? "over" : filled ? "in" : ""} />;
      })}
    </div>
  );
}

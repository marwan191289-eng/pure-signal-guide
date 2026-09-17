import { useMemo } from "react";
import type { Candle } from "@/lib/deriv";
import { ema } from "@/lib/indicators";

type Props = {
  candles: Candle[];
  direction: "buy" | "sell" | "neutral";
};

export function PriceChart({ candles, direction }: Props) {
  const view = useMemo(() => {
    const data = candles.slice(-120);
    if (data.length < 5) return null;
    const closes = data.map((c) => c.close);
    const e21 = ema(
      candles.map((c) => c.close),
      21,
    ).slice(-data.length);
    const lows = data.map((c) => c.low);
    const highs = data.map((c) => c.high);
    const min = Math.min(...lows);
    const max = Math.max(...highs);
    const range = max - min || 1;
    const W = 1000;
    const H = 260;
    const x = (i: number) => (i / (data.length - 1)) * W;
    const y = (v: number) => H - ((v - min) / range) * H;
    const path = closes
      .map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
      .join(" ");
    const area = `${path} L${W},${H} L0,${H} Z`;
    const emaPath = e21
      .map((v, i) => (Number.isNaN(v) ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`))
      .filter(Boolean)
      .join(" L");
    return { path, area, emaPath: emaPath ? `M${emaPath}` : "", W, H, min, max };
  }, [candles]);

  if (!view) {
    return <div className="h-[260px] animate-pulse rounded-xl bg-muted/40" />;
  }

  const stroke =
    direction === "buy"
      ? "var(--color-bull)"
      : direction === "sell"
        ? "var(--color-bear)"
        : "var(--color-muted-foreground)";

  return (
    <svg
      viewBox={`0 0 ${view.W} ${view.H}`}
      className="h-[260px] w-full"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((g) => (
        <line
          key={g}
          x1="0"
          x2={view.W}
          y1={view.H * g}
          y2={view.H * g}
          stroke="var(--color-border)"
          strokeWidth="1"
        />
      ))}
      <path d={view.area} fill="url(#fill)" />
      {view.emaPath && (
        <path
          d={view.emaPath}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="2"
          strokeDasharray="6 5"
          opacity="0.8"
        />
      )}
      <path d={view.path} fill="none" stroke={stroke} strokeWidth="2.5" strokeLinejoin="round" />
    </svg>
  );
}

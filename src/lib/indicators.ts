import type { Candle } from "./deriv";

export function sma(values: number[], period: number): number[] {
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    out.push(i >= period - 1 ? sum / period : NaN);
  }
  return out;
}

export function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = NaN;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (i === period - 1) {
      const seed = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
      prev = seed;
      out.push(seed);
    } else if (i < period - 1) {
      out.push(NaN);
    } else {
      prev = v * k + prev * (1 - k);
      out.push(prev);
    }
  }
  return out;
}

/** Wilder's RSI. */
export function rsi(values: number[], period = 14): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i]! - values[i - 1]!;
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i]! - values[i - 1]!;
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function atr(candles: Candle[], period = 14): number[] {
  const tr: number[] = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const p = candles[i - 1]!.close;
    return Math.max(c.high - c.low, Math.abs(c.high - p), Math.abs(c.low - p));
  });
  return ema(tr, period);
}

export type SignalDirection = "buy" | "sell" | "neutral";

export type Analysis = {
  price: number;
  ema9: number;
  ema21: number;
  ema50: number;
  rsi14: number;
  atr14: number;
  atrPct: number;
  momentumPct: number;
  direction: SignalDirection;
  strength: number; // 0..100
  reasons: { text: string; weight: number }[];
};

const last = (a: number[]) => a[a.length - 1] ?? NaN;

export function analyze(candles: Candle[]): Analysis | null {
  if (candles.length < 60) return null;
  const closes = candles.map((c) => c.close);
  const e9 = ema(closes, 9);
  const e21 = ema(closes, 21);
  const e50 = ema(closes, 50);
  const r = rsi(closes, 14);
  const a = atr(candles, 14);

  const price = last(closes)!;
  const ema9 = last(e9)!;
  const ema21 = last(e21)!;
  const ema50 = last(e50)!;
  const rsi14 = last(r)!;
  const atr14 = last(a)!;
  const momentumPct = ((price - closes[closes.length - 11]!) / closes[closes.length - 11]!) * 100;

  const reasons: { text: string; weight: number }[] = [];
  let score = 0;

  if (ema9 > ema21) {
    score += 25;
    reasons.push({ text: "المتوسط السريع (9) فوق المتوسط (21) — زخم صاعد", weight: 25 });
  } else {
    score -= 25;
    reasons.push({ text: "المتوسط السريع (9) تحت المتوسط (21) — زخم هابط", weight: -25 });
  }

  if (price > ema50) {
    score += 20;
    reasons.push({ text: "السعر فوق متوسط 50 — الاتجاه العام صاعد", weight: 20 });
  } else {
    score -= 20;
    reasons.push({ text: "السعر تحت متوسط 50 — الاتجاه العام هابط", weight: -20 });
  }

  if (rsi14 >= 70) {
    score -= 20;
    reasons.push({ text: `RSI = ${rsi14.toFixed(1)} — تشبع شرائي`, weight: -20 });
  } else if (rsi14 <= 30) {
    score += 20;
    reasons.push({ text: `RSI = ${rsi14.toFixed(1)} — تشبع بيعي`, weight: 20 });
  } else if (rsi14 > 55) {
    score += 10;
    reasons.push({ text: `RSI = ${rsi14.toFixed(1)} — ميل شرائي`, weight: 10 });
  } else if (rsi14 < 45) {
    score -= 10;
    reasons.push({ text: `RSI = ${rsi14.toFixed(1)} — ميل بيعي`, weight: -10 });
  } else {
    reasons.push({ text: `RSI = ${rsi14.toFixed(1)} — محايد`, weight: 0 });
  }

  if (Math.abs(momentumPct) > 0.02) {
    const w = momentumPct > 0 ? 15 : -15;
    score += w;
    reasons.push({
      text: `تغيّر آخر 10 شموع: ${momentumPct >= 0 ? "+" : ""}${momentumPct.toFixed(3)}%`,
      weight: w,
    });
  }

  const strength = Math.min(100, Math.round(Math.abs(score)));
  const direction: SignalDirection = strength < 30 ? "neutral" : score > 0 ? "buy" : "sell";

  return {
    price,
    ema9,
    ema21,
    ema50,
    rsi14,
    atr14,
    atrPct: (atr14 / price) * 100,
    momentumPct,
    direction,
    strength,
    reasons,
  };
}

export type SpikeStats = {
  kind: "boom" | "crash";
  spikeCount: number;
  candlesSinceLast: number;
  avgInterval: number;
  medianInterval: number;
  maxInterval: number;
  minInterval: number;
  /** Share of past intervals that were shorter than the current wait. */
  elapsedPercentile: number;
  avgSpikeSizePct: number;
  intervals: number[];
};

/**
 * Detects real spikes in the loaded candle history for Boom/Crash style indices.
 * A spike = a candle whose body is far larger than the typical body (>= 6x median).
 */
export function detectSpikes(candles: Candle[], kind: "boom" | "crash"): SpikeStats | null {
  if (candles.length < 100) return null;
  const bodies = candles.map((c) => c.close - c.open);
  const absSorted = bodies.map(Math.abs).sort((x, y) => x - y);
  const median = absSorted[Math.floor(absSorted.length / 2)] || 0;
  if (median <= 0) return null;
  const threshold = median * 6;

  const idx: number[] = [];
  const sizes: number[] = [];
  bodies.forEach((b, i) => {
    const matchesDirection = kind === "boom" ? b > 0 : b < 0;
    if (matchesDirection && Math.abs(b) >= threshold) {
      idx.push(i);
      sizes.push((Math.abs(b) / candles[i]!.open) * 100);
    }
  });
  if (idx.length < 3) return null;

  const intervals: number[] = [];
  for (let i = 1; i < idx.length; i++) intervals.push(idx[i]! - idx[i - 1]!);
  const sortedIv = [...intervals].sort((x, y) => x - y);
  const candlesSinceLast = candles.length - 1 - idx[idx.length - 1]!;
  const shorter = intervals.filter((v) => v <= candlesSinceLast).length;

  return {
    kind,
    spikeCount: idx.length,
    candlesSinceLast,
    avgInterval: intervals.reduce((a, b) => a + b, 0) / intervals.length,
    medianInterval: sortedIv[Math.floor(sortedIv.length / 2)]!,
    maxInterval: Math.max(...intervals),
    minInterval: Math.min(...intervals),
    elapsedPercentile: (shorter / intervals.length) * 100,
    avgSpikeSizePct: sizes.reduce((a, b) => a + b, 0) / sizes.length,
    intervals,
  };
}

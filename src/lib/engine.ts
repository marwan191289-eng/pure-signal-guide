/**
 * Technical engine: every value here is computed from real Deriv candles.
 * No synthetic prices, no placeholder numbers — if the history is too short
 * the engine returns null so the UI can stay honest about waiting.
 */
import type { Candle } from "./deriv";
import { atr as atrSeries, ema as emaSeries, rsi as rsiSeries, sma } from "./indicators";

export type Direction = "up" | "down" | "neutral";

export type TechSnapshot = {
  price: number;
  ema9: number;
  ema21: number;
  ema50: number;
  ema200: number | null;
  rsi14: number;
  stochK: number;
  stochD: number;
  macd: number;
  macdSignal: number;
  macdHist: number;
  macdHistSlope: number;
  bbUpper: number;
  bbMid: number;
  bbLower: number;
  bbWidthPct: number;
  bbPosition: number; // 0 = lower band, 1 = upper band
  adx: number;
  plusDI: number;
  minusDI: number;
  atr14: number;
  atrPct: number;
  momentumPct: number;
  zScore: number;
  efficiency: number; // 0..1 directional efficiency of the last 20 candles
  trendScore: number; // -100..100
  direction: Direction;
  strength: number; // 0..100
  drivers: { text: string; weight: number }[];
};

export type TradePlan = {
  direction: Exclude<Direction, "neutral">;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  riskRewardRatio: number;
  riskPct: number;
  rewardPct: number;
};

export type ConfluenceInput = { label: string; tech: TechSnapshot | null };

export type Confluence = {
  score: number; // -100..100
  direction: Direction;
  alignment: number; // 0..100 how much the timeframes agree
  rows: { label: string; direction: Direction; strength: number; available: boolean }[];
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const last = (values: number[]) => values[values.length - 1];
const finite = (v: number | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function stddev(values: number[]) {
  if (!values.length) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function macd(closes: number[], fast = 12, slow = 26, signal = 9) {
  const fastLine = emaSeries(closes, fast);
  const slowLine = emaSeries(closes, slow);
  const line = closes.map((_, i) => {
    const f = fastLine[i];
    const s = slowLine[i];
    return f != null && s != null && Number.isFinite(f) && Number.isFinite(s) ? f - s : NaN;
  });
  const clean = line.map((v) => (Number.isFinite(v) ? v : 0));
  const signalLine = emaSeries(clean, signal);
  return { line, signalLine };
}

function stochastic(candles: Candle[], period = 14, smoothing = 3) {
  const k: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) {
      k.push(NaN);
      continue;
    }
    const window = candles.slice(i - period + 1, i + 1);
    const high = Math.max(...window.map((c) => c.high));
    const low = Math.min(...window.map((c) => c.low));
    const close = candles[i]!.close;
    k.push(high === low ? 50 : ((close - low) / (high - low)) * 100);
  }
  const d = sma(
    k.map((v) => (Number.isFinite(v) ? v : 50)),
    smoothing,
  );
  return { k, d };
}

/** Wilder's ADX with +DI / -DI. */
function adx(candles: Candle[], period = 14) {
  if (candles.length <= period * 2) return { adx: NaN, plusDI: NaN, minusDI: NaN };
  let smoothTR = 0;
  let smoothPlus = 0;
  let smoothMinus = 0;
  const dx: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const current = candles[i]!;
    const previous = candles[i - 1]!;
    const upMove = current.high - previous.high;
    const downMove = previous.low - current.low;
    const plusDM = upMove > downMove && upMove > 0 ? upMove : 0;
    const minusDM = downMove > upMove && downMove > 0 ? downMove : 0;
    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close),
    );

    if (i <= period) {
      smoothTR += tr;
      smoothPlus += plusDM;
      smoothMinus += minusDM;
      if (i === period && smoothTR > 0) {
        const p = (smoothPlus / smoothTR) * 100;
        const m = (smoothMinus / smoothTR) * 100;
        dx.push(p + m === 0 ? 0 : (Math.abs(p - m) / (p + m)) * 100);
      }
      continue;
    }

    smoothTR = smoothTR - smoothTR / period + tr;
    smoothPlus = smoothPlus - smoothPlus / period + plusDM;
    smoothMinus = smoothMinus - smoothMinus / period + minusDM;
    if (smoothTR <= 0) continue;
    const p = (smoothPlus / smoothTR) * 100;
    const m = (smoothMinus / smoothTR) * 100;
    dx.push(p + m === 0 ? 0 : (Math.abs(p - m) / (p + m)) * 100);
  }

  const window = dx.slice(-period);
  const plusDI = smoothTR > 0 ? (smoothPlus / smoothTR) * 100 : NaN;
  const minusDI = smoothTR > 0 ? (smoothMinus / smoothTR) * 100 : NaN;
  return {
    adx: window.length ? window.reduce((a, b) => a + b, 0) / window.length : NaN,
    plusDI,
    minusDI,
  };
}

export function computeTech(candles: Candle[]): TechSnapshot | null {
  if (candles.length < 60) return null;
  const closes = candles.map((c) => c.close);
  const price = last(closes)!;
  if (!Number.isFinite(price) || price === 0) return null;

  const ema9 = finite(last(emaSeries(closes, 9)));
  const ema21 = finite(last(emaSeries(closes, 21)));
  const ema50 = finite(last(emaSeries(closes, 50)));
  const ema200 = candles.length >= 200 ? finite(last(emaSeries(closes, 200))) : null;
  const rsi14 = finite(last(rsiSeries(closes, 14))) ?? 50;
  const atr14 = finite(last(atrSeries(candles, 14))) ?? 0;
  if (ema9 == null || ema21 == null || ema50 == null || atr14 <= 0) return null;

  const { line, signalLine } = macd(closes);
  const macdValue = finite(last(line)) ?? 0;
  const macdSignal = finite(last(signalLine)) ?? 0;
  const macdHist = macdValue - macdSignal;
  const previousHist =
    (finite(line[line.length - 2]) ?? 0) - (finite(signalLine[signalLine.length - 2]) ?? 0);
  const macdHistSlope = macdHist - previousHist;

  const stoch = stochastic(candles);
  const stochK = finite(last(stoch.k)) ?? 50;
  const stochD = finite(last(stoch.d)) ?? 50;

  const bbWindow = closes.slice(-20);
  const bbMid = bbWindow.reduce((a, b) => a + b, 0) / bbWindow.length;
  const bbDev = stddev(bbWindow);
  const bbUpper = bbMid + bbDev * 2;
  const bbLower = bbMid - bbDev * 2;
  const bbWidthPct = ((bbUpper - bbLower) / price) * 100;
  const bbPosition = bbUpper === bbLower ? 0.5 : clamp((price - bbLower) / (bbUpper - bbLower), 0, 1);

  const dmi = adx(candles);
  const adxValue = finite(dmi.adx) ?? 0;
  const plusDI = finite(dmi.plusDI) ?? 0;
  const minusDI = finite(dmi.minusDI) ?? 0;

  const momentumBase = closes[closes.length - 11] ?? price;
  const momentumPct = momentumBase === 0 ? 0 : ((price - momentumBase) / momentumBase) * 100;
  const zScore = bbDev === 0 ? 0 : (price - bbMid) / bbDev;

  const pathWindow = closes.slice(-21);
  const netMove = Math.abs((last(pathWindow) ?? price) - (pathWindow[0] ?? price));
  const pathLength = pathWindow.reduce(
    (sum, value, index) => (index === 0 ? 0 : sum + Math.abs(value - pathWindow[index - 1]!)),
    0,
  );
  const efficiency = pathLength === 0 ? 0 : clamp(netMove / pathLength, 0, 1);

  const drivers: { text: string; weight: number }[] = [];
  let score = 0;
  const push = (text: string, weight: number) => {
    score += weight;
    drivers.push({ text, weight });
  };

  push(
    ema9 > ema21
      ? "EMA 9 فوق EMA 21 — زخم قصير صاعد"
      : "EMA 9 تحت EMA 21 — زخم قصير هابط",
    ema9 > ema21 ? 18 : -18,
  );
  push(
    price > ema50 ? "السعر فوق EMA 50 — هيكل صاعد" : "السعر تحت EMA 50 — هيكل هابط",
    price > ema50 ? 14 : -14,
  );
  if (ema200 != null) {
    push(
      price > ema200 ? "السعر فوق EMA 200 — اتجاه كبير صاعد" : "السعر تحت EMA 200 — اتجاه كبير هابط",
      price > ema200 ? 10 : -10,
    );
  }
  push(
    `MACD ${macdHist >= 0 ? "إيجابي" : "سلبي"} (${macdHist >= 0 ? "+" : ""}${macdHist.toFixed(4)}) و${macdHistSlope >= 0 ? "يتسع" : "يتقلص"}`,
    clamp(macdHist / Math.max(atr14 * 0.35, 1e-9), -1, 1) * 16 + (macdHistSlope >= 0 ? 4 : -4),
  );
  push(
    `ADX ${adxValue.toFixed(1)} · DI+ ${plusDI.toFixed(1)} / DI- ${minusDI.toFixed(1)}`,
    clamp((adxValue - 18) / 22, 0, 1) * (plusDI >= minusDI ? 16 : -16),
  );
  if (rsi14 >= 70) push(`RSI ${rsi14.toFixed(1)} — تشبع شرائي`, -12);
  else if (rsi14 <= 30) push(`RSI ${rsi14.toFixed(1)} — تشبع بيعي`, 12);
  else push(`RSI ${rsi14.toFixed(1)}`, clamp((rsi14 - 50) / 20, -1, 1) * 10);
  push(
    `ستوكاستيك ${stochK.toFixed(1)}/${stochD.toFixed(1)}`,
    clamp((stochK - 50) / 40, -1, 1) * 8 + (stochK > stochD ? 2 : -2),
  );
  push(
    `موقع السعر داخل بولينجر ${(bbPosition * 100).toFixed(0)}%`,
    clamp((bbPosition - 0.5) * 2, -1, 1) * 8,
  );
  push(
    `كفاءة الحركة ${(efficiency * 100).toFixed(0)}% مع زخم ${momentumPct >= 0 ? "+" : ""}${momentumPct.toFixed(3)}%`,
    clamp(momentumPct / Math.max((atr14 / price) * 100, 1e-9), -2, 2) * 6 * (0.4 + efficiency),
  );

  const trendScore = clamp(score, -100, 100);
  const strength = Math.round(Math.abs(trendScore));
  const direction: Direction = strength < 26 ? "neutral" : trendScore > 0 ? "up" : "down";

  return {
    price,
    ema9,
    ema21,
    ema50,
    ema200,
    rsi14,
    stochK,
    stochD,
    macd: macdValue,
    macdSignal,
    macdHist,
    macdHistSlope,
    bbUpper,
    bbMid,
    bbLower,
    bbWidthPct,
    bbPosition,
    adx: adxValue,
    plusDI,
    minusDI,
    atr14,
    atrPct: (atr14 / price) * 100,
    momentumPct,
    zScore,
    efficiency,
    trendScore,
    direction,
    strength,
    drivers: drivers.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, 5),
  };
}

/**
 * Risk plan derived from real ATR: stop behind volatility, target scaled by
 * conviction. Returns null when the read is neutral or conviction is too low.
 */
export function buildTradePlan(
  tech: TechSnapshot,
  direction: Direction,
  confidence: number,
): TradePlan | null {
  if (direction === "neutral" || confidence < 58) return null;
  const stopDistance = tech.atr14 * 1.5;
  const rewardMultiple = clamp(1 + (confidence - 55) / 22, 1.1, 3);
  const targetDistance = stopDistance * rewardMultiple;
  const entry = tech.price;
  const stopLoss = direction === "up" ? entry - stopDistance : entry + stopDistance;
  const takeProfit = direction === "up" ? entry + targetDistance : entry - targetDistance;
  return {
    direction,
    entry,
    stopLoss,
    takeProfit,
    riskRewardRatio: targetDistance / stopDistance,
    riskPct: (stopDistance / entry) * 100,
    rewardPct: (targetDistance / entry) * 100,
  };
}

/** Multi-timeframe agreement: higher timeframes carry more weight. */
export function buildConfluence(inputs: ConfluenceInput[]): Confluence {
  const rows = inputs.map((input) => ({
    label: input.label,
    direction: input.tech?.direction ?? ("neutral" as Direction),
    strength: input.tech?.strength ?? 0,
    available: Boolean(input.tech),
  }));

  const available = inputs.filter((input) => input.tech);
  if (!available.length) return { score: 0, direction: "neutral", alignment: 0, rows };

  let weighted = 0;
  let weightSum = 0;
  available.forEach((input, index) => {
    const weight = 1 + index * 0.6;
    weighted += (input.tech!.trendScore / 100) * weight;
    weightSum += weight;
  });
  const score = clamp((weighted / weightSum) * 100, -100, 100);
  const signs = available.map((input) => Math.sign(input.tech!.trendScore));
  const dominant = signs.reduce((a, b) => a + b, 0) >= 0 ? 1 : -1;
  const alignment = Math.round((signs.filter((s) => s === dominant).length / signs.length) * 100);
  const direction: Direction = Math.abs(score) < 20 ? "neutral" : score > 0 ? "up" : "down";
  return { score, direction, alignment, rows };
}

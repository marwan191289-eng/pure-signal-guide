import type { Candle } from "./deriv";

export type AgentDirection = "up" | "down" | "neutral";
export type MarketRegime =
  | "trend_up"
  | "trend_down"
  | "range"
  | "high_volatility"
  | "low_volatility";

type FeatureVector = {
  values: number[];
  names: string[];
  atrPct: number;
  rsi: number;
  emaSpreadPct: number;
  volatilityPercentile: number;
  regime: MarketRegime;
};

type PendingPrediction = {
  originEpoch: number;
  originClose: number;
  horizon: number;
  features: number[];
  probabilityUp: number;
  predicted: AgentDirection;
  thresholdPct: number;
};

type AgentState = {
  weights: number[];
  bias: number;
  samples: number;
  correct: number;
  recent: boolean[];
  lastError: AgentDirection | null;
  lastUpdateEpoch: number | null;
};

export type AgentForecast = {
  horizon: number;
  direction: AgentDirection;
  probabilityUp: number;
  probabilityDown: number;
  probabilityNeutral: number;
  confidence: number;
  expectedMovePct: number;
  regime: MarketRegime;
  reasons: string[];
};

export type AgentSnapshot = {
  primary: AgentForecast;
  forecasts: AgentForecast[];
  regime: MarketRegime;
  sampleCount: number;
  accuracy: number;
  recentAccuracy: number;
  learningRate: number;
  lastUpdateEpoch: number | null;
  lastError: AgentDirection | null;
  modelVersion: string;
};

const MODEL_VERSION = "adaptive-regime-agent-v1";
const HORIZONS = [1, 3, 5];
const DEFAULT_WEIGHTS = [0.9, 0.55, 0.4, 0.28, 0.22, 0.2, 0.18, 0.12];
const LEARNING_RATE = 0.035;
const MAX_WEIGHT = 2.5;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const sigmoid = (value: number) => 1 / (1 + Math.exp(-clamp(value, -12, 12)));

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function percentile(values: number[], value: number) {
  if (!values.length) return 0.5;
  return values.filter((entry) => entry <= value).length / values.length;
}

function returns(closes: number[], period: number) {
  const current = closes.at(-1) ?? 0;
  const previous = closes.at(-(period + 1)) ?? current;
  return previous === 0 ? 0 : ((current - previous) / previous) * 100;
}

function ema(values: number[], period: number) {
  const seed = average(values.slice(0, period));
  let result = seed;
  const multiplier = 2 / (period + 1);
  for (const value of values.slice(period)) result = value * multiplier + result * (1 - multiplier);
  return result;
}

function rsi(values: number[], period = 14) {
  if (values.length <= period) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const delta = values[i]! - values[i - 1]!;
    gains += Math.max(delta, 0);
    losses += Math.max(-delta, 0);
  }
  let averageGain = gains / period;
  let averageLoss = losses / period;
  for (let i = period + 1; i < values.length; i += 1) {
    const delta = values[i]! - values[i - 1]!;
    averageGain = (averageGain * (period - 1) + Math.max(delta, 0)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(-delta, 0)) / period;
  }
  return averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
}

function atr(candles: Candle[], period = 14) {
  const ranges = candles.map((candle, index) => {
    const previousClose = candles[index - 1]?.close ?? candle.close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    );
  });
  return average(ranges.slice(-period));
}

function detectRegime(
  emaSpreadPct: number,
  atrPct: number,
  volatilityPercentile: number,
): MarketRegime {
  if (volatilityPercentile >= 0.78) return "high_volatility";
  if (volatilityPercentile <= 0.22) return "low_volatility";
  const trendThreshold = Math.max(atrPct * 0.22, 0.005);
  if (emaSpreadPct > trendThreshold) return "trend_up";
  if (emaSpreadPct < -trendThreshold) return "trend_down";
  return "range";
}

function extractFeatures(candles: Candle[]): FeatureVector | null {
  if (candles.length < 60) return null;
  const closes = candles.map((candle) => candle.close);
  const price = closes.at(-1) ?? 0;
  if (!price) return null;

  const atrValue = atr(candles);
  const atrPct = (atrValue / price) * 100;
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const ema50 = ema(closes, 50);
  const rsiValue = rsi(closes);
  const currentCandle = candles.at(-1)!;
  const range = Math.max(currentCandle.high - currentCandle.low, Number.EPSILON);
  const bodyBias = (currentCandle.close - currentCandle.open) / range;
  const typicalRanges = candles.slice(-61, -1).map((candle) => candle.high - candle.low);
  const rangeRatio = clamp(
    (currentCandle.high - currentCandle.low) / Math.max(average(typicalRanges), Number.EPSILON),
    0,
    3,
  );
  const volatilityHistory = candles
    .slice(-80)
    .map((_, index, source) => {
      const window = candles.slice(Math.max(0, candles.length - 80 + index - 13), candles.length - 80 + index + 1);
      const windowPrice = window.at(-1)?.close ?? price;
      return windowPrice ? (atr(window) / windowPrice) * 100 : atrPct;
    })
    .filter((value) => Number.isFinite(value));
  const volatilityPercentile = percentile(volatilityHistory, atrPct);
  const emaSpreadPct = ((ema9 - ema21) / price) * 100;
  const trendSpreadPct = ((ema21 - ema50) / price) * 100;
  const regime = detectRegime(emaSpreadPct, atrPct, volatilityPercentile);

  const values = [
    clamp(returns(closes, 1) / Math.max(atrPct, 0.0001), -3, 3) / 3,
    clamp(returns(closes, 3) / Math.max(atrPct * 1.5, 0.0001), -3, 3) / 3,
    clamp(returns(closes, 5) / Math.max(atrPct * 2, 0.0001), -3, 3) / 3,
    clamp(emaSpreadPct / Math.max(atrPct, 0.0001), -3, 3) / 3,
    clamp(trendSpreadPct / Math.max(atrPct * 1.5, 0.0001), -3, 3) / 3,
    clamp((rsiValue - 50) / 25, -2, 2) / 2,
    clamp(bodyBias, -1, 1),
    clamp(rangeRatio - 1, -1, 1),
  ];

  return {
    values,
    names: ["شمعة أخيرة", "زخم 3 شموع", "زخم 5 شموع", "فارق EMA 9/21", "اتجاه EMA 21/50", "انحراف RSI", "انحياز جسم الشمعة", "اتساع النطاق"],
    atrPct,
    rsi: rsiValue,
    emaSpreadPct,
    volatilityPercentile,
    regime,
  };
}

function directionFor(probabilityUp: number, neutralProbability: number): AgentDirection {
  if (neutralProbability >= 0.42 || Math.abs(probabilityUp - 0.5) < 0.07) return "neutral";
  return probabilityUp > 0.5 ? "up" : "down";
}

function regimeLabel(regime: MarketRegime) {
  return {
    trend_up: "اتجاه صاعد",
    trend_down: "اتجاه هابط",
    range: "نطاق جانبي",
    high_volatility: "تقلب مرتفع",
    low_volatility: "تقلب منخفض",
  }[regime];
}

function createForecast(
  features: FeatureVector,
  state: AgentState,
  horizon: number,
): AgentForecast {
  const score =
    state.bias +
    features.values.reduce((sum, value, index) => sum + value * (state.weights[index] ?? 0), 0);
  const probabilityUp = sigmoid(score);
  const distance = Math.abs(probabilityUp - 0.5) * 2;
  const horizonDecay = horizon === 1 ? 1 : horizon === 3 ? 0.82 : 0.68;
  const confidence = Math.round(
    clamp((50 + distance * 48) * horizonDecay, 50, state.samples < 20 ? 68 : 96),
  );
  const probabilityNeutral = clamp(
    0.18 + (features.regime === "range" ? 0.2 : 0) + (1 - distance) * 0.18,
    0.12,
    0.58,
  );
  const directionalMass = 1 - probabilityNeutral;
  const adjustedUp = 0.5 + (probabilityUp - 0.5) * directionalMass;
  const adjustedDown = 1 - probabilityNeutral - adjustedUp;
  const direction = directionFor(adjustedUp, probabilityNeutral);
  const expectedMovePct = (adjustedUp - adjustedDown) * features.atrPct * Math.sqrt(horizon);
  const reasons = [
    `${regimeLabel(features.regime)}: ${features.emaSpreadPct >= 0 ? "المتوسطات تميل للصعود" : "المتوسطات تميل للهبوط"}`,
    `RSI ${features.rsi.toFixed(1)} مع تقلب تاريخي عند النسبة المئوية ${Math.round(features.volatilityPercentile * 100)}%`,
    `اتجاه النموذج ${adjustedUp >= adjustedDown ? "صاعد" : "هابط"} بعد تحديث ${state.samples} عينة`,
  ];

  return {
    horizon,
    direction,
    probabilityUp: Math.round(adjustedUp * 100),
    probabilityDown: Math.round(adjustedDown * 100),
    probabilityNeutral: Math.round(probabilityNeutral * 100),
    confidence,
    expectedMovePct,
    regime: features.regime,
    reasons,
  };
}

function defaultState(): AgentState {
  return {
    weights: [...DEFAULT_WEIGHTS],
    bias: 0,
    samples: 0,
    correct: 0,
    recent: [],
    lastError: null,
    lastUpdateEpoch: null,
  };
}

function loadState(storageKey: string) {
  if (typeof window === "undefined") return defaultState();
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null") as Partial<AgentState> | null;
    if (!saved || !Array.isArray(saved.weights) || saved.weights.length !== DEFAULT_WEIGHTS.length) {
      return defaultState();
    }
    return {
      ...defaultState(),
      ...saved,
      weights: saved.weights.map((weight) => clamp(Number(weight) || 0, -MAX_WEIGHT, MAX_WEIGHT)),
    };
  } catch {
    return defaultState();
  }
}

export class AdaptiveAnalysisAgent {
  private readonly storageKey: string;
  private state: AgentState;
  private pending: PendingPrediction[] = [];
  private lastPredictionEpoch: number | null = null;

  constructor(symbol: string, granularity: number) {
    this.storageKey = `deriv-pulse:${MODEL_VERSION}:${symbol}:${granularity}`;
    this.state = loadState(this.storageKey);
  }

  process(candles: Candle[], _granularity: number): AgentSnapshot | null {
    const features = extractFeatures(candles);
    if (!features) return null;

    this.resolvePending(candles);
    const current = candles.at(-1)!;
    const isNewCandle = this.lastPredictionEpoch !== current.epoch;
    if (isNewCandle) {
      this.lastPredictionEpoch = current.epoch;
      const primary = createForecast(features, this.state, 1);
      for (const horizon of HORIZONS) {
        this.pending.push({
          originEpoch: current.epoch,
          originClose: current.close,
          horizon,
          features: [...features.values],
          probabilityUp: primary.probabilityUp / 100,
          predicted: horizon === 1 ? primary.direction : createForecast(features, this.state, horizon).direction,
          thresholdPct: Math.max(features.atrPct * 0.12, 0.00001),
        });
      }
    }

    this.persist();
    const forecasts = HORIZONS.map((horizon) => createForecast(features, this.state, horizon));
    return {
      primary: forecasts[0]!,
      forecasts,
      regime: features.regime,
      sampleCount: this.state.samples,
      accuracy: this.state.samples ? (this.state.correct / this.state.samples) * 100 : 0,
      recentAccuracy: this.state.recent.length
        ? (this.state.recent.filter(Boolean).length / this.state.recent.length) * 100
        : 0,
      learningRate: LEARNING_RATE,
      lastUpdateEpoch: this.state.lastUpdateEpoch,
      lastError: this.state.lastError,
      modelVersion: MODEL_VERSION,
    };
  }

  private resolvePending(candles: Candle[]) {
    const remaining: PendingPrediction[] = [];
    for (const prediction of this.pending) {
      const originIndex = candles.findIndex((candle) => candle.epoch === prediction.originEpoch);
      if (originIndex < 0) continue;
      const target = candles[originIndex + prediction.horizon];
      if (!target) {
        remaining.push(prediction);
        continue;
      }

      const changePct =
        prediction.originClose === 0
          ? 0
          : ((target.close - prediction.originClose) / prediction.originClose) * 100;
      const actual: AgentDirection =
        changePct > prediction.thresholdPct
          ? "up"
          : changePct < -prediction.thresholdPct
            ? "down"
            : "neutral";
      const correct = actual === prediction.predicted;
      const targetProbability = actual === "up" ? 1 : actual === "down" ? 0 : 0.5;
      const error = targetProbability - prediction.probabilityUp;

      prediction.features.forEach((feature, index) => {
        this.state.weights[index] = clamp(
          (this.state.weights[index] ?? 0) + LEARNING_RATE * error * feature,
          -MAX_WEIGHT,
          MAX_WEIGHT,
        );
      });
      this.state.bias = clamp(this.state.bias + LEARNING_RATE * error, -MAX_WEIGHT, MAX_WEIGHT);
      this.state.samples += 1;
      this.state.correct += correct ? 1 : 0;
      this.state.recent = [...this.state.recent, correct].slice(-40);
      this.state.lastError = correct ? null : actual;
      this.state.lastUpdateEpoch = target.epoch;
    }
    this.pending = remaining;
  }

  private persist() {
    if (typeof window === "undefined") return;
    localStorage.setItem(this.storageKey, JSON.stringify(this.state));
  }
}
/**
 * Adaptive analysis brain.
 *
 * It learns online from its own closed-candle outcomes: every forecast is
 * stored, resolved against the real next candles, then used to update
 * regime-specific logistic weights. No simulated data is ever fed in.
 */
import type { Candle } from "./deriv";
import { computeTech, type Direction, type TechSnapshot } from "./engine";

export type AgentDirection = Direction;
export type MarketRegime =
  | "trend_up"
  | "trend_down"
  | "range"
  | "high_volatility"
  | "low_volatility";

const FEATURE_NAMES = [
  "زخم شمعة واحدة",
  "زخم 3 شموع",
  "زخم 5 شموع",
  "فارق EMA 9/21",
  "اتجاه EMA 21/50",
  "انحراف RSI",
  "هستوجرام MACD",
  "ميل هستوجرام MACD",
  "قوة الاتجاه ADX",
  "ستوكاستيك",
  "موقع بولينجر",
  "كفاءة الحركة",
  "انحياز جسم الشمعة",
  "اتساع النطاق",
];

const MODEL_VERSION = "adaptive-regime-agent-v2";
const HORIZONS = [1, 3, 5];
const BASE_LEARNING_RATE = 0.05;
const MIN_LEARNING_RATE = 0.012;
const MAX_WEIGHT = 2.5;
const L2 = 0.0008;
const RECENT_WINDOW = 60;

type FeatureVector = {
  values: number[];
  tech: TechSnapshot;
  volatilityPercentile: number;
  regime: MarketRegime;
};

type PendingPrediction = {
  originEpoch: number;
  originClose: number;
  horizon: number;
  features: number[];
  regime: MarketRegime;
  probabilityUp: number;
  predicted: AgentDirection;
  thresholdPct: number;
};

type RegimeStat = { samples: number; correct: number };

type AgentState = {
  global: { weights: number[]; bias: number };
  regimes: Record<MarketRegime, { weights: number[]; bias: number }>;
  samples: number;
  correct: number;
  squaredError: number;
  recent: boolean[];
  regimeStats: Record<MarketRegime, RegimeStat>;
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
  regimeAccuracy: number;
  regimeSamples: number;
  brierScore: number;
  learningRate: number;
  lastUpdateEpoch: number | null;
  lastError: AgentDirection | null;
  modelVersion: string;
  tech: TechSnapshot;
  openPredictions: number;
};

const REGIMES: MarketRegime[] = [
  "trend_up",
  "trend_down",
  "range",
  "high_volatility",
  "low_volatility",
];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const sigmoid = (v: number) => 1 / (1 + Math.exp(-clamp(v, -12, 12)));
const average = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

function percentile(values: number[], value: number) {
  if (!values.length) return 0.5;
  return values.filter((entry) => entry <= value).length / values.length;
}

function change(closes: number[], period: number) {
  const current = closes.at(-1) ?? 0;
  const previous = closes.at(-(period + 1)) ?? current;
  return previous === 0 ? 0 : ((current - previous) / previous) * 100;
}

function detectRegime(tech: TechSnapshot, volatilityPercentile: number): MarketRegime {
  if (volatilityPercentile >= 0.8) return "high_volatility";
  if (volatilityPercentile <= 0.2) return "low_volatility";
  const trending = tech.adx >= 22 && tech.efficiency >= 0.25;
  if (trending && tech.trendScore > 0) return "trend_up";
  if (trending && tech.trendScore < 0) return "trend_down";
  return "range";
}

function extractFeatures(candles: Candle[]): FeatureVector | null {
  const tech = computeTech(candles);
  if (!tech) return null;
  const closes = candles.map((c) => c.close);
  const price = tech.price;
  const atrPct = Math.max(tech.atrPct, 0.0001);

  const volatilityHistory: number[] = [];
  for (let i = Math.max(30, candles.length - 90); i < candles.length; i += 1) {
    const window = candles.slice(Math.max(0, i - 14), i + 1);
    const snapshotPrice = window.at(-1)?.close ?? price;
    const ranges = window.map((candle, index) => {
      const previousClose = window[index - 1]?.close ?? candle.close;
      return Math.max(
        candle.high - candle.low,
        Math.abs(candle.high - previousClose),
        Math.abs(candle.low - previousClose),
      );
    });
    const value = snapshotPrice ? (average(ranges) / snapshotPrice) * 100 : atrPct;
    if (Number.isFinite(value)) volatilityHistory.push(value);
  }
  const volatilityPercentile = percentile(volatilityHistory, tech.atrPct);
  const regime = detectRegime(tech, volatilityPercentile);

  const current = candles.at(-1)!;
  const range = Math.max(current.high - current.low, Number.EPSILON);
  const bodyBias = (current.close - current.open) / range;
  const typicalRange = Math.max(
    average(candles.slice(-41, -1).map((c) => c.high - c.low)),
    Number.EPSILON,
  );
  const rangeRatio = clamp(range / typicalRange, 0, 3);

  const values = [
    clamp(change(closes, 1) / atrPct, -3, 3) / 3,
    clamp(change(closes, 3) / (atrPct * 1.5), -3, 3) / 3,
    clamp(change(closes, 5) / (atrPct * 2), -3, 3) / 3,
    clamp(((tech.ema9 - tech.ema21) / price) * 100 / atrPct, -3, 3) / 3,
    clamp(((tech.ema21 - tech.ema50) / price) * 100 / atrPct, -3, 3) / 3,
    clamp((tech.rsi14 - 50) / 25, -2, 2) / 2,
    clamp(tech.macdHist / Math.max(tech.atr14 * 0.4, Number.EPSILON), -3, 3) / 3,
    clamp(tech.macdHistSlope / Math.max(tech.atr14 * 0.2, Number.EPSILON), -3, 3) / 3,
    clamp((tech.adx - 20) / 25, -1, 1) * Math.sign(tech.plusDI - tech.minusDI || 1),
    clamp((tech.stochK - 50) / 40, -1, 1),
    clamp((tech.bbPosition - 0.5) * 2, -1, 1),
    clamp(tech.efficiency * Math.sign(tech.trendScore || 1), -1, 1),
    clamp(bodyBias, -1, 1),
    clamp(rangeRatio - 1, -1, 1),
  ];

  return { values, tech, volatilityPercentile, regime };
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

function emptyRegimeMap<T>(factory: () => T): Record<MarketRegime, T> {
  return REGIMES.reduce(
    (acc, regime) => {
      acc[regime] = factory();
      return acc;
    },
    {} as Record<MarketRegime, T>,
  );
}

function defaultState(): AgentState {
  const zeros = () => ({ weights: new Array(FEATURE_NAMES.length).fill(0) as number[], bias: 0 });
  const seed = zeros();
  // Small priors reflecting classic momentum/trend behaviour; learning refines them.
  seed.weights[0] = 0.5;
  seed.weights[3] = 0.45;
  seed.weights[4] = 0.3;
  seed.weights[6] = 0.35;
  seed.weights[8] = 0.25;
  return {
    global: seed,
    regimes: emptyRegimeMap(zeros),
    samples: 0,
    correct: 0,
    squaredError: 0,
    recent: [],
    regimeStats: emptyRegimeMap(() => ({ samples: 0, correct: 0 })),
    lastError: null,
    lastUpdateEpoch: null,
  };
}

function sanitizeWeights(weights: unknown): number[] | null {
  if (!Array.isArray(weights) || weights.length !== FEATURE_NAMES.length) return null;
  return weights.map((w) => clamp(Number(w) || 0, -MAX_WEIGHT, MAX_WEIGHT));
}

function loadState(storageKey: string): AgentState {
  if (typeof window === "undefined") return defaultState();
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null") as AgentState | null;
    const base = defaultState();
    if (!saved) return base;
    const globalWeights = sanitizeWeights(saved.global?.weights);
    if (!globalWeights) return base;
    const regimes = emptyRegimeMap(() => ({
      weights: new Array(FEATURE_NAMES.length).fill(0) as number[],
      bias: 0,
    }));
    for (const regime of REGIMES) {
      const weights = sanitizeWeights(saved.regimes?.[regime]?.weights);
      if (weights) regimes[regime] = { weights, bias: Number(saved.regimes[regime]?.bias) || 0 };
    }
    return {
      ...base,
      ...saved,
      global: { weights: globalWeights, bias: Number(saved.global?.bias) || 0 },
      regimes,
      recent: Array.isArray(saved.recent) ? saved.recent.slice(-RECENT_WINDOW).map(Boolean) : [],
      regimeStats: REGIMES.reduce(
        (acc, regime) => {
          const stat = saved.regimeStats?.[regime];
          acc[regime] = {
            samples: Number(stat?.samples) || 0,
            correct: Number(stat?.correct) || 0,
          };
          return acc;
        },
        {} as Record<MarketRegime, RegimeStat>,
      ),
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

  private learningRate() {
    const decay = BASE_LEARNING_RATE / (1 + this.state.samples / 140);
    const recent = this.state.recent.slice(-20);
    const recentAccuracy = recent.length ? recent.filter(Boolean).length / recent.length : 0.5;
    // Learn faster while the recent hit-rate is poor, slow down once stable.
    const urgency = recentAccuracy < 0.5 ? 1.5 : recentAccuracy > 0.62 ? 0.7 : 1;
    return Math.max(MIN_LEARNING_RATE, decay * urgency);
  }

  private score(features: number[], regime: MarketRegime) {
    const regimeModel = this.state.regimes[regime];
    const regimeSamples = this.state.regimeStats[regime].samples;
    const regimeShare = clamp(regimeSamples / 60, 0, 0.6);
    let total = this.state.global.bias * (1 - regimeShare) + regimeModel.bias * regimeShare;
    for (let i = 0; i < features.length; i += 1) {
      const blended =
        (this.state.global.weights[i] ?? 0) * (1 - regimeShare) +
        (regimeModel.weights[i] ?? 0) * regimeShare;
      total += blended * (features[i] ?? 0);
    }
    return total;
  }

  private forecast(features: FeatureVector, horizon: number): AgentForecast {
    const raw = sigmoid(this.score(features.values, features.regime));
    const reliability = clamp(this.state.samples / 90, 0, 1);
    // Shrink toward 50% until the model has actually been validated on real outcomes.
    const probabilityUp = 0.5 + (raw - 0.5) * (0.55 + 0.45 * reliability);
    const distance = Math.abs(probabilityUp - 0.5) * 2;
    const horizonDecay = horizon === 1 ? 1 : horizon === 3 ? 0.84 : 0.7;
    const ceiling = this.state.samples < 25 ? 70 : 94;
    const confidence = Math.round(clamp((50 + distance * 46) * horizonDecay, 50, ceiling));
    const probabilityNeutral = clamp(
      0.16 +
        (features.regime === "range" ? 0.18 : 0) +
        (features.regime === "low_volatility" ? 0.08 : 0) +
        (1 - distance) * 0.2,
      0.1,
      0.56,
    );
    const directionalMass = 1 - probabilityNeutral;
    const adjustedUp = 0.5 * probabilityNeutral + probabilityUp * directionalMass;
    const adjustedDown = 1 - probabilityNeutral - adjustedUp + 0.5 * probabilityNeutral;
    const direction: AgentDirection =
      probabilityNeutral >= 0.45 || distance < 0.12
        ? "neutral"
        : probabilityUp > 0.5
          ? "up"
          : "down";
    const tech = features.tech;
    const expectedMovePct =
      (probabilityUp - 0.5) * 2 * tech.atrPct * Math.sqrt(horizon) * (0.5 + tech.efficiency);

    const contributions = features.values
      .map((value, index) => ({
        name: FEATURE_NAMES[index]!,
        impact: value * (this.state.global.weights[index] ?? 0),
      }))
      .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
      .slice(0, 3)
      .map(
        (item) =>
          `${item.name}: ${item.impact >= 0 ? "يدفع للصعود" : "يدفع للهبوط"} (${Math.abs(item.impact).toFixed(2)})`,
      );

    const reasons = [
      `${regimeLabel(features.regime)} · ADX ${tech.adx.toFixed(1)} · كفاءة ${(tech.efficiency * 100).toFixed(0)}%`,
      `RSI ${tech.rsi14.toFixed(1)} · تقلب عند النسبة ${Math.round(features.volatilityPercentile * 100)}% تاريخياً`,
      ...contributions,
      `تم تحديث النموذج على ${this.state.samples} نتيجة مغلقة حقيقية`,
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

  process(candles: Candle[], _granularity?: number): AgentSnapshot | null {
    const features = extractFeatures(candles);
    if (!features) return null;

    this.resolvePending(candles);

    const current = candles.at(-1)!;
    const forecasts = HORIZONS.map((horizon) => this.forecast(features, horizon));

    if (this.lastPredictionEpoch !== current.epoch) {
      this.lastPredictionEpoch = current.epoch;
      const rawProbability = sigmoid(this.score(features.values, features.regime));
      for (const forecast of forecasts) {
        this.pending.push({
          originEpoch: current.epoch,
          originClose: current.close,
          horizon: forecast.horizon,
          features: [...features.values],
          regime: features.regime,
          probabilityUp: rawProbability,
          predicted: forecast.direction,
          thresholdPct: Math.max(features.tech.atrPct * 0.1, 0.00001),
        });
      }
      this.pending = this.pending.slice(-180);
    }

    this.persist();

    const regimeStat = this.state.regimeStats[features.regime];
    return {
      primary: forecasts[0]!,
      forecasts,
      regime: features.regime,
      sampleCount: this.state.samples,
      accuracy: this.state.samples ? (this.state.correct / this.state.samples) * 100 : 0,
      recentAccuracy: this.state.recent.length
        ? (this.state.recent.filter(Boolean).length / this.state.recent.length) * 100
        : 0,
      regimeAccuracy: regimeStat.samples ? (regimeStat.correct / regimeStat.samples) * 100 : 0,
      regimeSamples: regimeStat.samples,
      brierScore: this.state.samples ? this.state.squaredError / this.state.samples : 0,
      learningRate: this.learningRate(),
      lastUpdateEpoch: this.state.lastUpdateEpoch,
      lastError: this.state.lastError,
      modelVersion: MODEL_VERSION,
      tech: features.tech,
      openPredictions: this.pending.length,
    };
  }

  private resolvePending(candles: Candle[]) {
    if (!this.pending.length) return;
    const index = new Map(candles.map((candle, position) => [candle.epoch, position]));
    const remaining: PendingPrediction[] = [];

    for (const prediction of this.pending) {
      const originIndex = index.get(prediction.originEpoch);
      if (originIndex == null) continue; // origin scrolled out of history
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
      const rate = this.learningRate() * (prediction.horizon === 1 ? 1 : 0.5);

      this.update(this.state.global, prediction.features, error, rate);
      this.update(this.state.regimes[prediction.regime], prediction.features, error, rate);

      this.state.samples += 1;
      this.state.correct += correct ? 1 : 0;
      this.state.squaredError += error * error;
      this.state.recent = [...this.state.recent, correct].slice(-RECENT_WINDOW);
      this.state.regimeStats[prediction.regime].samples += 1;
      if (correct) this.state.regimeStats[prediction.regime].correct += 1;
      this.state.lastError = correct ? null : actual;
      this.state.lastUpdateEpoch = target.epoch;
    }

    this.pending = remaining;
  }

  private update(
    model: { weights: number[]; bias: number },
    features: number[],
    error: number,
    rate: number,
  ) {
    for (let i = 0; i < features.length; i += 1) {
      const weight = model.weights[i] ?? 0;
      model.weights[i] = clamp(
        weight + rate * (error * (features[i] ?? 0) - L2 * weight),
        -MAX_WEIGHT,
        MAX_WEIGHT,
      );
    }
    model.bias = clamp(model.bias + rate * error, -MAX_WEIGHT, MAX_WEIGHT);
  }

  private persist() {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.state));
    } catch {
      // Storage full or blocked — learning continues in memory.
    }
  }
}

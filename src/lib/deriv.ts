/**
 * Deriv WebSocket API client (real market data, no simulation).
 * Docs: https://api.deriv.com/api-explorer
 * Runs in the browser only.
 */

export type Candle = {
  epoch: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type SymbolInfo = {
  symbol: string;
  display_name: string;
  group: string;
};

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
};

type LiveSubscription = {
  request: Record<string, unknown>;
  callback: (msg: any) => void;
  requestId: number | null;
  subscriptionId: string | null;
  stopped: boolean;
};

const ENDPOINT = "wss://ws.derivws.com/websockets/v3?app_id=1089";

export type ConnState = "connecting" | "open" | "closed";

class DerivClient {
  private ws: WebSocket | null = null;
  private reqId = 1;
  private pending = new Map<number, Pending>();
  private subscriptions = new Map<number, LiveSubscription>();
  private connectPromise: Promise<void> | null = null;
  private connectTimeout: number | null = null;
  private reconnectTimer: number | null = null;
  private reconnectAttempt = 0;
  private nextSubscriptionId = 1;
  private hasConnected = false;
  private stateListeners = new Set<(s: ConnState) => void>();
  state: ConnState = "closed";

  onState(cb: (s: ConnState) => void) {
    this.stateListeners.add(cb);
    cb(this.state);
    return () => {
      this.stateListeners.delete(cb);
    };
  }

  private setState(s: ConnState) {
    this.state = s;
    this.stateListeners.forEach((l) => l(s));
  }

  private ensure(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;

    this.setState("connecting");
    this.connectPromise = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(ENDPOINT);
      let settled = false;
      this.ws = ws;
      this.connectTimeout = window.setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          settled = true;
          reject(new Error("connection timeout"));
          ws.close();
        }
      }, 8000);
      ws.onopen = () => {
        if (this.connectTimeout !== null) window.clearTimeout(this.connectTimeout);
        this.connectTimeout = null;
        settled = true;
        const reconnecting = this.hasConnected;
        this.hasConnected = true;
        this.reconnectAttempt = 0;
        this.setState("open");
        this.connectPromise = null;
        resolve();
        if (reconnecting) this.resubscribe();
      };
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new Error("connection failed"));
        }
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
      };
      ws.onclose = () => {
        if (this.connectTimeout !== null) window.clearTimeout(this.connectTimeout);
        this.connectTimeout = null;
        if (!settled) {
          settled = true;
          reject(new Error("connection closed"));
        }
        if (this.ws === ws) this.ws = null;
        this.connectPromise = null;
        this.setState("closed");
        this.pending.forEach((p) => p.reject(new Error("connection closed")));
        this.pending.clear();
        if (this.subscriptions.size > 0) this.scheduleReconnect();
      };
      ws.onmessage = (ev) => {
        try {
          this.handle(JSON.parse(ev.data));
        } catch {
          // Ignore malformed frames without taking down the live dashboard.
        }
      };
    }).catch((error) => {
      this.connectPromise = null;
      if (this.ws?.readyState !== WebSocket.OPEN) this.ws = null;
      throw error;
    });
    return this.connectPromise;
  }

  private scheduleReconnect() {
    if (this.reconnectTimer !== null || this.connectPromise || this.subscriptions.size === 0)
      return;
    const delay = Math.min(30000, 1000 * 2 ** Math.min(this.reconnectAttempt, 5));
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      void this.ensure().catch(() => this.scheduleReconnect());
    }, delay);
  }

  private resubscribe() {
    for (const [id, subscription] of this.subscriptions) {
      subscription.requestId = null;
      subscription.subscriptionId = null;
      void this.startSubscription(id);
    }
  }

  private async startSubscription(id: number) {
    const subscription = this.subscriptions.get(id);
    if (!subscription || subscription.stopped) return;
    await this.ensure();
    const current = this.subscriptions.get(id);
    if (!current || current.stopped || current.requestId !== null) return;
    const requestId = this.reqId++;
    current.requestId = requestId;
    this.subscriptions.set(id, current);
    this.ws!.send(JSON.stringify({ ...current.request, subscribe: 1, req_id: requestId }));
  }

  private handle(msg: any) {
    const id = msg.req_id as number | undefined;
    if (id == null) return;
    const sub = [...this.subscriptions.values()].find((item) => item.requestId === id);
    if (sub) {
      if (msg.subscription?.id) sub.subscriptionId = msg.subscription.id;
      sub.callback(msg);
    }
    const p = this.pending.get(id);
    if (p) {
      this.pending.delete(id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg);
    }
  }

  async send<T = any>(request: Record<string, unknown>): Promise<T> {
    await this.ensure();
    const req_id = this.reqId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(req_id, { resolve: resolve as (v: unknown) => void, reject });
      this.ws!.send(JSON.stringify({ ...request, req_id }));
      setTimeout(() => {
        if (this.pending.has(req_id)) {
          this.pending.delete(req_id);
          reject(new Error("timeout"));
        }
      }, 20000);
    });
  }

  /** Streaming request. Returns an unsubscribe function. */
  subscribe(request: Record<string, unknown>, cb: (msg: any) => void): () => void {
    const id = this.nextSubscriptionId++;
    this.subscriptions.set(id, {
      request,
      callback: cb,
      requestId: null,
      subscriptionId: null,
      stopped: false,
    });
    void this.startSubscription(id).catch((error) => cb({ error: { message: error.message } }));

    return () => {
      const subscription = this.subscriptions.get(id);
      if (!subscription) return;
      subscription.stopped = true;
      this.subscriptions.delete(id);
      if (subscription.subscriptionId && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ forget: subscription.subscriptionId }));
      }
    };
  }
}

let client: DerivClient | null = null;
export function deriv(): DerivClient {
  if (!client) client = new DerivClient();
  return client;
}

/** Known Deriv volatility symbols. The live API decides which ones are available. */
export const SYNTHETIC_SYMBOLS: SymbolInfo[] = [
  { symbol: "R_10", display_name: "مؤشر التقلب 10", group: "مؤشرات التقلب (كل ثانيتين)" },
  { symbol: "R_15", display_name: "مؤشر التقلب 15", group: "مؤشرات التقلب (كل ثانيتين)" },
  { symbol: "R_25", display_name: "مؤشر التقلب 25", group: "مؤشرات التقلب (كل ثانيتين)" },
  { symbol: "R_30", display_name: "مؤشر التقلب 30", group: "مؤشرات التقلب (كل ثانيتين)" },
  { symbol: "R_50", display_name: "مؤشر التقلب 50", group: "مؤشرات التقلب (كل ثانيتين)" },
  { symbol: "R_75", display_name: "مؤشر التقلب 75", group: "مؤشرات التقلب (كل ثانيتين)" },
  { symbol: "R_90", display_name: "مؤشر التقلب 90", group: "مؤشرات التقلب (كل ثانيتين)" },
  { symbol: "R_100", display_name: "مؤشر التقلب 100", group: "مؤشرات التقلب (كل ثانيتين)" },
  { symbol: "1HZ10V", display_name: "مؤشر التقلب 10 (1s)", group: "مؤشرات التقلب (كل ثانية)" },
  { symbol: "1HZ15V", display_name: "مؤشر التقلب 15 (1s)", group: "مؤشرات التقلب (كل ثانية)" },
  { symbol: "1HZ25V", display_name: "مؤشر التقلب 25 (1s)", group: "مؤشرات التقلب (كل ثانية)" },
  { symbol: "1HZ30V", display_name: "مؤشر التقلب 30 (1s)", group: "مؤشرات التقلب (كل ثانية)" },
  { symbol: "1HZ50V", display_name: "مؤشر التقلب 50 (1s)", group: "مؤشرات التقلب (كل ثانية)" },
  { symbol: "1HZ75V", display_name: "مؤشر التقلب 75 (1s)", group: "مؤشرات التقلب (كل ثانية)" },
  { symbol: "1HZ90V", display_name: "مؤشر التقلب 90 (1s)", group: "مؤشرات التقلب (كل ثانية)" },
  { symbol: "1HZ100V", display_name: "مؤشر التقلب 100 (1s)", group: "مؤشرات التقلب (كل ثانية)" },
];

/**
 * Returns only volatility indices that answer a real Deriv history request.
 * Some Deriv sessions currently return an empty active_symbols catalogue, so
 * the target symbols must be verified individually instead of assumed.
 */
export async function loadAvailableSymbols(): Promise<SymbolInfo[]> {
  const checks = await Promise.all(
    SYNTHETIC_SYMBOLS.map(async (item) => {
      try {
        await deriv().send({
          ticks_history: item.symbol,
          count: 1,
          end: "latest",
          style: "ticks",
        });
        return item;
      } catch {
        return null;
      }
    }),
  );
  return checks.filter((item): item is SymbolInfo => item !== null);
}

const mapCandles = (arr: any[]): Candle[] =>
  arr.map((c) => ({
    epoch: c.epoch,
    open: +c.open,
    high: +c.high,
    low: +c.low,
    close: +c.close,
  }));

/**
 * Polling fallback: some regions block streaming subscriptions while plain
 * history requests still return real market data.
 */
function pollCandles(
  symbol: string,
  granularity: number,
  count: number,
  onCandles: (candles: Candle[]) => void,
): () => void {
  let stopped = false;
  const tick = async () => {
    try {
      const res = await deriv().send<{ candles: any[] }>({
        ticks_history: symbol,
        adjust_start_time: 1,
        count,
        end: "latest",
        style: "candles",
        granularity,
      });
      if (!stopped && res.candles) onCandles(mapCandles(res.candles));
    } catch {
      /* keep polling */
    }
  };
  void tick();
  const id = setInterval(tick, 2000);
  return () => {
    stopped = true;
    clearInterval(id);
  };
}

/** Live candles: streams updates, falling back to polling when blocked. */
export function streamCandles(
  symbol: string,
  granularity: number,
  count: number,
  onCandles: (candles: Candle[]) => void,
): () => void {
  let series: Candle[] = [];
  let stopFallback: (() => void) | null = null;
  const stopStream = deriv().subscribe(
    {
      ticks_history: symbol,
      adjust_start_time: 1,
      count,
      end: "latest",
      style: "candles",
      granularity,
    },
    (msg) => {
      if (msg.error) {
        if (!stopFallback) stopFallback = pollCandles(symbol, granularity, count, onCandles);
        return;
      }
      if (msg.msg_type === "candles") {
        series = msg.candles.map((c: any) => ({
          epoch: c.epoch,
          open: +c.open,
          high: +c.high,
          low: +c.low,
          close: +c.close,
        }));
        onCandles([...series]);
      } else if (msg.msg_type === "ohlc") {
        const c: Candle = {
          epoch: +msg.ohlc.open_time,
          open: +msg.ohlc.open,
          high: +msg.ohlc.high,
          low: +msg.ohlc.low,
          close: +msg.ohlc.close,
        };
        const last = series[series.length - 1];
        if (last && last.epoch === c.epoch) series[series.length - 1] = c;
        else series = [...series.slice(-count + 1), c];
        onCandles([...series]);
      }
    },
  );
  return () => {
    stopStream();
    stopFallback?.();
  };
}

/** Live tick stream for the price ticker (polls when streaming is blocked). */
export function streamTicks(
  symbol: string,
  onTick: (t: { epoch: number; quote: number }) => void,
): () => void {
  let stopFallback: (() => void) | null = null;
  const startFallback = () => {
    if (stopFallback) return;
    let stopped = false;
    const run = async () => {
      try {
        const res = await deriv().send<{ history: { times: number[]; prices: number[] } }>({
          ticks_history: symbol,
          count: 1,
          end: "latest",
          style: "ticks",
        });
        const t = res.history?.times?.[0];
        const p = res.history?.prices?.[0];
        if (!stopped && t !== undefined && p !== undefined) onTick({ epoch: t, quote: +p });
      } catch {
        /* keep polling */
      }
    };
    void run();
    const id = setInterval(run, 1500);
    stopFallback = () => {
      stopped = true;
      clearInterval(id);
    };
  };

  const stopStream = deriv().subscribe({ ticks: symbol }, (msg) => {
    if (msg.error) {
      startFallback();
      return;
    }
    if (msg.msg_type === "tick" && msg.tick) {
      onTick({ epoch: msg.tick.epoch, quote: +msg.tick.quote });
    }
  });
  return () => {
    stopStream();
    stopFallback?.();
  };
}

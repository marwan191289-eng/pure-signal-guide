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

const ENDPOINT = "wss://ws.derivws.com/websockets/v3?app_id=1089";

export type ConnState = "connecting" | "open" | "closed";

class DerivClient {
  private ws: WebSocket | null = null;
  private reqId = 1;
  private pending = new Map<number, Pending>();
  private subs = new Map<number, (msg: any) => void>();
  private openWaiters: Array<() => void> = [];
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
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
      this.setState("connecting");
      const ws = new WebSocket(ENDPOINT);
      this.ws = ws;
      ws.onopen = () => {
        this.setState("open");
        this.openWaiters.splice(0).forEach((w) => w());
      };
      ws.onclose = () => {
        this.setState("closed");
        this.pending.forEach((p) => p.reject(new Error("connection closed")));
        this.pending.clear();
      };
      ws.onmessage = (ev) => this.handle(JSON.parse(ev.data));
    }
    return new Promise((res) => this.openWaiters.push(res));
  }

  private handle(msg: any) {
    const id = msg.req_id as number | undefined;
    if (id == null) return;
    const sub = this.subs.get(id);
    if (sub) sub(msg);
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
    let req_id = 0;
    let stopped = false;
    let subscriptionId: string | null = null;

    this.ensure().then(() => {
      if (stopped) return;
      req_id = this.reqId++;
      this.subs.set(req_id, (msg) => {
        if (msg.subscription?.id) subscriptionId = msg.subscription.id;
        cb(msg);
      });
      this.ws!.send(JSON.stringify({ ...request, subscribe: 1, req_id }));
    });

    return () => {
      stopped = true;
      this.subs.delete(req_id);
      if (subscriptionId && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ forget: subscriptionId }));
      }
    };
  }
}

let client: DerivClient | null = null;
export function deriv(): DerivClient {
  if (!client) client = new DerivClient();
  return client;
}

/** Catalogue of real synthetic indices served by the data provider. */
export const SYNTHETIC_SYMBOLS: SymbolInfo[] = [
  { symbol: "R_10", display_name: "مؤشر التقلب 10", group: "مؤشرات التقلب (كل ثانيتين)" },
  { symbol: "R_25", display_name: "مؤشر التقلب 25", group: "مؤشرات التقلب (كل ثانيتين)" },
  { symbol: "R_50", display_name: "مؤشر التقلب 50", group: "مؤشرات التقلب (كل ثانيتين)" },
  { symbol: "R_75", display_name: "مؤشر التقلب 75", group: "مؤشرات التقلب (كل ثانيتين)" },
  { symbol: "R_100", display_name: "مؤشر التقلب 100", group: "مؤشرات التقلب (كل ثانيتين)" },
  { symbol: "1HZ10V", display_name: "مؤشر التقلب 10 (1s)", group: "مؤشرات التقلب (كل ثانية)" },
  { symbol: "1HZ15V", display_name: "مؤشر التقلب 15 (1s)", group: "مؤشرات التقلب (كل ثانية)" },
  { symbol: "1HZ25V", display_name: "مؤشر التقلب 25 (1s)", group: "مؤشرات التقلب (كل ثانية)" },
  { symbol: "1HZ30V", display_name: "مؤشر التقلب 30 (1s)", group: "مؤشرات التقلب (كل ثانية)" },
  { symbol: "1HZ50V", display_name: "مؤشر التقلب 50 (1s)", group: "مؤشرات التقلب (كل ثانية)" },
  { symbol: "1HZ75V", display_name: "مؤشر التقلب 75 (1s)", group: "مؤشرات التقلب (كل ثانية)" },
  { symbol: "1HZ90V", display_name: "مؤشر التقلب 90 (1s)", group: "مؤشرات التقلب (كل ثانية)" },
  { symbol: "1HZ100V", display_name: "مؤشر التقلب 100 (1s)", group: "مؤشرات التقلب (كل ثانية)" },
  { symbol: "BOOM300N", display_name: "بوم 300", group: "بوم وكراش" },
  { symbol: "BOOM500", display_name: "بوم 500", group: "بوم وكراش" },
  { symbol: "BOOM1000", display_name: "بوم 1000", group: "بوم وكراش" },
  { symbol: "CRASH300N", display_name: "كراش 300", group: "بوم وكراش" },
  { symbol: "CRASH500", display_name: "كراش 500", group: "بوم وكراش" },
  { symbol: "CRASH1000", display_name: "كراش 1000", group: "بوم وكراش" },
  { symbol: "JD10", display_name: "مؤشر القفز 10", group: "مؤشرات القفز" },
  { symbol: "JD25", display_name: "مؤشر القفز 25", group: "مؤشرات القفز" },
  { symbol: "JD50", display_name: "مؤشر القفز 50", group: "مؤشرات القفز" },
  { symbol: "JD75", display_name: "مؤشر القفز 75", group: "مؤشرات القفز" },
  { symbol: "JD100", display_name: "مؤشر القفز 100", group: "مؤشرات القفز" },
  { symbol: "stpRNG", display_name: "مؤشر الخطوة 100", group: "مؤشرات أخرى" },
  { symbol: "RDBULL", display_name: "الثور الصاعد", group: "مؤشرات أخرى" },
  { symbol: "RDBEAR", display_name: "الدب الهابط", group: "مؤشرات أخرى" },
];

/** Keeps only the symbols the provider actually serves this connection. */
export async function probeAvailableSymbols(): Promise<SymbolInfo[]> {
  const checks = await Promise.all(
    SYNTHETIC_SYMBOLS.map(async (s) => {
      try {
        await deriv().send({
          ticks_history: s.symbol,
          count: 1,
          end: "latest",
          style: "candles",
          granularity: 60,
        });
        return s;
      } catch {
        return null;
      }
    }),
  );
  return checks.filter((s): s is SymbolInfo => s !== null);
}

/** Live candles: seeds with history, then streams updates. */
export function streamCandles(
  symbol: string,
  granularity: number,
  count: number,
  onCandles: (candles: Candle[]) => void,
): () => void {
  let series: Candle[] = [];
  return deriv().subscribe(
    {
      ticks_history: symbol,
      adjust_start_time: 1,
      count,
      end: "latest",
      style: "candles",
      granularity,
    },
    (msg) => {
      if (msg.error) return;
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
}

/** Live tick stream for the price ticker. */
export function streamTicks(
  symbol: string,
  onTick: (t: { epoch: number; quote: number }) => void,
): () => void {
  return deriv().subscribe({ ticks: symbol }, (msg) => {
    if (msg.msg_type === "tick" && msg.tick) {
      onTick({ epoch: msg.tick.epoch, quote: +msg.tick.quote });
    }
  });
}

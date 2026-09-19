import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Activity, BarChart3, ShieldCheck, Wifi, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PriceChart } from "@/components/PriceChart";
import {
  deriv,
  streamCandles,
  streamTicks,
  type Candle,
  type ConnState,
} from "@/lib/deriv";
import { analyze } from "@/lib/indicators";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Deriv Pulse — مؤشر التقلب 50 مباشرة" },
      {
        name: "description",
        content: "سعر حي وتحليل فني احترافي لمؤشر التقلب 50 من Deriv مباشرة، دون محاكاة.",
      },
      { property: "og:title", content: "Deriv Pulse — مؤشر التقلب 50 مباشرة" },
      {
        property: "og:description",
        content: "راقب مؤشر التقلب 50 وحلل الاتجاه والزخم من بيانات Deriv الحية.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

const TIMEFRAMES = [
  { label: "1د", value: 60 },
  { label: "5د", value: 300 },
  { label: "15د", value: 900 },
  { label: "1س", value: 3600 },
];

type Quote = { price: number; previous: number; epoch: number };

const PRIMARY_SYMBOL = "R_50";
const PRIMARY_NAME = "مؤشر التقلب 50";

function Dashboard() {
  const [granularity, setGranularity] = useState(60);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [quote, setQuote] = useState<Quote>();
  const [connection, setConnection] = useState<ConnState>("connecting");
  const [dataError, setDataError] = useState<string | null>(null);

  useEffect(() => deriv().onState(setConnection), []);

  useEffect(() => {
    return streamTicks(PRIMARY_SYMBOL, ({ quote: price, epoch }) => {
      setQuote((current) => ({ price, previous: current?.price ?? price, epoch }));
    });
  }, []);

  useEffect(() => {
    setCandles([]);
    setDataError(null);
    let received = false;
    const stop = streamCandles(PRIMARY_SYMBOL, granularity, 240, (next) => {
      received = true;
      setCandles(next);
      setDataError(null);
    });
    const timeout = window.setTimeout(() => {
      if (!received)
        setDataError("لم تصل بيانات هذا المؤشر بعد. يجري إبقاء الحالة واضحة دون عرض أسعار بديلة.");
    }, 12000);
    return () => {
      window.clearTimeout(timeout);
      stop();
    };
  }, [granularity]);

  const analysis = useMemo(() => analyze(candles), [candles]);
  const visiblePrice = quote?.price ?? candles.at(-1)?.close;

  return (
    <div dir="rtl" className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-md bg-primary text-primary-foreground">
              <Activity className="size-5" />
            </span>
            <div>
              <h1 className="text-base font-bold sm:text-lg">Deriv Pulse</h1>
              <p className="text-[11px] text-muted-foreground">رادار مؤشر التقلب 50 المباشر</p>
            </div>
          </div>
          <div className="status-pill" data-state={connection}>
            {connection === "open" ? (
              <Wifi className="size-3.5" />
            ) : (
              <WifiOff className="size-3.5" />
            )}
            {connection === "open"
              ? "متصل مباشرة بـ Deriv"
              : connection === "connecting"
                ? "جارِ الاتصال"
                : "الاتصال منقطع"}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-4 py-4 sm:px-6 sm:py-6">
        <div className="mx-auto max-w-5xl min-w-0 space-y-4">
            <section className="panel">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-4 sm:p-5">
                <div>
                  <div className="mb-1 flex items-center gap-2">
                    <span className="market-dot" data-live={quote ? "true" : "false"} />
                    <span className="font-mono text-xs text-muted-foreground">{PRIMARY_SYMBOL}</span>
                  </div>
                  <h2 className="text-xl font-bold sm:text-2xl">{PRIMARY_NAME}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    بيانات السوق من Deriv مباشرة
                  </p>
                </div>
                <div className="text-left" dir="ltr">
                  <p className="font-mono text-3xl font-semibold tabular-nums sm:text-4xl">
                    {visiblePrice == null ? "—" : formatPrice(visiblePrice)}
                  </p>
                  <QuoteMove quote={quote} />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <BarChart3 className="size-4 text-primary" />
                  {candles.length > 0
                    ? `${candles.length} شمعة حقيقية`
                    : "بانتظار الشموع الحية"}
                </div>
                <div className="flex gap-1">
                  {TIMEFRAMES.map((frame) => (
                    <Button
                      key={frame.value}
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="chip min-w-10"
                      data-active={granularity === frame.value}
                      onClick={() => setGranularity(frame.value)}
                    >
                      {frame.label}
                    </Button>
                  ))}
                </div>
              </div>

              {dataError ? (
                <div className="m-4 border border-primary/40 bg-primary/5 p-4 text-sm leading-6 text-muted-foreground">
                  {dataError}
                </div>
              ) : (
                <div className="px-2 py-4 sm:px-4">
                  <PriceChart candles={candles} direction={analysis?.direction ?? "neutral"} />
                </div>
              )}
            </section>

            <div className="grid gap-4 xl:grid-cols-[0.9fr_1.4fr]">
              <section className="panel p-4 sm:p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">قراءة الاتجاه</h3>
                  <span className="text-[11px] text-muted-foreground">تحديث لحظي</span>
                </div>
                {analysis ? (
                  <>
                    <div className="signal" data-dir={analysis.direction}>
                      {analysis.direction === "buy"
                        ? "اتجاه صاعد"
                        : analysis.direction === "sell"
                          ? "اتجاه هابط"
                          : "اتجاه محايد"}
                    </div>
                    <div className="mt-4 flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">قوة التوافق</span>
                      <span className="font-mono font-semibold">{analysis.strength}%</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-[width]"
                        style={{ width: `${analysis.strength}%` }}
                      />
                    </div>
                    <ul className="mt-5 space-y-2.5">
                      {analysis.reasons.map((reason) => (
                        <li
                          key={reason.text}
                          className="reason"
                          data-tone={reason.weight > 0 ? "up" : reason.weight < 0 ? "down" : "flat"}
                        >
                          {reason.text}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="py-8 text-center text-sm leading-6 text-muted-foreground">
                    نحتاج إلى 60 شمعة حقيقية على الأقل قبل إصدار قراءة.
                  </p>
                )}
              </section>

              <section className="panel p-4 sm:p-5">
                <h3 className="mb-4 text-sm font-semibold">القياسات الفنية</h3>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                  <Metric label="RSI 14" value={analysis ? analysis.rsi14.toFixed(1) : "—"} />
                  <Metric label="EMA 9" value={analysis ? formatPrice(analysis.ema9) : "—"} />
                  <Metric label="EMA 21" value={analysis ? formatPrice(analysis.ema21) : "—"} />
                  <Metric label="EMA 50" value={analysis ? formatPrice(analysis.ema50) : "—"} />
                  <Metric label="ATR 14" value={analysis ? formatPrice(analysis.atr14) : "—"} />
                  <Metric
                    label="الزخم / 10"
                    value={analysis ? `${signed(analysis.momentumPct)}%` : "—"}
                  />
                </div>
                <div className="mt-5 flex gap-3 border-t border-border pt-4 text-xs leading-6 text-muted-foreground">
                  <ShieldCheck className="mt-1 size-4 shrink-0 text-primary" />
                  <p>
                    كل قراءة محسوبة من شموع Deriv المستلمة فعلياً. التحليل احتمالي وليس ضماناً
                    لنتيجة الصفقة.
                  </p>
                </div>
              </section>
            </div>
        </div>
      </main>
    </div>
  );
}

function QuoteMove({ quote }: { quote: Quote | undefined }) {
  if (!quote) return <p className="mt-1 text-xs text-muted-foreground">بانتظار أول سعر حقيقي</p>;
  const delta = quote.price - quote.previous;
  const pct = quote.previous === 0 ? 0 : (delta / quote.previous) * 100;
  return (
    <p
      className={`mt-1 font-mono text-xs ${delta > 0 ? "text-bull" : delta < 0 ? "text-bear" : "text-muted-foreground"}`}
    >
      {delta > 0 ? "▲" : delta < 0 ? "▼" : "•"} {signed(pct)}% آخر حركة
    </p>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-1.5 truncate font-mono text-base font-semibold tabular-nums" dir="ltr">
        {value}
      </p>
    </div>
  );
}

function formatPrice(value: number) {
  const absolute = Math.abs(value);
  const decimals = absolute >= 100000 ? 2 : absolute >= 1000 ? 3 : absolute >= 100 ? 3 : 4;
  return value.toFixed(decimals);
}

function signed(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(3)}`;
}

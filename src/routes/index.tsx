import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  deriv,
  fetchSyntheticSymbols,
  streamCandles,
  streamTicks,
  type Candle,
  type ConnState,
  type SymbolInfo,
} from "@/lib/deriv";
import { analyze, detectSpikes } from "@/lib/indicators";
import { PriceChart } from "@/components/PriceChart";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "رادار المؤشرات الاصطناعية — إشارات لحظية حقيقية" },
      {
        name: "description",
        content:
          "لوحة تحليل لحظية لمؤشرات التقلب والانفجار والانهيار الاصطناعية، ببيانات أسعار حقيقية مباشرة ومؤشرات فنية محسوبة بشفافية.",
      },
      { property: "og:title", content: "رادار المؤشرات الاصطناعية — إشارات لحظية حقيقية" },
      {
        property: "og:description",
        content: "أسعار مباشرة ومؤشرات فنية محسوبة لحظياً لمؤشرات Volatility و Boom و Crash.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

const TIMEFRAMES = [
  { label: "دقيقة", value: 60 },
  { label: "5 دقائق", value: 300 },
  { label: "15 دقيقة", value: 900 },
  { label: "ساعة", value: 3600 },
];

function pickDefault(symbols: SymbolInfo[]) {
  const preferred = ["R_10", "1HZ10V", "R_25", "BOOM1000", "CRASH1000"];
  for (const p of preferred) if (symbols.some((s) => s.symbol === p)) return p;
  return symbols[0]?.symbol ?? "";
}

function Dashboard() {
  const [conn, setConn] = useState<ConnState>("closed");
  const [symbols, setSymbols] = useState<SymbolInfo[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [active, setActive] = useState("");
  const [granularity, setGranularity] = useState(60);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [tick, setTick] = useState<{ epoch: number; quote: number } | null>(null);

  useEffect(() => deriv().onState(setConn), []);

  useEffect(() => {
    let alive = true;
    fetchSyntheticSymbols()
      .then((list) => {
        if (!alive) return;
        setSymbols(list);
        setActive((cur) => cur || pickDefault(list));
        if (list.length === 0)
          setLoadError(
            "لم تُرجع خوادم البيانات أي مؤشرات اصطناعية لموقعك الحالي. جرّب الاتصال من شبكة/دولة مسموح بها لدى مزوّد البيانات.",
          );
      })
      .catch((e) => alive && setLoadError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    setCandles([]);
    setTick(null);
    const stopC = streamCandles(active, granularity, 500, setCandles);
    const stopT = streamTicks(active, setTick);
    return () => {
      stopC();
      stopT();
    };
  }, [active, granularity]);

  const grouped = useMemo(() => {
    const g = new Map<string, SymbolInfo[]>();
    for (const s of symbols) {
      const key = s.submarket_display_name || "أخرى";
      if (!g.has(key)) g.set(key, []);
      g.get(key)!.push(s);
    }
    return [...g.entries()];
  }, [symbols]);

  const info = symbols.find((s) => s.symbol === active);
  const analysis = useMemo(() => analyze(candles), [candles]);
  const spikeKind: "boom" | "crash" | null = /boom/i.test(active)
    ? "boom"
    : /crash/i.test(active)
      ? "crash"
      : null;
  const spikes = useMemo(
    () => (spikeKind ? detectSpikes(candles, spikeKind) : null),
    [candles, spikeKind],
  );

  const price = tick?.quote ?? analysis?.price;
  const tfLabel = TIMEFRAMES.find((t) => t.value === granularity)?.label ?? "";

  return (
    <div dir="rtl" className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-surface/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div>
            <h1 className="text-lg font-bold tracking-tight">رادار المؤشرات الاصطناعية</h1>
            <p className="text-xs text-muted-foreground">
              أسعار حقيقية مباشرة — كل رقم هنا محسوب من بيانات السوق الفعلية، بلا أي محاكاة
            </p>
          </div>
          <span className="status-pill" data-state={conn}>
            <span className="status-dot" />
            {conn === "open" ? "متصل مباشرة" : conn === "connecting" ? "جارٍ الاتصال" : "غير متصل"}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-6">
        {loadError && (
          <div className="mb-6 rounded-xl border border-bear/40 bg-bear/10 p-4 text-sm text-bear-foreground">
            {loadError}
          </div>
        )}

        <div className="mb-6 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">المؤشر</span>
            <select
              className="field min-w-56"
              value={active}
              onChange={(e) => setActive(e.target.value)}
            >
              {grouped.map(([group, list]) => (
                <optgroup key={group} label={group}>
                  {list.map((s) => (
                    <option key={s.symbol} value={s.symbol}>
                      {s.display_name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">الإطار الزمني</span>
            <div className="flex gap-1.5">
              {TIMEFRAMES.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setGranularity(t.value)}
                  className="chip"
                  data-active={granularity === t.value}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <section className="panel mb-5">
          <div className="flex flex-wrap items-start justify-between gap-4 p-5 pb-0">
            <div>
              <h2 className="text-base font-semibold">{info?.display_name ?? active}</h2>
              <p className="text-xs text-muted-foreground">
                {candles.length > 0
                  ? `${candles.length} شمعة (${tfLabel}) • آخر تحديث ${new Date().toLocaleTimeString("ar-EG")}`
                  : "جارٍ تحميل البيانات..."}
              </p>
            </div>
            <div className="text-left">
              <div className="font-mono text-3xl font-bold tabular-nums">
                {price != null ? price.toFixed(getDecimals(price)) : "—"}
              </div>
              {analysis && (
                <div
                  className="text-sm font-medium"
                  style={{
                    color:
                      analysis.momentumPct >= 0 ? "var(--color-bull)" : "var(--color-bear)",
                  }}
                >
                  {analysis.momentumPct >= 0 ? "▲" : "▼"} {analysis.momentumPct.toFixed(3)}%
                  <span className="text-muted-foreground"> / آخر 10 شموع</span>
                </div>
              )}
            </div>
          </div>
          <div className="px-2 pb-3 pt-4">
            <PriceChart candles={candles} direction={analysis?.direction ?? "neutral"} />
          </div>
        </section>

        <div className="grid gap-5 lg:grid-cols-3">
          <section className="panel p-5 lg:col-span-1">
            <h3 className="mb-3 text-sm font-semibold text-muted-foreground">الإشارة الحالية</h3>
            {analysis ? (
              <>
                <div className="signal" data-dir={analysis.direction}>
                  {analysis.direction === "buy"
                    ? "اتجاه صاعد"
                    : analysis.direction === "sell"
                      ? "اتجاه هابط"
                      : "بدون اتجاه واضح"}
                </div>
                <div className="mt-4">
                  <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
                    <span>قوة الإشارة</span>
                    <span className="font-mono">{analysis.strength}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${analysis.strength}%`,
                        background:
                          analysis.direction === "buy"
                            ? "var(--color-bull)"
                            : analysis.direction === "sell"
                              ? "var(--color-bear)"
                              : "var(--color-muted-foreground)",
                      }}
                    />
                  </div>
                </div>
                <ul className="mt-4 space-y-2">
                  {analysis.reasons.map((r, i) => (
                    <li key={i} className="reason" data-tone={r.weight > 0 ? "up" : r.weight < 0 ? "down" : "flat"}>
                      {r.text}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                بانتظار عدد كافٍ من الشموع الحقيقية لحساب المؤشرات (60 شمعة على الأقل).
              </p>
            )}
          </section>

          <section className="panel p-5 lg:col-span-2">
            <h3 className="mb-3 text-sm font-semibold text-muted-foreground">القراءات الفنية</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Metric label="RSI (14)" value={analysis ? analysis.rsi14.toFixed(1) : "—"} />
              <Metric label="متوسط 9" value={analysis ? analysis.ema9.toFixed(getDecimals(analysis.ema9)) : "—"} />
              <Metric label="متوسط 21" value={analysis ? analysis.ema21.toFixed(getDecimals(analysis.ema21)) : "—"} />
              <Metric label="متوسط 50" value={analysis ? analysis.ema50.toFixed(getDecimals(analysis.ema50)) : "—"} />
              <Metric label="مدى التذبذب ATR" value={analysis ? analysis.atr14.toFixed(4) : "—"} />
              <Metric label="التذبذب %" value={analysis ? `${analysis.atrPct.toFixed(3)}%` : "—"} />
            </div>

            {spikeKind && (
              <div className="mt-5 border-t border-border pt-5">
                <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
                  {spikeKind === "boom" ? "رصد القفزات الصاعدة" : "رصد الانهيارات الهابطة"} — من التاريخ
                  الحقيقي المحمّل
                </h3>
                {spikes ? (
                  <>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Metric label="شموع منذ آخر حدث" value={String(spikes.candlesSinceLast)} highlight />
                      <Metric label="المتوسط بين الأحداث" value={spikes.avgInterval.toFixed(1)} />
                      <Metric label="الوسيط" value={String(spikes.medianInterval)} />
                      <Metric label="عدد الأحداث المرصودة" value={String(spikes.spikeCount)} />
                      <Metric label="أقصر فاصل" value={String(spikes.minInterval)} />
                      <Metric label="أطول فاصل" value={String(spikes.maxInterval)} />
                      <Metric label="متوسط حجم الحدث" value={`${spikes.avgSpikeSizePct.toFixed(2)}%`} />
                      <Metric
                        label="موقع الانتظار الحالي"
                        value={`${spikes.elapsedPercentile.toFixed(0)}%`}
                        highlight
                      />
                    </div>
                    <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                      «موقع الانتظار» يعني: {spikes.elapsedPercentile.toFixed(0)}% من الفواصل السابقة كانت
                      أقصر من فترة الانتظار الحالية. هذه إحصاءات وصفية لما حدث فعلاً في الشموع المحمّلة،
                      وليست تنبؤاً — توقيت الحدث القادم عشوائي بطبيعة هذه المؤشرات.
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    لا توجد أحداث كافية في النافذة الزمنية الحالية. جرّب إطاراً زمنياً أصغر.
                  </p>
                )}
              </div>
            )}
          </section>
        </div>

        <section className="panel mt-5 p-5">
          <h3 className="mb-2 text-sm font-semibold">شفافية كاملة</h3>
          <ul className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
            <li>• جميع الأسعار تصل مباشرة من خوادم مزوّد المؤشرات عبر اتصال لحظي، بلا أي توليد أو محاكاة.</li>
            <li>• كل مؤشر فني (RSI، المتوسطات، ATR) محسوب رياضياً من نفس الشموع المعروضة أمامك.</li>
            <li>
              • الإشارة وصف لحالة السوق الآن، وليست وعداً بالمستقبل. هذه المؤشرات عشوائية بتصميمها، ولا
              توجد أي طريقة تعطي دقة مضمونة في التنبؤ.
            </li>
          </ul>
        </section>
      </main>
    </div>
  );
}

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="metric" data-highlight={highlight ? "true" : undefined}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function getDecimals(v: number) {
  const abs = Math.abs(v);
  if (abs >= 1000) return 2;
  if (abs >= 10) return 3;
  return 4;
}

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import type { Candle } from "@/lib/deriv";
import { analyze } from "@/lib/indicators";
import { PriceChart } from "@/components/PriceChart";
import { Button } from "@/components/ui/button";
import { Download, Radio, Server } from "lucide-react";
import {
  fetchHeadwayCandles,
  HEADWAY_SYMBOLS,
  subscribeToHeadway,
  type HeadwaySymbol,
} from "@/lib/headway";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "رادار المؤشرات الاصطناعية — إشارات لحظية حقيقية" },
      {
        name: "description",
        content:
          "لوحة تحليل لحظية لمؤشري Headway VOL_10 وVOL_20، ببيانات MT5 حقيقية ومؤشرات فنية محسوبة بشفافية.",
      },
      { property: "og:title", content: "رادار المؤشرات الاصطناعية — إشارات لحظية حقيقية" },
      {
        property: "og:description",
        content: "أسعار MT5 مباشرة ومؤشرات فنية محسوبة لحظياً لمؤشري Headway VOL_10 وVOL_20.",
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

function Dashboard() {
  const [active, setActive] = useState<HeadwaySymbol>("VOL_10");
  const [granularity, setGranularity] = useState(60);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [receivedAt, setReceivedAt] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    setCandles([]);
    setReceivedAt(null);
    setLoadError(null);
    const load = async () => {
      try {
        const snapshot = await fetchHeadwayCandles(active, granularity);
        if (!alive) return;
        setCandles(snapshot.candles);
        setReceivedAt(snapshot.receivedAt);
        setLoadError(null);
      } catch (error) {
        if (alive) setLoadError(error instanceof Error ? error.message : "تعذر تحميل البيانات.");
      }
    };
    void load();
    const stop = subscribeToHeadway(active, granularity, () => void load());
    return () => {
      alive = false;
      stop();
    };
  }, [active, granularity]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const info = HEADWAY_SYMBOLS.find((s) => s.symbol === active);
  const analysis = useMemo(() => analyze(candles), [candles]);
  const price = candles.at(-1)?.close;
  const tfLabel = TIMEFRAMES.find((t) => t.value === granularity)?.label ?? "";
  const ageSeconds = receivedAt ? Math.max(0, Math.floor((now - Date.parse(receivedAt)) / 1000)) : null;
  const connectionState = ageSeconds == null ? "closed" : ageSeconds <= 10 ? "open" : "stale";

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
          <span className="status-pill" data-state={connectionState}>
            <span className="status-dot" />
            {connectionState === "open"
              ? "MT5 متصل مباشرة"
              : connectionState === "stale"
                ? `آخر إرسال قبل ${ageSeconds} ثانية`
                : "بانتظار جسر MT5"}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-6">
        {loadError ? (
          <div className="mb-6 rounded-xl border border-bear/40 bg-bear/10 p-4 text-sm text-bear-foreground">
            {loadError}
          </div>
        ) : candles.length === 0 ? (
          <div className="mb-6 border-y border-primary/40 bg-primary/10 px-5 py-5 text-sm leading-7 text-foreground">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="font-semibold">بانتظار أول إرسال حقيقي من Headway MT5</p>
                <p className="text-muted-foreground">لا يعرض التطبيق أي سعر حتى يستلمه فعلياً من حسابك.</p>
              </div>
              <Button asChild>
                <a href="/HeadwayBridge.mq5" download>
                  <Download /> تنزيل جسر MT5
                </a>
              </Button>
            </div>
          </div>
        ) : null}

        <div className="mb-6 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">المؤشر</span>
            <select
              className="field min-w-56"
              value={active}
               onChange={(e) => setActive(e.target.value as HeadwaySymbol)}
            >
              {HEADWAY_SYMBOLS.map((s) => (
                <option key={s.symbol} value={s.symbol}>{s.displayName}</option>
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
               <h2 className="text-base font-semibold">{info?.displayName ?? active}</h2>
              <p className="text-xs text-muted-foreground">
                {candles.length > 0
                   ? `${candles.length} شمعة (${tfLabel}) • آخر استقبال ${receivedAt ? new Date(receivedAt).toLocaleTimeString("ar-EG") : "—"}`
                   : "لا توجد بيانات مستلمة من MT5 بعد"}
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

          </section>
        </div>

        <section className="panel mt-5 p-5">
          <h3 className="mb-2 text-sm font-semibold">شفافية كاملة</h3>
          <ul className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
            <li>• جميع الأسعار تأتي من منصة MT5 المسجّلة في Headway عبر الجسر الخاص بك، بلا أي توليد أو محاكاة.</li>
            <li>• كل مؤشر فني (RSI، المتوسطات، ATR) محسوب رياضياً من نفس الشموع المعروضة أمامك.</li>
            <li>
              • الإشارة وصف لحالة السوق الآن، وليست وعداً بالمستقبل. هذه المؤشرات عشوائية بتصميمها، ولا
              توجد أي طريقة تعطي دقة مضمونة في التنبؤ.
            </li>
          </ul>
        </section>

        <section className="mt-5 border-y border-border bg-surface px-5 py-6">
          <div className="grid gap-5 md:grid-cols-2">
            <div className="flex gap-3">
              <Server className="mt-1 size-5 shrink-0 text-primary" />
              <div>
                <h3 className="font-semibold">تشغيل الجسر مرة واحدة</h3>
                <ol className="mt-2 space-y-1 text-xs leading-6 text-muted-foreground">
                  <li>١. نزّل الملف وافتحه في MetaEditor ثم اضغط Compile.</li>
                  <li>٢. في MT5 أضف رابط التطبيق إلى قائمة WebRequest المسموح بها.</li>
                  <li>٣. شغّل HeadwayBridge وأدخل رمز الربط السري في إعداداته.</li>
                  <li>٤. إن اختلف اسما المؤشرين لدى Headway، اكتبهما كما يظهران في Market Watch.</li>
                </ol>
              </div>
            </div>
            <div className="flex gap-3">
              <Radio className="mt-1 size-5 shrink-0 text-bull" />
              <div>
                <h3 className="font-semibold">شرط استمرار البيانات</h3>
                <p className="mt-2 text-xs leading-6 text-muted-foreground">
                  يجب أن تبقى منصة MT5 مفتوحة ومتصلة بحساب Headway. الأفضل تشغيلها على VPS دائم؛ وستظهر
                  حالة انقطاع واضحة إذا توقف الإرسال، ولن يستبدل التطبيق البيانات المتوقفة بأرقام وهمية.
                </p>
              </div>
            </div>
          </div>
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

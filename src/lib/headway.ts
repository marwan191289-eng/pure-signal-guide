import { supabase } from "@/integrations/supabase/client";
import type { Candle } from "@/lib/deriv";

export type HeadwaySymbol = "VOL_10" | "VOL_20";

export const HEADWAY_SYMBOLS: { symbol: HeadwaySymbol; displayName: string }[] = [
  { symbol: "VOL_10", displayName: "Headway VOL_10" },
  { symbol: "VOL_20", displayName: "Headway VOL_20" },
];

export type HeadwaySnapshot = {
  candles: Candle[];
  receivedAt: string | null;
};

export async function fetchHeadwayCandles(
  symbol: HeadwaySymbol,
  timeframe: number,
): Promise<HeadwaySnapshot> {
  const { data, error } = await supabase
    .from("headway_candles")
    .select("epoch,open,high,low,close,received_at")
    .eq("symbol", symbol)
    .eq("timeframe", timeframe)
    .order("epoch", { ascending: false })
    .limit(500);

  if (error) throw new Error("تعذر قراءة بيانات Headway الحقيقية.");

  const rows = [...(data ?? [])].reverse();
  return {
    candles: rows.map(({ epoch, open, high, low, close }) => ({ epoch, open, high, low, close })),
    receivedAt: rows.at(-1)?.received_at ?? null,
  };
}

export function subscribeToHeadway(
  symbol: HeadwaySymbol,
  timeframe: number,
  onChange: () => void,
) {
  const channel = supabase
    .channel(`headway-${symbol}-${timeframe}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "headway_candles",
        filter: `symbol=eq.${symbol}`,
      },
      (payload) => {
        const row = payload.new as { timeframe?: number };
        if (row.timeframe === timeframe) onChange();
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
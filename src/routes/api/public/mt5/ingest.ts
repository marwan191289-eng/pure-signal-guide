import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const candleSchema = z
  .object({
    symbol: z.enum(["VOL_10", "VOL_20"]),
    timeframe: z.union([z.literal(60), z.literal(300), z.literal(900), z.literal(3600)]),
    epoch: z.number().int().positive(),
    open: z.number().finite(),
    high: z.number().finite(),
    low: z.number().finite(),
    close: z.number().finite(),
    volume: z.number().finite().nonnegative().optional().default(0),
  })
  .refine((c) => c.high >= Math.max(c.open, c.close, c.low), "Invalid high")
  .refine((c) => c.low <= Math.min(c.open, c.close, c.high), "Invalid low");

const payloadSchema = z.object({
  candles: z.array(candleSchema).min(1).max(1000),
});

function constantTimeEqual(a: string, b: string) {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

export const Route = createFileRoute("/api/public/mt5/ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const configuredToken = process.env["MT5_BRIDGE_TOKEN"];
        const authorization = request.headers.get("authorization");
        const suppliedToken = authorization?.startsWith("Bearer ")
          ? authorization.slice(7)
          : "";

        if (!configuredToken) {
          return Response.json({ ok: false, error: "Bridge is not configured" }, { status: 503 });
        }
        if (!suppliedToken || !constantTimeEqual(suppliedToken, configuredToken)) {
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        }

        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
        }

        const parsed = payloadSchema.safeParse(raw);
        if (!parsed.success) {
          return Response.json({ ok: false, error: "Invalid candle payload" }, { status: 422 });
        }

        const now = Math.floor(Date.now() / 1000);
        const oldestAllowed = now - 45 * 24 * 60 * 60;
        if (parsed.data.candles.some((c) => c.epoch < oldestAllowed || c.epoch > now + 300)) {
          return Response.json({ ok: false, error: "Candle timestamp out of range" }, { status: 422 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const receivedAt = new Date().toISOString();
        const { error } = await supabaseAdmin.from("headway_candles").upsert(
          parsed.data.candles.map((c) => ({ ...c, received_at: receivedAt })),
          { onConflict: "symbol,timeframe,epoch" },
        );

        if (error) {
          console.error("MT5 candle ingestion failed", error.message);
          return Response.json({ ok: false, error: "Storage failed" }, { status: 500 });
        }

        return Response.json({ ok: true, accepted: parsed.data.candles.length, receivedAt });
      },
    },
  },
});
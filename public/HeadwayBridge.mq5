#property copyright "Headway Radar"
#property version   "1.00"
#property strict

input string IngestUrl = "https://id-preview--42986da2-0163-42c5-a45c-68700c639944.lovable.app/api/public/mt5/ingest";
input string BridgeToken = "PASTE_THE_SAME_TOKEN_SAVED_IN_THE_APP";
input string HeadwayVol10Symbol = "VOL_10";
input string HeadwayVol20Symbol = "VOL_20";
input int HistoryBars = 500;
input int SendEverySeconds = 3;

ENUM_TIMEFRAMES Frames[] = { PERIOD_M1, PERIOD_M5, PERIOD_M15, PERIOD_H1 };
int FrameSeconds[] = { 60, 300, 900, 3600 };

string JsonEscape(string value)
{
   StringReplace(value, "\\", "\\\\");
   StringReplace(value, "\"", "\\\"");
   return value;
}

bool SendCandles(string brokerSymbol, string publicSymbol, ENUM_TIMEFRAMES timeframe, int seconds)
{
   MqlRates rates[];
   int copied = CopyRates(brokerSymbol, timeframe, 0, HistoryBars, rates);
   if(copied <= 0)
   {
      Print("No rates for ", brokerSymbol, " / ", EnumToString(timeframe), ". Error: ", GetLastError());
      return false;
   }

   int digits = (int)SymbolInfoInteger(brokerSymbol, SYMBOL_DIGITS);
   string body = "{\"candles\":[";
   for(int i = 0; i < copied; i++)
   {
      if(i > 0) body += ",";
      body += StringFormat(
         "{\"symbol\":\"%s\",\"timeframe\":%d,\"epoch\":%I64d,\"open\":%s,\"high\":%s,\"low\":%s,\"close\":%s,\"volume\":%I64d}",
         JsonEscape(publicSymbol), seconds, (long)rates[i].time,
         DoubleToString(rates[i].open, digits), DoubleToString(rates[i].high, digits),
         DoubleToString(rates[i].low, digits), DoubleToString(rates[i].close, digits),
         (long)rates[i].tick_volume
      );
   }
   body += "]}";

   char payload[];
   char response[];
   string responseHeaders;
   StringToCharArray(body, payload, 0, WHOLE_ARRAY, CP_UTF8);
   if(ArraySize(payload) > 0) ArrayResize(payload, ArraySize(payload) - 1);

   string headers = "Content-Type: application/json\r\nAuthorization: Bearer " + BridgeToken + "\r\n";
   ResetLastError();
   int status = WebRequest("POST", IngestUrl, headers, 5000, payload, response, responseHeaders);
   if(status != 200)
   {
      Print("Bridge rejected ", publicSymbol, " / ", seconds, "s. HTTP=", status,
            " MT5 error=", GetLastError(), " response=", CharArrayToString(response));
      return false;
   }
   return true;
}

void PushAll()
{
   string brokers[] = { HeadwayVol10Symbol, HeadwayVol20Symbol };
   string publicNames[] = { "VOL_10", "VOL_20" };
   for(int symbolIndex = 0; symbolIndex < 2; symbolIndex++)
   {
      if(!SymbolSelect(brokers[symbolIndex], true))
      {
         Print("Headway symbol was not found: ", brokers[symbolIndex]);
         continue;
      }
      for(int frameIndex = 0; frameIndex < ArraySize(Frames); frameIndex++)
         SendCandles(brokers[symbolIndex], publicNames[symbolIndex], Frames[frameIndex], FrameSeconds[frameIndex]);
   }
}

int OnInit()
{
   if(BridgeToken == "" || StringFind(BridgeToken, "PASTE_") == 0)
   {
      Print("Set BridgeToken before starting HeadwayBridge.");
      return INIT_PARAMETERS_INCORRECT;
   }
   EventSetTimer(MathMax(1, SendEverySeconds));
   PushAll();
   return INIT_SUCCEEDED;
}

void OnTimer()
{
   PushAll();
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}
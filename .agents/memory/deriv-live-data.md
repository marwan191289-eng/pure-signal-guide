---
name: Deriv live data verification
description: Non-obvious constraints when discovering supported Deriv volatility symbols.
---

Deriv may return an empty `active_symbols` response for the public app session even while individual volatility symbols answer live history requests. Verify the small target catalogue with real `ticks_history` calls instead of treating an empty catalogue as proof that no symbols exist.

**Why:** A catalogue-only check left the dashboard in an indefinite loading state even though direct market data was available.

**How to apply:** Keep the target symbol list explicit, probe each symbol with a real request, and never populate unavailable symbols with fallback prices or candles.
# ⚡ Stadtwerk AI Copilot

**AI-assisted energy analytics for municipal utilities (Stadtwerke) and energy suppliers.**
A Next.js prototype that brings together live German power-market data, renewable generation forecasting, smart-meter load forecasting, a battery storage business case and an LLM copilot. The copilot reads what each dashboard shows and turns it into explanations, workshop material and management briefings.

> Built as a consulting-style demo: the models are deliberately transparent and quick to explain to a client, every number comes from public data, and the AI layer is grounded in the dashboard's data, not free-floating chat.

---

## Modules

| Page | What it does | Consulting use case |
|---|---|---|
| **Market & Grid** | Live EPEX day-ahead prices (DE-LU), load, wind, solar and residual load for the last 7 days plus tomorrow. KPIs, negative-price hours and a **merit-order scatter** (price vs residual load with regression slope). | Market briefings, procurement updates, explaining price drivers in workshops |
| **PV & Wind Forecast** | 72 h physics-based forecast for a configurable PV and wind portfolio at any NRW location, driven by Open-Meteo NWP. Calculates spot revenue, **capture prices and capture rates** (cannibalisation), exposure to negative prices, and a suggested maintenance window. | Renewable asset marketing, direct-marketing (Direktvermarktung) checks, PPA discussions |
| **Load Forecasting** | Upload a 15-min/hourly load profile (CSV, German formats supported) or use the sample grid. Runs a weather-driven **ridge regression** (hour-of-week profile + NRW holidays + heating/cooling degree hours), back-tests against a seasonal-naive benchmark, gives a 7-day forecast with a prediction band, **anomaly detection**, a typical-week heatmap and temperature sensitivity. Exports to Excel (German CSV). | Short-term load forecasting for procurement and balancing groups, smart-meter data analysis, RLM customer analysis |
| **Battery Business Case** | Exact **dynamic-programming** optimisation of battery arbitrage on real day-ahead prices, plus a techno-economic assessment: revenue, cycles, payback and NPV. | First-look storage feasibility for a Stadtwerk, investment committee prep |
| **AI Copilot** (every page) | Groq-hosted LLM (GPT-OSS 120B by default, with automatic fallback to other Groq models) that receives the current page's KPIs and aggregates as context. Suggested questions for each page, a one-click "management briefing", streamed answers, and replies in German or English. | AI assistants for consultants, workshop and training demos, automating report writing |

## Data sources (free, no keys)

- **Energy-Charts API** (Fraunhofer ISE), with data from Bundesnetzagentur | SMARD.de under CC BY 4.0: day-ahead prices and public net generation
- **Open-Meteo** (CC BY 4.0): NWP forecast (tilted irradiance, 120 m wind, temperature) and the ERA5 archive for historical temperatures
- **Groq** (free tier): LLM inference. This is the only thing that needs a key.

If an upstream API can't be reached, the app falls back to clearly labelled synthetic data, so a demo never breaks.

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript · Recharts · plain CSS with light and dark themes · serverless route handlers on Vercel. All modelling (regression, DP optimiser, physical models) is dependency-free TypeScript in `lib/`.

```
app/
  page.tsx               Market & Grid
  generation/page.tsx    PV & Wind Forecast
  load/page.tsx          Load Forecasting
  battery/page.tsx       Battery Business Case
  api/market/route.ts    Energy-Charts proxy (hourly aggregation, CDN-cached 15 min)
  api/weather/route.ts   Open-Meteo proxy (forecast + archive stitching)
  api/chat/route.ts      Groq streaming proxy with model fallback
components/              Copilot panel, context provider, UI kit, chart hooks
lib/
  energyCharts.ts        market data client
  weather.ts             weather client
  generation.ts          PV (POA irradiance + Ross temperature model) & wind (power curve, shear)
  loadModel.ts           holidays, features, ridge regression, back-test, anomalies, sample generator
  battery.ts             DP arbitrage optimiser
  csv.ts                 robust CSV import / German Excel export
```

## Run locally

```bash
npm install
cp .env.example .env.local    # add GROQ_API_KEY (free at https://console.groq.com/keys)
npm run dev                   # http://localhost:3000
```

The dashboards work without a key. Only the copilot needs one.

## Deploy to Vercel

1. Push this folder to a GitHub repository.
2. On [vercel.com/new](https://vercel.com/new), import the repo. The framework is detected as Next.js, so no settings need changing.
3. Under **Settings → Environment Variables**, add `GROQ_API_KEY`. `GROQ_MODEL` is optional.
4. Deploy. If you add the key after the first deploy, redeploy once so it takes effect.

## Modelling notes & limitations

- **PV:** `P = P_STC · G_POA/1000 · PR · (1 + γ(T_cell − 25))`, with T_cell = T_amb + 0.03·G and γ = −0.37 %/K.
- **Wind:** 120 m wind is scaled to hub height with a power law (α = 0.14). The generic power curve uses cut-in 3 m/s, rated 12.5 m/s and cut-out 25 m/s, with 10 % losses.
- **Load:** a linear model, chosen for explainability and browser speed. The back-test MAPE is shown honestly against a naive benchmark. Production upgrades would be gradient boosting with lags, school holidays and probabilistic scoring.
- **Battery:** perfect foresight on day-ahead prices only, annualised linearly. Read it as an upper bound for spot arbitrage. Balancing (FCR/aFRR), intraday and grid-fee revenues are not modelled.
- Prices are hourly averages of the 15-minute day-ahead auction.

## Possible extensions

Intraday and balancing revenue stacking · school holidays and solar features for prosumer grids · LLM tool-calling, so the copilot can run scenarios itself (e.g. "re-run the battery case at 2 h duration") · PDF/PowerPoint export of copilot briefings · multi-site portfolios.

---

*Portfolio prototype, not investment advice.*

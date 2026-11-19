export type DataSource = "live" | "synthetic";

/** One hour of German grid & market data (power in GW, price in €/MWh). */
export type MarketHour = {
  t: number;
  price: number | null;
  load: number | null;
  solar: number | null;
  wind: number | null;
  residual: number | null;
  renShare: number | null;
};

export type MarketData = {
  source: DataSource;
  note?: string;
  generatedAt: number;
  hours: MarketHour[];
};

export type WeatherHour = {
  t: number;
  temp: number;
  /** global tilted irradiance on the module plane, W/m² */
  gti?: number;
  /** global horizontal irradiance, W/m² */
  ghi?: number;
  /** wind speed at 120 m, m/s */
  wind?: number;
  cloud?: number;
};

export type WeatherData = {
  source: DataSource;
  note?: string;
  hours: WeatherHour[];
};

export type ChatMessage = { role: "user" | "assistant"; content: string };

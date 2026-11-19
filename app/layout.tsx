import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { CopilotProvider } from "@/components/CopilotProvider";
import { Copilot } from "@/components/Copilot";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: "Stadtwerk AI Copilot",
  description:
    "AI copilot & analytics for municipal utilities: German power market, PV & wind forecasts, load forecasting and battery business cases.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#121923" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <CopilotProvider>
          <Nav />
          <main className="container">
            {children}
            <footer className="footer">
              Data: Energy-Charts / Fraunhofer ISE (Bundesnetzagentur | SMARD.de, CC BY 4.0) · Weather: Open-Meteo.com
              (CC BY 4.0) · AI: Groq. Portfolio prototype — models are simplified and not investment advice.
            </footer>
          </main>
          <Copilot />
        </CopilotProvider>
      </body>
    </html>
  );
}

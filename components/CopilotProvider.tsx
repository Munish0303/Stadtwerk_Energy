"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type CopilotContextData = {
  page: string;
  prompts: string[];
  data: unknown;
};

type Ctx = {
  context: CopilotContextData;
  setContext: (c: CopilotContextData) => void;
  open: boolean;
  setOpen: (o: boolean) => void;
  /** queue a question to be asked as soon as the panel opens */
  ask: (q: string) => void;
  pending: string | null;
  clearPending: () => void;
};

const DEFAULT: CopilotContextData = { page: "Dashboard", prompts: [], data: null };
const CopilotCtx = createContext<Ctx | null>(null);

export function CopilotProvider({ children }: { children: React.ReactNode }) {
  const [context, setContext] = useState<CopilotContextData>(DEFAULT);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const value = useMemo<Ctx>(
    () => ({
      context,
      setContext,
      open,
      setOpen,
      pending,
      ask: (q) => {
        setPending(q);
        setOpen(true);
      },
      clearPending: () => setPending(null),
    }),
    [context, open, pending],
  );
  return <CopilotCtx.Provider value={value}>{children}</CopilotCtx.Provider>;
}

export function useCopilot() {
  const c = useContext(CopilotCtx);
  if (!c) throw new Error("useCopilot must be used inside CopilotProvider");
  return c;
}

/** Register what the current page shows so the copilot can reason over it. */
export function useCopilotData(page: string, prompts: string[], data: unknown) {
  const { setContext } = useCopilot();
  const key = JSON.stringify(data);
  useEffect(() => {
    setContext({ page, prompts, data });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, key]);
}

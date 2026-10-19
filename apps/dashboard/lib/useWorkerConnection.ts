"use client";

// Live wa_connection row (Realtime) plus a clock that ticks every 5 s, so "last seen" and the
// 60 s offline rule update even when no new row arrives (api-interfaces.md §2.2).
import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";

export type WorkerConnection = {
  status: string;
  linked_phone_e164: string | null;
  last_heartbeat_at: string | null;
  last_connected_at: string | null;
  last_error: string | null;
};

const COLUMNS = "status, linked_phone_e164, last_heartbeat_at, last_connected_at, last_error";
const TICK_MS = 5_000;

export function useWorkerConnection(initial: WorkerConnection | null = null) {
  const [row, setRow] = useState<WorkerConnection | null>(initial);
  const [loaded, setLoaded] = useState(initial !== null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    void supabase
      .from("wa_connection")
      .select(COLUMNS)
      .eq("id", 1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) console.error("wa_connection read failed", error);
        else setRow(data);
        setLoaded(true);
      });

    const channel = supabase
      .channel(`wa-connection-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "wa_connection" },
        (payload) => {
          setRow(payload.new as WorkerConnection);
          setNow(Date.now());
        },
      )
      .subscribe();

    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => {
      active = false;
      clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, []);

  return { row, loaded, now };
}

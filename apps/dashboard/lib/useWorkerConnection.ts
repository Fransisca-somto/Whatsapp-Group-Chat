"use client";

// Live wa_connection row (Realtime) plus a clock that ticks every 5 s, so "last seen" and the
// 60 s offline rule update even when no new row arrives (api-interfaces.md §2.2). The row is
// also re-read every 30 s, so a missed Realtime event or a failed first read heals itself;
// while the latest read has failed, `readFailed` is true and the badge shows "Unknown".
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
export const REFRESH_MS = 30_000;

export function useWorkerConnection(initial: WorkerConnection | null = null) {
  const [row, setRow] = useState<WorkerConnection | null>(initial);
  const [loaded, setLoaded] = useState(initial !== null);
  const [readFailed, setReadFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    const read = async () => {
      try {
        const { data, error } = await supabase
          .from("wa_connection")
          .select(COLUMNS)
          .eq("id", 1)
          .maybeSingle();
        if (!active) return;
        if (error) {
          console.error("wa_connection read failed", error);
          setReadFailed(true);
        } else {
          setRow(data);
          setReadFailed(false);
        }
      } catch (error) {
        // supabase-js reports most failures in `error`; a thrown network error lands here.
        if (!active) return;
        console.error("wa_connection read failed", error);
        setReadFailed(true);
      } finally {
        if (active) {
          setLoaded(true);
          setNow(Date.now());
        }
      }
    };
    void read();

    const channel = supabase
      .channel(`wa-connection-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "wa_connection" },
        (payload) => {
          setRow(payload.new as WorkerConnection);
          setReadFailed(false);
          setNow(Date.now());
        },
      )
      .subscribe();

    const tick = setInterval(() => setNow(Date.now()), TICK_MS);
    const refresh = setInterval(() => void read(), REFRESH_MS);
    return () => {
      active = false;
      clearInterval(tick);
      clearInterval(refresh);
      void supabase.removeChannel(channel);
    };
  }, []);

  return { row, loaded, readFailed, now };
}

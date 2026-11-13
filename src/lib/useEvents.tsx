import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { API_BASE } from "@/lib/api";

export type ConnectionState = "online" | "connecting" | "offline";

interface EventsContextValue {
  connState: ConnectionState;
  recentEvents: any[];
  lastTaskUpdate: any | null;
}

const EventsContext = createContext<EventsContextValue>({
  connState: "offline",
  recentEvents: [],
  lastTaskUpdate: null,
});

export const EventsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [connState, setConnState] = useState<ConnectionState>("offline");
  const [recentEvents, setRecentEvents] = useState<any[]>([]);
  const [lastTaskUpdate, setLastTaskUpdate] = useState<any | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<any>(null);

  const connect = useCallback(() => {
    const token = localStorage.getItem("snapgen_media_token") || localStorage.getItem("snapgen_token");
    if (!token) {
      setConnState("offline");
      return;
    }

    if (esRef.current) {
      esRef.current.close();
    }

    setConnState("connecting");
    const es = new EventSource(`${API_BASE}/api/events?token=${encodeURIComponent(token)}`);
    esRef.current = es;

    es.onopen = () => {
      setConnState("online");
    };

    es.addEventListener("ping", () => {
      setConnState("online");
    });

    es.addEventListener("task_update", (e) => {
      try {
        const data = JSON.parse(e.data);
        setLastTaskUpdate(data);
        setRecentEvents((prev) => [data, ...prev].slice(0, 50));
      } catch (err) {
        console.error("Failed to parse task_update", err);
      }
    });

    es.onerror = () => {
      // EventSource automatically reconnects when readyState is CONNECTING (0)
      if (es.readyState === EventSource.CONNECTING) {
        return;
      }
      setConnState("offline");
      es.close();
      // Reconnect after 3 seconds if permanently closed
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, 3000);
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (esRef.current) esRef.current.close();
      clearTimeout(reconnectTimeoutRef.current);
    };
  }, [connect]);

  return (
    <EventsContext.Provider value={{ connState, recentEvents, lastTaskUpdate }}>
      {children}
    </EventsContext.Provider>
  );
};

export const useEventsCtx = () => useContext(EventsContext);

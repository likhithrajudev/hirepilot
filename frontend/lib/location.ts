"use client";

import { useCallback, useEffect, useState } from "react";

const KEY = "hp_locations";
const DETECTED = "hp_detected_city";

export const POPULAR_CITIES = [
  "Bengaluru", "Hyderabad", "Pune", "Mumbai", "Delhi", "Gurugram", "Chennai",
  "San Francisco", "New York", "Seattle", "Austin", "London", "Toronto", "Singapore", "Dublin", "Berlin",
];

const read = <T,>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
};
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};

/** City from coordinates (client-side, no key needed). Falls back to approximate IP location. */
async function detectCity(): Promise<string | null> {
  const fromCoords = (): Promise<string | null> =>
    new Promise((resolve) => {
      if (!("geolocation" in navigator)) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try {
            const r = await fetch(
              `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${pos.coords.latitude}&longitude=${pos.coords.longitude}&localityLanguage=en`,
            );
            const j = await r.json();
            resolve(j.city || j.locality || null);
          } catch {
            resolve(null);
          }
        },
        () => resolve(null),
        { timeout: 8000, maximumAge: 3_600_000 },
      );
    });
  const city = await fromCoords();
  if (city) return city;
  try {
    const r = await fetch("https://ipwho.is/");
    const j = await r.json();
    return j.success ? j.city || null : null;
  } catch {
    return null;
  }
}

/** Selected search cities (persisted) plus a detected "you are here" city. */
export function useLocations() {
  const [selected, setSelected] = useState<string[]>([]);
  const [detected, setDetected] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSelected(read<string[]>(KEY, []));
    setDetected(read<string | null>(DETECTED, null));
    setReady(true);
  }, []);

  const persist = useCallback((next: string[]) => {
    setSelected(next);
    write(KEY, next);
  }, []);

  const detect = useCallback(async () => {
    setDetecting(true);
    const city = await detectCity();
    setDetecting(false);
    if (city) {
      setDetected(city);
      write(DETECTED, city);
      setSelected((cur) => {
        const next = cur.some((c) => c.toLowerCase() === city.toLowerCase()) ? cur : [city, ...cur];
        write(KEY, next);
        return next;
      });
    }
    return city;
  }, []);

  // First visit: detect automatically and make it the default search city.
  useEffect(() => {
    if (ready && !detected && selected.length === 0) void detect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const toggle = (c: string) =>
    persist(selected.some((s) => s.toLowerCase() === c.toLowerCase()) ? selected.filter((s) => s.toLowerCase() !== c.toLowerCase()) : [...selected, c]);

  return { selected, detected, detecting, ready, toggle, add: (c: string) => c.trim() && !selected.includes(c.trim()) && persist([...selected, c.trim()]), detect, clear: () => persist([]) };
}

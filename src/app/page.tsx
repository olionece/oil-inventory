"use client";
import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { Auth } from "@supabase/auth-ui-react";
import { ThemeSupa } from "@supabase/auth-ui-shared";

// ------------------------------------------------------------
// OIL INVENTORY — Next.js App Router (src/app/page.tsx)
// Versione multi-utente con Supabase Auth + persistenza su DB
// ------------------------------------------------------------

// ---- Tipi ---------------------------------------------------
type Warehouse = { id: string; name: string };
type Format = "500ml" | "250ml" | "5L";
type Lot = "A" | "B" | "C";

interface ItemKey {
  year: number;
  lot: Lot;
  format: Format;
  warehouseId: string;
}

// ---- Supabase -----------------------------------------------
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ---- Costanti -----------------------------------------------
const DEFAULT_WAREHOUSES: Warehouse[] = [
  { id: "roma", name: "Roma" },
  { id: "neci", name: "Neci" },
];

const LOTS: Lot[] = ["A", "B", "C"];
const FORMATS: Format[] = ["500ml", "250ml", "5L"];

// ---- Helper -------------------------------------------------
function keyOf(k: ItemKey) {
  return `${k.year}_${k.lot}_${k.format}_${k.warehouseId}`;
}
function parseKey(s: string): ItemKey | null {
  const [yearStr, lot, format, warehouseId] = s.split("_");
  const year = Number(yearStr);
  if (!year || !lot || !format || !warehouseId) return null;
  return { year, lot: lot as Lot, format: format as Format, warehouseId };
}
function csvEscape(v: string | number) {
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
}

// ---- Pagina -------------------------------------------------
export default function OilInventoryPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>(DEFAULT_WAREHOUSES);
  const [years, setYears] = useState<number[]>([new Date().getFullYear()]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [filterYear, setFilterYear] = useState<number | "all">("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  // ---- Auth state -------------------------------------------
  useEffect(() => {
    let subscribed = true;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!subscribed) return;
      setUserId(data.user?.id ?? null);
      setLoading(false);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => {
      subscribed = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // ---- Load dal DB quando loggato ---------------------------
  useEffect(() => {
    if (!userId) return;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("inventory")
        .select("year, lot, format, warehouse_id, qty")
        .order("year", { ascending: false });

      if (error) {
        console.error(error);
        setLoading(false);
        return;
      }
      const next: Record<string, number> = {};
      const nextYears = new Set<number>();
      for (const row of data || []) {
        const { year, lot, format, warehouse_id, qty } = row as any;
        next[keyOf({ year, lot, format, warehouseId: warehouse_id })] = qty;
        nextYears.add(year);
      }
      setQuantities(next);
      if (nextYears.size > 0) setYears(Array.from(nextYears).sort((a, b) => b - a));
      setLoading(false);
    })();
  }, [userId]);

  // ---- Tabelle / Totali -------------------------------------
  const rows = useMemo(() => {
    const makeRows: Array<{
      year: number;
      lot: Lot;
      format: Format;
      totals: Record<string, number>;
    }> = [];

    for (const year of years.slice().sort((a, b) => b - a)) {
      for (const lot of LOTS) {
        for (const format of FORMATS) {
          const totals: Record<string, number> = {};
          for (const w of warehouses) {
            const q = quantities[keyOf({ year, lot, format, warehouseId: w.id })] || 0;
            totals[w.id] = q;
          }
          makeRows.push({ year, lot, format, totals });
        }
      }
    }

    let filtered = makeRows;
    if (filterYear !== "all") filtered = filtered.filter((r) => r.year === filterYear);

    if (search.trim()) {
      const s = search.trim().toLowerCase();
      filtered = filtered.filter(
        (r) =>
          String(r.year).includes(s) ||
          r.lot.toLowerCase().includes(s) ||
          r.format.toLowerCase().includes(s)
      );
    }

    return filtered;
  }, [years, warehouses, quantities, filterYear, search]);

  const grandTotals = useMemo(() => {
    const byWarehouse: Record<string, number> = {};
    for (const w of warehouses) byWarehouse[w.id] = 0;
    for (const k in quantities) {
      const parsed = parseKey(k);
      if (!parsed) continue;
      if (filterYear !== "all" && parsed.year !== filterYear) continue;
      byWarehouse[parsed.warehouseId] += quantities[k] || 0;
    }
    return byWarehouse;
  }, [quantities, warehouses, filterYear]);

  // ---- Persistenza ------------------------------------------
  async function persistQty(k: ItemKey, qty: number) {
    const { error } = await supabase.from("inventory").upsert({
      year: k.year,
      lot: k.lot,
      format: k.format,
      warehouse_id: k.warehouseId,
      qty,
    });
    if (error) console.error("Errore upsert:", error);
  }

  function setQty(k: ItemKey, next: number) {
    const q = Math.max(0, Math.floor(next));
    setQuantities((prev) => ({ ...prev, [keyOf(k)]: q }));
    persistQty(k, q);
  }

  function adjust(k: ItemKey, delta: number) {
    const curr = quantities[keyOf(k)] || 0;
    setQty(k, curr + delta);
  }

  // ---- UI: gestione anni/magazzini --------------------------
  function addYear() {
    const y = prompt("Aggiungi anno (es. 2025)");
    if (!y) return;
    const n = Number(y);
    if (!n || n < 2000 || n > 2100) return alert("Anno non valido");
    setYears((prev) => Array.from(new Set([...prev, n])).sort((a, b) => b - a));
  }

  function addWarehouse() {
    const name = prompt("Nome magazzino");
    if (!name) return;
    const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
    if (!id) return alert("Nome non valido");
    if (warehouses.find((w) => w.id === id)) return alert("Magazzino già presente");
    setWarehouses((prev) => [...prev, { id, name: name.trim() }]);
  }

  function renameWarehouse(id: string) {
    const w = warehouses.find((w) => w.id === id);
    if (!w) return;
    const name = prompt("Rinomina magazzino", w.name);
    if (!name) return;
    setWarehouses((prev) => prev.map((x) => (x.id === id ? { ...x, name } : x)));
  }

  function deleteWarehouse(id: string) {
    if (!confirm("Eliminare questo magazzino? I dati resteranno nel DB ma non saranno mostrati.")) return;
    setWarehouses((prev) => prev.filter((w) => w.id !== id));
  }

  // ---- Import/Export ----------------------------------------
  function exportCSV() {
    const headers = ["year", "lot", "format", "warehouse", "qty"];
    const lines = [headers.join(",")];
    for (const k in quantities) {
      const p = parseKey(k);
      if (!p) continue;
      lines.push([p.year, p.lot, p.format, p.warehouseId, quantities[k]].map(csvEscape).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "oil-inventory.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function importCSV(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const text = String(reader.result || "");
        const lines = text.split(/\r?\n/).filter(Boolean);
        const [header, ...rows] = lines;
        const cols = header.split(",").map((s) => s.trim());
        const colIdx = (name: string) => cols.findIndex((c) => c === name);
        const iYear = colIdx("year");
        const iLot = colIdx("lot");
        const iFormat = colIdx("format");
        const iWh = colIdx("warehouse");
        const iQty = colIdx("qty");
        if ([iYear, iLot, iFormat, iWh, iQty].some((i) => i < 0))
          throw new Error("Colonne richieste: year, lot, format, warehouse, qty");

        const ups: any[] = [];
        const next: Record<string, number> = { ...quantities };
        const nextYears = new Set(years);

        for (const r of rows) {
          const cells = r.split(",");
          const year = Number(cells[iYear]);
          const lot = cells[iLot] as Lot;
          const format = cells[iFormat] as Format;
          const warehouseId = cells[iWh];
          const qty = Number(cells[iQty]);
          if (!year || !lot || !format || !warehouseId || isNaN(qty)) continue;

          const qv = Math.max(0, Math.floor(qty));
          next[keyOf({ year, lot, format, warehouseId })] = qv;
          nextYears.add(year);
          ups.push({ year, lot, format, warehouse_id: warehouseId, qty: qv });
        }

        setQuantities(next);
        setYears(Array.from(nextYears).sort((a, b) => b - a));

        if (ups.length) {
          const { error } = await supabase
            .from("inventory")
            .upsert(ups, { onConflict: "year,lot,format,warehouse_id" });
          if (error) throw error;
        }
        alert("Importazione completata");
      } catch (e: any) {
        alert("Errore importazione: " + e.message);
      } finally {
        ev.target.value = "";
      }
    };
    reader.readAsText(file);
  }

  // ---- Rendering --------------------------------------------
  if (loading) {
    return (
      <div style={{ padding: 24, maxWidth: 800, margin: "0 auto", fontFamily: "ui-sans-serif, system-ui, -apple-system" }}>
        <p>Caricamento…</p>
      </div>
    );
  }

  if (!userId) {
    return (
      <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ width: 420, maxWidth: "100%" }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 12, textAlign: "center" }}>
            Accedi per gestire il magazzino
          </h1>
          <Auth
            supabaseClient={supabase}
            appearance={{ theme: ThemeSupa }}
            providers={["github", "google"]}
            redirectTo={typeof window !== "undefined" ? window.location.origin : undefined}
            magicLink
          />
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: "0 auto", fontFamily: "ui-sans-serif, system-ui, -apple-system" }}>
      <header style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800 }}>Gestione Magazzino Olio</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={addYear} style={btn}>+ Anno</button>
          <button onClick={addWarehouse} style={btn}>+ Magazzino</button>
          <button onClick={exportCSV} style={btn}>Esporta CSV</button>
          <label style={{ ...btn, cursor: "pointer" }}>
            Importa CSV
            <input type="file" accept=".csv" onChange={importCSV} style={{ display: "none" }} />
          </label>
          <button onClick={() => supabase.auth.signOut()} style={btn}>Esci</button>
        </div>
      </header>

      <section style={card}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <div>
            <label style={label}>Filtro anno</label>
            <select
              value={String(filterYear)}
              onChange={(e) => setFilterYear(e.target.value === "all" ? "all" : Number(e.target.value))}
              style={input}
            >
              <option value="all">Tutti</option>
              {years.slice().sort((a, b) => b - a).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={label}>Cerca</label>
            <input
              placeholder="2025, A, 500ml…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={input}
            />
          </div>
        </div>
      </section>

      <section style={{ ...card, overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={th}>Anno</th>
              <th style={th}>Lotto</th>
              <th style={th}>Formato</th>
              {warehouses.map((w) => (
                <th key={w.id} style={th}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span>{w.name}</span>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button title="Rinomina" onClick={() => renameWarehouse(w.id)} style={miniBtn}>✏️</button>
                      <button title="Rimuovi" onClick={() => deleteWarehouse(w.id)} style={miniBtn}>🗑️</button>
                    </div>
                  </div>
                </th>
              ))}
              <th style={th}>Totale Riga</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const rowTotal = warehouses.reduce((sum, w) => sum + (r.totals[w.id] || 0), 0);
              return (
                <tr key={idx}>
                  <td style={td}>{r.year}</td>
                  <td style={td}>{r.lot}</td>
                  <td style={td}>{r.format}</td>
                  {warehouses.map((w) => {
                    const k: ItemKey = { year: r.year, lot: r.lot, format: r.format, warehouseId: w.id };
                    const v = r.totals[w.id] || 0;
                    return (
                      <td key={w.id} style={{ ...td, whiteSpace: "nowrap" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <button onClick={() => adjust(k, -1)} style={miniBtn}>−</button>
                          <input
                            type="number"
                            min={0}
                            value={v}
                            onChange={(e) => setQty(k, Number(e.target.value))}
                            style={{ ...input, width: 90, padding: "6px 8px" }}
                          />
                          <button onClick={() => adjust(k, +1)} style={miniBtn}>+</button>
                        </div>
                      </td>
                    );
                  })}
                  <td style={{ ...td, fontWeight: 600 }}>{rowTotal}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td style={tf} colSpan={3}>Totali per Magazzino</td>
              {warehouses.map((w) => (
                <td key={w.id} style={tf}>{grandTotals[w.id] || 0}</td>
              ))}
              <td style={{ ...tf, fontWeight: 800 }}>
                {Object.values(grandTotals).reduce((a, b) => a + b, 0)}
              </td>
            </tr>
          </tfoot>
        </table>
      </section>

      <p style={{ fontSize: 12, color: "#666", marginTop: 12 }}>
        ✅ Dati salvati su Supabase. Tutti gli utenti autenticati condividono lo stesso inventario
        (in seguito possiamo aggiungere team/ruoli per separarli).
      </p>
    </div>
  );
}

// ---- Stili inline semplici ----------------------------------
const btn: React.CSSProperties = {
  border: "1px solid #ddd",
  background: "#fff",
  borderRadius: 10,
  padding: "8px 12px",
  fontWeight: 600,
  cursor: "pointer",
};

const miniBtn: React.CSSProperties = {
  border: "1px solid #ddd",
  background: "#fff",
  borderRadius: 8,
  padding: "4px 8px",
  fontWeight: 700,
  cursor: "pointer",
};

const input: React.CSSProperties = {
  border: "1px solid #ccc",
  borderRadius: 8,
  padding: "8px 10px",
};

const label: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  color: "#666",
  marginBottom: 4,
};

const card: React.CSSProperties = {
  border: "1px solid #eee",
  borderRadius: 12,
  padding: 16,
  background: "#fafafa",
  marginBottom: 16,
};

const th: React.CSSProperties = {
  textAlign: "left",
  padding: 10,
  fontSize: 12,
  color: "#666",
  borderBottom: "1px solid #eee",
  position: "sticky" as const,
  top: 0,
  background: "#fafafa",
  zIndex: 1,
};

const td: React.CSSProperties = {
  padding: 10,
  borderBottom: "1px solid #f0f0f0",
};

const tf: React.CSSProperties = {
  padding: 10,
  borderTop: "2px solid #ddd",
  background: "#f9f9f9",
};

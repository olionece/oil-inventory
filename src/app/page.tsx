"use client";
import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { Auth } from "@supabase/auth-ui-react";
import { ThemeSupa } from "@supabase/auth-ui-shared";

type Warehouse = { id: string; name: string };
type Format = "500ml" | "250ml" | "5L";
type Lot = "A" | "B" | "C";

interface ItemKey {
  year: number;
  lot: Lot;
  format: Format;
  warehouseId: string;
}

type Role = "owner" | "editor" | "viewer";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const DEFAULT_WAREHOUSES: Warehouse[] = [
  { id: "roma", name: "Roma" },
  { id: "neci", name: "Neci" },
];
const LOTS: Lot[] = ["A", "B", "C"];
const FORMATS: Format[] = ["500ml", "250ml", "5L"];
const STORAGE_TEAM = "oil-inventory-selected-team";

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

export default function Page() {
  const [userId, setUserId] = useState<string | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);

  const [teams, setTeams] = useState<Array<{ id: string; name: string; role: Role }>>([]);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [loadingTeams, setLoadingTeams] = useState(true);

  const [warehouses, setWarehouses] = useState<Warehouse[]>(DEFAULT_WAREHOUSES);
  const [years, setYears] = useState<number[]>([new Date().getFullYear()]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [filterYear, setFilterYear] = useState<number | "all">("all");
  const [search, setSearch] = useState("");
  const [loadingInventory, setLoadingInventory] = useState(false);

  // ---------- AUTH ----------
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!mounted) return;
      setUserId(data.user?.id ?? null);
      setLoadingAuth(false);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // ---------- TEAMS: load my memberships ----------
  useEffect(() => {
    if (!userId) return;
    setLoadingTeams(true);
    (async () => {
      // prendo le membership con join al team
      const { data, error } = await supabase
        .from("team_members")
        .select("role, team_id, teams ( id, name )")
        .eq("user_id", userId);
      if (error) {
        console.error(error);
        setTeams([]);
        setLoadingTeams(false);
        return;
      }
      const mapped =
        (data || []).map((row: any) => ({
          id: row.teams.id as string,
          name: row.teams.name as string,
          role: row.role as Role,
        })) ?? [];
      setTeams(mapped);

      // ripristina selezione team da localStorage se valido
      const saved = typeof window !== "undefined" ? localStorage.getItem(STORAGE_TEAM) : null;
      const exists = mapped.find((t) => t.id === saved);
      const pick = exists ? exists.id : mapped[0]?.id ?? null;
      setTeamId(pick || null);
      if (pick && typeof window !== "undefined") localStorage.setItem(STORAGE_TEAM, pick);

      setLoadingTeams(false);
    })();
  }, [userId]);

  // ---------- INVENTORY: load when team changes ----------
useEffect(() => {
  if (!userId || !teamId) return;
  (async () => {
    setLoadingInventory(true);
    try {
      const { data, error } = await supabase
        .from("inventory")
        .select("year, lot, format, warehouse_id, qty")
        .eq("team_id", teamId)
        .order("year", { ascending: false })
        .throwOnError(); // forza l’errore “vero”

      console.log("[INV FETCH]", {
        userId,
        teamId,
        rows: data?.length ?? 0,
        error: error ? (error.message || error) : null,
      });

      if (error) {
        // vediamo OGNI dettaglio in console
        console.error("Inventory error:", error?.message || error, error);
        setLoadingInventory(false);
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
    } catch (e: any) {
      // catch aggiuntivo in caso di throwOnError
      console.error("Inventory exception:", e?.message || e, e);
    } finally {
      setLoadingInventory(false);
    }
  })();
}, [userId, teamId]);

  // ---- Team actions ----
  async function createTeam() {
    const name = prompt("Nome nuovo team");
    if (!name) return;
    // crea team (owner = auth.uid())
    const { data: tData, error: tErr } = await supabase
      .from("teams")
      .insert({ name, owner_user_id: userId })
      .select("id")
      .single();
    if (tErr) return alert("Errore creazione team: " + tErr.message);

    const newTeamId = tData!.id as string;

    // aggiungi membership per l'owner
    const { error: mErr } = await supabase
      .from("team_members")
      .insert({ team_id: newTeamId, user_id: userId, role: "owner" });
    if (mErr) return alert("Errore membership: " + mErr.message);

    // ricarica lista teams
    const { data, error } = await supabase
      .from("team_members")
      .select("role, team_id, teams ( id, name )")
      .eq("user_id", userId);
    if (!error) {
      const mapped =
        (data || []).map((row: any) => ({
          id: row.teams.id as string,
          name: row.teams.name as string,
          role: row.role as Role,
        })) ?? [];
      setTeams(mapped);
      setTeamId(newTeamId);
      if (typeof window !== "undefined") localStorage.setItem(STORAGE_TEAM, newTeamId);
    }
  }

  function onSelectTeam(id: string) {
    setTeamId(id);
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_TEAM, id);
  }

  // ---- Import/Export ----
  function exportCSV() {
    const headers = ["team_id", "year", "lot", "format", "warehouse", "qty"];
    const lines = [headers.join(",")];
    for (const k in quantities) {
      const p = parseKey(k);
      if (!p || !teamId) continue;
      lines.push([teamId, p.year, p.lot, p.format, p.warehouseId, quantities[k]].map(csvEscape).join(","));
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
    if (!file || !teamId) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const text = String(reader.result || "");
        const lines = text.split(/\r?\n/).filter(Boolean);
        const [header, ...rows] = lines;
        const cols = header.split(",").map((s) => s.trim());
        const iYear = cols.indexOf("year");
        const iLot = cols.indexOf("lot");
        const iFormat = cols.indexOf("format");
        const iWh = cols.indexOf("warehouse");
        const iQty = cols.indexOf("qty");
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
          const warehouse_id = cells[iWh];
          const qty = Math.max(0, Math.floor(Number(cells[iQty])));
          if (!year || !lot || !format || !warehouse_id || isNaN(qty)) continue;

          next[keyOf({ year, lot, format, warehouseId: warehouse_id })] = qty;
          nextYears.add(year);
          ups.push({ team_id: teamId, year, lot, format, warehouse_id, qty });
        }

        setQuantities(next);
        setYears(Array.from(nextYears).sort((a, b) => b - a));

        if (ups.length) {
          const { error } = await supabase
            .from("inventory")
            .upsert(ups, { onConflict: "team_id,year,lot,format,warehouse_id" });
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

  // ---------- RENDER ----------
  if (loadingAuth) return <div style={{ padding: 24 }}>Caricamento…</div>;

  if (!userId) {
    return (
      <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ width: 420, maxWidth: "100%" }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 12, textAlign: "center" }}>
            Accedi per gestire il magazzino
          </h1>
          <Auth supabaseClient={supabase} appearance={{ theme: ThemeSupa }} providers={["github","google"]} magicLink />
        </div>
      </div>
    );
  }

  if (loadingTeams) return <div style={{ padding: 24 }}>Carico i tuoi team…</div>;

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: "0 auto", fontFamily: "ui-sans-serif, system-ui, -apple-system" }}>
      <header style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800 }}>Gestione Magazzino Olio</h1>
          {/* Selettore team */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ fontSize: 12, color: "#666" }}>Team</label>
            <select
              value={teamId ?? ""}
              onChange={(e) => onSelectTeam(e.target.value)}
              style={{ border: "1px solid #ccc", borderRadius: 8, padding: "8px 10px" }}
            >
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} {t.role === "owner" ? "👑" : t.role === "editor" ? "✍️" : "👀"}
                </option>
              ))}
            </select>
            <button onClick={createTeam} style={btn}>+ Nuovo team</button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={() => supabase.auth.signOut()} style={btn}>Esci</button>
        </div>
      </header>

      {!teamId ? (
        <div style={card}>
          <p>Nessun team selezionato. Crea un <strong>Nuovo team</strong> per iniziare.</p>
        </div>
      ) : (
        <>
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
                <input placeholder="2025, A, 500ml…" value={search} onChange={(e) => setSearch(e.target.value)} style={input} />
              </div>
              <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                <button onClick={() => {
                  const y = prompt("Aggiungi anno (es. 2025)");
                  if (!y) return;
                  const n = Number(y);
                  if (!n || n < 2000 || n > 2100) return alert("Anno non valido");
                  setYears((prev) => Array.from(new Set([...prev, n])).sort((a, b) => b - a));
                }} style={btn}>+ Anno</button>
                <button onClick={() => {
                  const name = prompt("Nome magazzino");
                  if (!name) return;
                  const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
                  if (!id) return alert("Nome non valido");
                  if (warehouses.find((w) => w.id === id)) return alert("Magazzino già presente");
                  setWarehouses((prev) => [...prev, { id, name: name.trim() }]);
                }} style={btn}>+ Magazzino</button>
                <button onClick={exportCSV} style={btn}>Esporta CSV</button>
                <label style={{ ...btn, cursor: "pointer" }}>
                  Importa CSV
                  <input type="file" accept=".csv" onChange={importCSV} style={{ display: "none" }} />
                </label>
              </div>
            </div>
          </section>

          <section style={{ ...card, overflowX: "auto" }}>
            {loadingInventory ? (
              <p>Carico inventario…</p>
            ) : (
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    <th style={th}>Anno</th>
                    <th style={th}>Lotto</th>
                    <th style={th}>Formato</th>
                    {warehouses.map((w) => (
                      <th key={w.id} style={th}>{w.name}</th>
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
            )}
          </section>

          <p style={{ fontSize: 12, color: "#666", marginTop: 12 }}>
            🔒 Dati limitati al team selezionato. Ruoli: <b>owner</b> (gestione totale), <b>editor</b> (scrive), <b>viewer</b> (solo lettura).
          </p>
        </>
      )}
    </div>
  );
}

// ---- Stili
const btn: React.CSSProperties = { border: "1px solid #ddd", background: "#fff", borderRadius: 10, padding: "8px 12px", fontWeight: 600, cursor: "pointer" };
const miniBtn: React.CSSProperties = { border: "1px solid #ddd", background: "#fff", borderRadius: 8, padding: "4px 8px", fontWeight: 700, cursor: "pointer" };
const input: React.CSSProperties = { border: "1px solid #ccc", borderRadius: 8, padding: "8px 10px" };
const label: React.CSSProperties = { display: "block", fontSize: 12, color: "#666", marginBottom: 4 };
const card: React.CSSProperties = { border: "1px solid #eee", borderRadius: 12, padding: 16, background: "#fafafa", marginBottom: 16 };
const th: React.CSSProperties = { textAlign: "left", padding: 10, fontSize: 12, color: "#666", borderBottom: "1px solid #eee", position: "sticky" as const, top: 0, background: "#fafafa", zIndex: 1 };
const td: React.CSSProperties = { padding: 10, borderBottom: "1px solid #f0f0f0" };
const tf: React.CSSProperties = { padding: 10, borderTop: "2px solid #ddd", background: "#f9f9f9" };

'use client';
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

type Warehouse = { id: string; name: string };
type StockRow = { warehouse: string; year: number; lot: 'A'|'B'|'C'; format: '500ml'|'250ml'|'5L'; pezzi: number; litri: number; };
type HistoryRow = {
  id: number;
  created_at: string;
  date: string;
  warehouse: string;
  operator: string | null;
  type: 'ingresso' | 'uscita';
  year: number;
  lot: 'A'|'B'|'C';
  format: '500ml'|'250ml'|'5L';
  pieces: number;
  liters: number;
  notes: string | null;
};

function classNames(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

export default function InventoryApp() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string|null>(null);
  const [success, setSuccess] = useState<string|null>(null);

  // Filters
  const [fWarehouse, setFWarehouse] = useState<string>('Tutti');
  const [fYear, setFYear] = useState<string>('Tutti');
  const [fLot, setFLot] = useState<string>('Tutti');
  const [fFormat, setFFormat] = useState<string>('Tutti');
  const [search, setSearch] = useState<string>('');

  const today = useMemo(() => new Date().toISOString().split('T')[0], []);

  // Form state
  const [form, setForm] = useState({
    date: today, operator: '', warehouse_id: '',
    type: 'Ingresso' as 'Ingresso'|'Uscita',
    year: new Date().getFullYear(),
    lot: 'A' as 'A'|'B'|'C',
    format: '500ml' as '500ml'|'250ml'|'5L',
    pieces: 1, notes: ''
  });

  const volumeMl = (fmt: string) => (fmt === '500ml' ? 500 : fmt === '250ml' ? 250 : 5000);
  const litersPreview = useMemo(() => (form.pieces * volumeMl(form.format)) / 1000, [form.pieces, form.format]);

  // Load data
  useEffect(() => {
    (async () => {
      try {
        const [{ data: w, error: wErr }, { data: s, error: sErr }, { data: h, error: hErr }] = await Promise.all([
          supabase.from('warehouses').select('*').order('name', { ascending: true }),
          supabase.from('v_stock').select('*'),
          supabase.from('v_history').select('*').limit(200)
        ]);
        if (wErr) throw wErr; if (sErr) throw sErr; if (hErr) throw hErr;
        setWarehouses(w || []);
        setStock((s || []) as StockRow[]);
        setHistory((h || []) as HistoryRow[]);
        if ((w || []).length && !form.warehouse_id) setForm(f => ({ ...f, warehouse_id: (w as Warehouse[])[0].id }));
      } catch (e:any) {
        setError(e.message || 'Errore di caricamento');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function refreshData() {
    const [{ data: s }, { data: h }] = await Promise.all([
      supabase.from('v_stock').select('*'),
      supabase.from('v_history').select('*').limit(200)
    ]);
    setStock((s || []) as StockRow[]);
    setHistory((h || []) as HistoryRow[]);
  }

  async function seedWarehouses() {
    const { error } = await supabase.from('warehouses').insert([{ name: 'Roma' }, { name: 'Neci' }]);
    if (!error) {
      const { data } = await supabase.from('warehouses').select('*').order('name');
      setWarehouses(data || []);
    }
  }

  async function submitMovement() {
    setSubmitting(true); setError(null); setSuccess(null);
    try {
      if (!form.warehouse_id) throw new Error('Seleziona un magazzino');
      if (form.pieces <= 0) throw new Error('Pezzi deve essere > 0');
      const payload = {
        date: form.date, operator: form.operator || null, warehouse_id: form.warehouse_id,
        type: form.type === 'Ingresso' ? 'ingresso' : 'uscita',
        year: form.year, lot: form.lot, format: form.format, pieces: form.pieces, notes: form.notes || null
      };
      const { error } = await supabase.from('movements').insert(payload);
      if (error) throw error;
      setForm(f => ({ ...f, pieces: 1, notes: '' }));
      await refreshData();
      setSuccess('Movimento registrato!');
      setTimeout(() => setSuccess(null), 2000);
    } catch (e:any) {
      setError(e.message || 'Errore di salvataggio');
    } finally {
      setSubmitting(false);
    }
  }

  const filteredStock = useMemo(() => {
    return stock.filter(r =>
      (fWarehouse === 'Tutti' || r.warehouse === fWarehouse) &&
      (fYear === 'Tutti' || String(r.year) === fYear) &&
      (fLot === 'Tutti' || r.lot === fLot) &&
      (fFormat === 'Tutti' || r.format === fFormat)
    );
  }, [stock, fWarehouse, fYear, fLot, fFormat]);

  const filteredHistory = useMemo(() => {
    const q = search.trim().toLowerCase();
    return history.filter(h =>
      (fWarehouse === 'Tutti' || h.warehouse === fWarehouse) &&
      (fYear === 'Tutti' || String(h.year) === fYear) &&
      (fLot === 'Tutti' || h.lot === fLot) &&
      (fFormat === 'Tutti' || h.format === fFormat) &&
      (!q || (h.notes || '').toLowerCase().includes(q) || (h.operator || '').toLowerCase().includes(q))
    );
  }, [history, fWarehouse, fYear, fLot, fFormat, search]);

  const years = useMemo(() => {
    const set = new Set<string>(stock.map(s => String(s.year)));
    const arr = Array.from(set).sort((a,b)=> Number(b)-Number(a));
    return ['Tutti', ...(arr.length ? arr : [String(new Date().getFullYear())])];
  }, [stock]);

  const lots = ['Tutti','A','B','C'];
  const formats = ['Tutti','500ml','250ml','5L'];
  const warehouseOptions = ['Tutti', ...warehouses.map(w => w.name)];

  const kpi = useMemo(() => {
    const pezzi = filteredStock.reduce((sum, r) => sum + (r.pezzi || 0), 0);
    const litri = filteredStock.reduce((sum, r) => sum + (r.litri || 0), 0);
    const last = history[0]?.created_at ? new Date(history[0].created_at) : null;
    return { pezzi, litri, last };
  }, [filteredStock, history]);

  function downloadCSV(name: string, rows: any[]) {
    const headers = Object.keys(rows[0] || {});
    const csv = [headers.join(','), ...rows.map(r => headers.map(h => {
      const val = (r as any)[h];
      const s = val == null ? '' : String(val).replace(/"/g,'""');
      return `"${s}"`;
    }).join(','))].join('\\n'); // <-- FIXED: single-line join with newline
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${name}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="h-10 w-64 bg-slate-200 rounded-xl animate-pulse mb-6" />
          <div className="grid md:grid-cols-2 gap-6">
            <div className="h-96 bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 animate-pulse" />
            <div className="h-96 bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 p-6 text-slate-800">
      <div className="max-w-7xl mx-auto grid gap-6">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo-olio-nece.svg" alt="Olio Nece" className="h-9 w-auto select-none" />
            <div className="h-6 w-px bg-slate-300" />
            <h1 className="text-3xl font-semibold tracking-tight">Magazzino Olio — Dashboard</h1>
          </div>
          <div className="flex gap-2">
            <button onClick={refreshData} className="rounded-xl px-4 py-2 ring-1 ring-slate-300 bg-white hover:bg-slate-50 transition">Aggiorna</button>
            <button
              onClick={() => filteredStock.length ? downloadCSV('giacenze', filteredStock) : null}
              className="rounded-xl px-4 py-2 ring-1 ring-slate-300 bg-white hover:bg-slate-50 transition disabled:opacity-50"
              disabled={!filteredStock.length}
              title="Esporta Giacenze CSV"
            >
              Esporta CSV
            </button>
          </div>
        </header>

        {/* KPIs */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm p-4">
            <div className="text-xs uppercase text-slate-500 mb-1">Pezzi totali</div>
            <div className="text-2xl font-semibold">{kpi.pezzi}</div>
          </div>
          <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm p-4">
            <div className="text-xs uppercase text-slate-500 mb-1">Litri totali</div>
            <div className="text-2xl font-semibold">{kpi.litri.toFixed(2)}</div>
          </div>
          <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm p-4">
            <div className="text-xs uppercase text-slate-500 mb-1">Magazzini</div>
            <div className="text-2xl font-semibold">{warehouses.length}</div>
          </div>
          <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm p-4">
            <div className="text-xs uppercase text-slate-500 mb-1">Ultimo movimento</div>
            <div className="text-lg font-medium">{kpi.last ? new Date(kpi.last).toLocaleString() : '-'}</div>
          </div>
        </section>

        {/* Filters */}
        <section className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm p-4">
          <div className="grid md:grid-cols-5 gap-3">
            <div>
              <label className="text-xs uppercase text-slate-500">Magazzino</label>
              <select value={fWarehouse} onChange={e=>setFWarehouse(e.target.value)} className="mt-1 w-full rounded-xl border p-2">
                {warehouseOptions.map(w => <option key={w} value={w}>{w}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs uppercase text-slate-500">Anno</label>
              <select value={fYear} onChange={e=>setFYear(e.target.value)} className="mt-1 w-full rounded-xl border p-2">
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs uppercase text-slate-500">Lotto</label>
              <select value={fLot} onChange={e=>setFLot(e.target.value)} className="mt-1 w-full rounded-xl border p-2">
                {lots.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs uppercase text-slate-500">Formato</label>
              <select value={fFormat} onChange={e=>setFFormat(e.target.value)} className="mt-1 w-full rounded-xl border p-2">
                {formats.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs uppercase text-slate-500">Cerca note/operatore</label>
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Es. cliente X" className="mt-1 w-full rounded-xl border p-2" />
            </div>
          </div>
        </section>

        {error && <div className="rounded-xl bg-red-100 text-red-800 p-3">{error}</div>}
        {success && <div className="rounded-xl bg-emerald-100 text-emerald-800 p-3">{success}</div>}

        {/* Form + Stock */}
        <section className="grid md:grid-cols-2 gap-6">
          {/* Form */}
          <div className="rounded-2xl shadow-sm ring-1 ring-slate-200 p-5 bg-white">
            <h2 className="text-lg font-medium mb-4">Registra movimento</h2>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-sm">Data</label>
                <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="mt-1 w-full rounded-xl border p-2"/></div>
              <div><label className="text-sm">Operatore</label>
                <input type="text" value={form.operator} onChange={e => setForm({ ...form, operator: e.target.value })} placeholder="Nome cognome" className="mt-1 w-full rounded-xl border p-2"/></div>
              <div><label className="text-sm">Magazzino</label>
                <select className="mt-1 w-full rounded-xl border p-2" value={form.warehouse_id} onChange={e => setForm({ ...form, warehouse_id: e.target.value })}>
                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select></div>
              <div><label className="text-sm">Tipo</label>
                <select className="mt-1 w-full rounded-xl border p-2" value={form.type} onChange={e => setForm({ ...form, type: e.target.value as 'Ingresso'|'Uscita' })}>
                  <option>Ingresso</option><option>Uscita</option>
                </select></div>
              <div><label className="text-sm">Anno</label>
                <input type="number" value={form.year} onChange={e => setForm({ ...form, year: parseInt(e.target.value || '0') })} className="mt-1 w-full rounded-xl border p-2"/></div>
              <div><label className="text-sm">Lotto</label>
                <select className="mt-1 w-full rounded-xl border p-2" value={form.lot} onChange={e => setForm({ ...form, lot: e.target.value as 'A'|'B'|'C' })}>
                  <option value="A">A</option><option value="B">B</option><option value="C">C</option>
                </select></div>
              <div><label className="text-sm">Formato</label>
                <select className="mt-1 w-full rounded-xl border p-2" value={form.format} onChange={e => setForm({ ...form, format: e.target.value as any })}>
                  <option value="500ml">500ml</option><option value="250ml">250ml</option><option value="5L">5L</option>
                </select></div>
              <div><label className="text-sm">Pezzi</label>
                <input type="number" min={1} value={form.pieces} onChange={e => setForm({ ...form, pieces: parseInt(e.target.value || '0') })} className="mt-1 w-full rounded-xl border p-2"/></div>
              <div className="col-span-2"><label className="text-sm">Note</label>
                <input type="text" placeholder="Es. cliente X / causale" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="mt-1 w-full rounded-xl border p-2"/></div>
            </div>
            <div className="flex items-center justify-between mt-4">
              <div className="text-sm text-slate-600">Anteprima: <b>{litersPreview.toFixed(2)}</b> L</div>
              <button onClick={submitMovement} disabled={submitting} className="rounded-2xl px-4 py-2 bg-black text-white disabled:opacity-50 hover:bg-slate-800 transition">
                {submitting ? 'Salvataggio…' : 'Registra'}
              </button>
            </div>
            {warehouses.length === 0 && (
              <div className="mt-4 text-sm">
                Nessun magazzino trovato. <button onClick={seedWarehouses} className="underline">Crea Roma e Neci</button>.
              </div>
            )}
          </div>

          {/* Stock table */}
          <div className="rounded-2xl shadow-sm ring-1 ring-slate-200 p-5 bg-white">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-medium">Giacenze (filtrate)</h2>
              <button
                onClick={() => filteredStock.length ? downloadCSV('giacenze_filtrate', filteredStock) : null}
                className="text-sm underline disabled:opacity-50"
                disabled={!filteredStock.length}
              >
                Esporta CSV
              </button>
            </div>
            <div className="overflow-auto max-h-[480px]">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-left border-b">
                    <th className="py-2 pr-4">Magazzino</th>
                    <th className="py-2 pr-4">Anno</th>
                    <th className="py-2 pr-4">Lotto</th>
                    <th className="py-2 pr-4">Formato</th>
                    <th className="py-2 pr-4">Pezzi</th>
                    <th className="py-2 pr-4">Litri</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStock.map((r, i) => (
                    <tr key={i} className="border-b hover:bg-slate-50">
                      <td className="py-2 pr-4">{r.warehouse}</td>
                      <td className="py-2 pr-4">{r.year}</td>
                      <td className="py-2 pr-4">{r.lot}</td>
                      <td className="py-2 pr-4">{r.format}</td>
                      <td className={classNames('py-2 pr-4', r.pezzi < 0 && 'text-red-600 font-medium')}>{r.pezzi}</td>
                      <td className={classNames('py-2 pr-4', r.litri < 0 && 'text-red-600 font-medium')}>{r.litri.toFixed(2)}</td>
                    </tr>
                  ))}
                  {!filteredStock.length && (
                    <tr><td colSpan={6} className="py-4 text-gray-500">Nessuna giacenza (inserisci un primo movimento)</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* History */}
        <section className="rounded-2xl shadow-sm ring-1 ring-slate-200 p-5 bg-white">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-medium">Ultimi movimenti (filtrati)</h2>
            <button
              onClick={() => filteredHistory.length ? downloadCSV('storico_filtrato', filteredHistory) : null}
              className="text-sm underline disabled:opacity-50"
              disabled={!filteredHistory.length}
            >
              Esporta CSV
            </button>
          </div>
          <div className="overflow-auto max-h-[600px]">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="text-left border-b">
                  <th className="py-2 pr-4">Quando</th>
                  <th className="py-2 pr-4">Data</th>
                  <th className="py-2 pr-4">Magazzino</th>
                  <th className="py-2 pr-4">Tipo</th>
                  <th className="py-2 pr-4">Anno</th>
                  <th className="py-2 pr-4">Lotto</th>
                  <th className="py-2 pr-4">Formato</th>
                  <th className="py-2 pr-4">Pezzi</th>
                  <th className="py-2 pr-4">Litri</th>
                  <th className="py-2 pr-4">Operatore</th>
                  <th className="py-2 pr-4">Note</th>
                </tr>
              </thead>
              <tbody>
                {filteredHistory.length === 0 ? (
                  <tr><td colSpan={11} className="py-4 text-gray-500">Nessun movimento ancora</td></tr>
                ) : filteredHistory.map((h, i) => (
                  <tr key={h.id ?? i} className="border-b hover:bg-slate-50">
                    <td className="py-2 pr-4">{new Date(h.created_at).toLocaleString()}</td>
                    <td className="py-2 pr-4">{h.date}</td>
                    <td className="py-2 pr-4">{h.warehouse}</td>
                    <td className="py-2 pr-4 capitalize">{h.type}</td>
                    <td className="py-2 pr-4">{h.year}</td>
                    <td className="py-2 pr-4">{h.lot}</td>
                    <td className="py-2 pr-4">{h.format}</td>
                    <td className="py-2 pr-4">{h.pieces}</td>
                    <td className="py-2 pr-4">{(h.liters ?? 0).toFixed?.(2) ?? h.liters}</td>
                    <td className="py-2 pr-4">{h.operator || '-'}</td>
                    <td className="py-2 pr-4">{h.notes || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

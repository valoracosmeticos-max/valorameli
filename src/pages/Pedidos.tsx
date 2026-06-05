import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { ShoppingCart, Search, Pencil, Download, CalendarIcon } from "lucide-react";
import { format, startOfDay, endOfDay } from "date-fns";
import type { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";

interface OrderRow {
  id: string;
  store_id: string;
  ml_order_id: string;
  date_created: string;
  status: string;
  total_amount: number;
  amount_received: number;
  ml_fees: number;
  shipping_cost: number;
}
interface ItemRow {
  order_id: string;
  title: string;
  quantity: number;
  unit_price: number;
  cost_price: number;
}
interface StoreRow { id: string; name: string }

const fmtBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const statusVariant = (s: string): "default" | "secondary" | "destructive" | "outline" => {
  if (s === "paid") return "default";
  if (s === "cancelled") return "destructive";
  return "secondary";
};

const STATUS_OPTIONS = ["paid", "confirmed", "cancelled", "pending", "invalid"];

const Pedidos = () => {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [storeFilter, setStoreFilter] = useState<string>("all");
  // Default: "active" = exclui cancelados (mesma lógica do Dashboard)
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [search, setSearch] = useState("");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();

  const [editing, setEditing] = useState<OrderRow | null>(null);
  const [form, setForm] = useState({
    status: "",
    total_amount: 0,
    amount_received: 0,
    ml_fees: 0,
    shipping_cost: 0,
  });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data: storesData }, { data: ordersData, error }, { data: itemsData }] = await Promise.all([
      supabase.from("stores").select("id, name"),
      supabase.from("orders")
        .select("id, store_id, ml_order_id, date_created, status, total_amount, amount_received, ml_fees, shipping_cost")
        .order("date_created", { ascending: false })
        .limit(1000),
      supabase.from("order_items").select("order_id, title, quantity, unit_price, cost_price"),
    ]);
    if (error) toast.error(error.message);
    setStores(storesData ?? []);
    setOrders((ordersData ?? []) as OrderRow[]);
    setItems((itemsData ?? []) as ItemRow[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const itemsByOrder = useMemo(() => {
    const map = new Map<string, ItemRow[]>();
    items.forEach((i) => {
      if (!map.has(i.order_id)) map.set(i.order_id, []);
      map.get(i.order_id)!.push(i);
    });
    return map;
  }, [items]);

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      // Pedidos cancelados: exclui no modo "active"
      if (statusFilter === "active" && o.status === "cancelled") return false;
      if (statusFilter !== "all" && statusFilter !== "active" && o.status !== statusFilter) return false;
      if (storeFilter !== "all" && o.store_id !== storeFilter) return false;
      if (search && !o.ml_order_id.includes(search)) return false;
      // Filtro de data
      if (dateRange?.from) {
        const t = new Date(o.date_created).getTime();
        const from = startOfDay(dateRange.from).getTime();
        const to = endOfDay(dateRange.to ?? dateRange.from).getTime();
        if (t < from || t > to) return false;
      }
      return true;
    });
  }, [orders, storeFilter, statusFilter, search, dateRange]);

  const storeName = (id: string) => stores.find((s) => s.id === id)?.name ?? "—";

  const computeProfit = (o: OrderRow) => {
    const its = itemsByOrder.get(o.id) ?? [];
    const cost = its.reduce((acc, i) => acc + i.cost_price * i.quantity, 0);
    const profit = (o.amount_received || 0) - cost - (o.shipping_cost || 0);
    return { cost, profit };
  };

  const openEdit = (o: OrderRow) => {
    setEditing(o);
    setForm({
      status: o.status,
      total_amount: Number(o.total_amount || 0),
      amount_received: Number(o.amount_received || 0),
      ml_fees: Number(o.ml_fees || 0),
      shipping_cost: Number(o.shipping_cost || 0),
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    const { error } = await supabase
      .from("orders")
      .update({
        status: form.status,
        total_amount: form.total_amount,
        amount_received: form.amount_received,
        ml_fees: form.ml_fees,
        shipping_cost: form.shipping_cost,
      })
      .eq("id", editing.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setOrders((prev) =>
      prev.map((o) => (o.id === editing.id ? { ...o, ...form } : o))
    );
    toast.success("Pedido atualizado");
    setEditing(null);
  };

  const exportXLSX = () => {
    if (filtered.length === 0) {
      toast.error("Nenhum pedido para exportar.");
      return;
    }

    const rows = filtered.map((o) => {
      const { cost, profit } = computeProfit(o);
      return {
        "Data": format(new Date(o.date_created), "dd/MM/yyyy HH:mm"),
        "Pedido": o.ml_order_id,
        "Total (R$)": Number(o.total_amount.toFixed(2)),
        "Custo (R$)": Number(cost.toFixed(2)),
        "Lucro (R$)": Number(profit.toFixed(2)),
      };
    });

    // Linha de totais
    const sumTotal = rows.reduce((s, r) => s + r["Total (R$)"], 0);
    const sumCost  = rows.reduce((s, r) => s + r["Custo (R$)"],  0);
    const sumLucro = rows.reduce((s, r) => s + r["Lucro (R$)"],  0);
    rows.push({
      "Data": "TOTAL",
      "Pedido": `${filtered.length} pedido(s)`,
      "Total (R$)": Number(sumTotal.toFixed(2)),
      "Custo (R$)": Number(sumCost.toFixed(2)),
      "Lucro (R$)": Number(sumLucro.toFixed(2)),
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [
      { wch: 18 }, // Data
      { wch: 22 }, // Pedido
      { wch: 14 }, // Total
      { wch: 14 }, // Custo
      { wch: 14 }, // Lucro
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Pedidos");
    XLSX.writeFile(wb, `pedidos-${format(new Date(), "yyyy-MM-dd")}.xlsx`);
    toast.success(`${filtered.length} pedido(s) exportado(s)`);
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Pedidos</h1>
        <p className="text-muted-foreground mt-1">Histórico de vendas com cálculo de lucro · cancelados excluídos por padrão</p>
      </div>

      <Card className="shadow-soft border-border/60">
        <CardHeader className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle>Lista ({filtered.length})</CardTitle>
            <Button size="sm" variant="outline" onClick={exportXLSX}>
              <Download className="h-4 w-4 mr-2" />
              Exportar XLSX
            </Button>
          </div>

          {/* Filtros */}
          <div className="flex flex-wrap gap-2">
            {/* Busca */}
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Nº do pedido"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 w-48"
              />
            </div>

            {/* Filtro de período */}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-auto justify-start text-left font-normal",
                    !dateRange?.from && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="h-4 w-4 mr-2" />
                  {dateRange?.from ? (
                    dateRange.to ? (
                      <>{format(dateRange.from, "dd/MM/yy")} – {format(dateRange.to, "dd/MM/yy")}</>
                    ) : (
                      format(dateRange.from, "dd/MM/yy")
                    )
                  ) : (
                    <span>Filtrar por período</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="range"
                  selected={dateRange}
                  onSelect={setDateRange}
                  numberOfMonths={2}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
                {dateRange?.from && (
                  <div className="p-2 border-t flex justify-end">
                    <Button size="sm" variant="ghost" onClick={() => setDateRange(undefined)}>
                      Limpar
                    </Button>
                  </div>
                )}
              </PopoverContent>
            </Popover>

            {/* Loja */}
            <Select value={storeFilter} onValueChange={setStoreFilter}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as lojas</SelectItem>
                {stores.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>

            {/* Status */}
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Ativos (exceto cancelados)</SelectItem>
                <SelectItem value="all">Todos os status</SelectItem>
                {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>

        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Carregando...</p>
          ) : filtered.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center gap-2 text-muted-foreground">
              <ShoppingCart className="h-12 w-12 opacity-30" />
              <p>Nenhum pedido encontrado.</p>
            </div>
          ) : (
            <div className="rounded-lg border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Pedido</TableHead>
                    <TableHead>Loja</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Recebido</TableHead>
                    <TableHead className="text-right">Tarifa ML</TableHead>
                    <TableHead className="text-right">Custo Frete</TableHead>
                    <TableHead className="text-right">Custo</TableHead>
                    <TableHead className="text-right">Lucro</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((o) => {
                    const { cost, profit } = computeProfit(o);
                    return (
                      <TableRow key={o.id}>
                        <TableCell className="whitespace-nowrap text-sm">
                          {format(new Date(o.date_created), "dd/MM/yy HH:mm")}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{o.ml_order_id}</TableCell>
                        <TableCell><Badge variant="secondary">{storeName(o.store_id)}</Badge></TableCell>
                        <TableCell><Badge variant={statusVariant(o.status)}>{o.status}</Badge></TableCell>
                        <TableCell className="text-right tabular-nums">{fmtBRL(o.total_amount)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtBRL(o.amount_received)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">-{fmtBRL(o.ml_fees)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {o.shipping_cost > 0 ? `-${fmtBRL(o.shipping_cost)}` : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">-{fmtBRL(cost)}</TableCell>
                        <TableCell className={`text-right tabular-nums font-semibold ${profit >= 0 ? "text-success" : "text-destructive"}`}>
                          {fmtBRL(profit)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button size="icon" variant="ghost" onClick={() => openEdit(o)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar pedido</DialogTitle>
            <DialogDescription>
              {editing && <span className="font-mono text-xs">#{editing.ml_order_id}</span>}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Total (faturamento)</Label>
              <Input type="number" step="0.01" value={form.total_amount}
                onChange={(e) => setForm((f) => ({ ...f, total_amount: Number(e.target.value) }))} />
            </div>
            <div>
              <Label>Recebido (líquido)</Label>
              <Input type="number" step="0.01" value={form.amount_received}
                onChange={(e) => setForm((f) => ({ ...f, amount_received: Number(e.target.value) }))} />
            </div>
            <div>
              <Label>Tarifa ML</Label>
              <Input type="number" step="0.01" value={form.ml_fees}
                onChange={(e) => setForm((f) => ({ ...f, ml_fees: Number(e.target.value) }))} />
            </div>
            <div>
              <Label>Frete</Label>
              <Input type="number" step="0.01" value={form.shipping_cost}
                onChange={(e) => setForm((f) => ({ ...f, shipping_cost: Number(e.target.value) }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button onClick={saveEdit} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Pedidos;

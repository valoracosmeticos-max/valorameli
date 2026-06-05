import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, Legend, PieChart, Pie, Cell,
} from "recharts";
import {
  TrendingUp, TrendingDown, DollarSign, Wallet, Package,
  AlertCircle, ArrowRight, Percent, CalendarIcon, Truck,
  ShoppingBag, Receipt, XCircle,
} from "lucide-react";
import { format, startOfDay, endOfDay, subDays, differenceInCalendarDays, eachDayOfInterval } from "date-fns";
import type { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";

interface OrderRow {
  id: string; store_id: string; status: string;
  date_created: string; total_amount: number; amount_received: number;
  ml_fees: number; shipping_cost: number;
}
interface ItemRow {
  order_id: string; quantity: number; cost_price: number;
  title: string; unit_price: number;
}
interface StoreRow { id: string; name: string }
interface AddCostRow {
  amount: number; cost_type: "fixed" | "sporadic"; cost_date: string;
}

const fmtBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtPct = (v: number) => `${v.toFixed(1)}%`;

const COST_COLORS = ["hsl(var(--primary))", "hsl(var(--warning))", "#f87171", "#a78bfa", "#34d399"];

const Index = () => {
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [addCosts, setAddCosts] = useState<AddCostRow[]>([]);
  const [period, setPeriod] = useState<string>("30");
  const [customRange, setCustomRange] = useState<DateRange | undefined>();
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: s }, { data: o }, { data: it }, { data: ac }] = await Promise.all([
        supabase.from("stores").select("id, name"),
        supabase.from("orders")
          .select("id, store_id, status, date_created, total_amount, amount_received, ml_fees, shipping_cost")
          .order("date_created", { ascending: false })
          .limit(2000),
        supabase.from("order_items").select("order_id, quantity, cost_price, title, unit_price"),
        supabase.from("additional_costs").select("amount, cost_type, cost_date"),
      ]);
      setStores(s ?? []);
      setOrders((o ?? []) as OrderRow[]);
      setItems((it ?? []) as ItemRow[]);
      setAddCosts((ac ?? []) as AddCostRow[]);
      setLoading(false);
    })();
  }, []);

  const costByOrder = useMemo(() => {
    const m = new Map<string, number>();
    items.forEach((i) => {
      m.set(i.order_id, (m.get(i.order_id) ?? 0) + i.cost_price * i.quantity);
    });
    return m;
  }, [items]);

  const range = useMemo(() => {
    if (period === "custom" && customRange?.from) {
      const from = startOfDay(customRange.from);
      const to = endOfDay(customRange.to ?? customRange.from);
      const days = differenceInCalendarDays(to, from) + 1;
      return { since: from.getTime(), until: to.getTime(), days, from, to };
    }
    const days = Number(period);
    const to = endOfDay(new Date());
    const from = startOfDay(subDays(new Date(), days - 1));
    return { since: from.getTime(), until: to.getTime(), days, from, to };
  }, [period, customRange]);

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      if (o.status === "cancelled" || o.status === "partially_refunded") return false;
      const t = new Date(o.date_created).getTime();
      if (t < range.since || t > range.until) return false;
      if (storeFilter !== "all" && o.store_id !== storeFilter) return false;
      return true;
    });
  }, [orders, range, storeFilter]);

  const cancelledCount = useMemo(() => {
    return orders.filter((o) => {
      if (o.status !== "cancelled") return false;
      const t = new Date(o.date_created).getTime();
      if (t < range.since || t > range.until) return false;
      if (storeFilter !== "all" && o.store_id !== storeFilter) return false;
      return true;
    }).length;
  }, [orders, range, storeFilter]);

  const additionalForPeriod = useMemo(() => {
    let total = 0;
    addCosts.forEach((c) => {
      const amt = Number(c.amount) || 0;
      if (c.cost_type === "fixed") {
        total += amt * (range.days / 30);
      } else {
        const d = new Date(c.cost_date + "T00:00").getTime();
        if (d >= range.since && d <= range.until) total += amt;
      }
    });
    return total;
  }, [addCosts, range]);

  const totals = useMemo(() => {
    let revenue = 0, received = 0, fees = 0, cost = 0, shipping = 0, itemsQty = 0;
    filtered.forEach((o) => {
      revenue += o.total_amount;
      received += o.amount_received;
      fees += o.ml_fees;
      shipping += o.shipping_cost;
      cost += costByOrder.get(o.id) ?? 0;
    });
    items.forEach((i) => {
      // only count items from filtered orders
      if (filtered.some((o) => o.id === i.order_id)) itemsQty += i.quantity;
    });
    const receivedNet = received - shipping;
    const profit = revenue - fees - shipping - cost - additionalForPeriod;
    const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
    const ticketMedio = filtered.length > 0 ? revenue / filtered.length : 0;
    return {
      revenue, receivedNet, fees, cost, shipping, profit, margin,
      additional: additionalForPeriod, count: filtered.length, itemsQty, ticketMedio,
    };
  }, [filtered, items, costByOrder, additionalForPeriod]);

  // ── Produtos mais vendidos ───────────────────────────────────────
  const productStats = useMemo(() => {
    const filteredIds = new Set(filtered.map((o) => o.id));
    const map = new Map<string, { title: string; qty: number; revenue: number; cost: number }>();
    items.forEach((it) => {
      if (!filteredIds.has(it.order_id) || !it.title) return;
      const cur = map.get(it.title) ?? { title: it.title, qty: 0, revenue: 0, cost: 0 };
      cur.qty += it.quantity;
      cur.revenue += it.unit_price * it.quantity;
      cur.cost += it.cost_price * it.quantity;
      map.set(it.title, cur);
    });
    return Array.from(map.values())
      .sort((a, b) => b.revenue - a.revenue);
  }, [filtered, items]);

  // ── Distribuição de custos (para gráfico de pizza) ──────────────
  const costDistribution = useMemo(() => {
    const { fees, shipping, cost, additional, profit, revenue } = totals;
    if (revenue === 0) return [];
    return [
      { name: "Lucro", value: Math.max(0, profit) },
      { name: "Custo Produto", value: cost },
      { name: "Tarifa ML", value: fees },
      { name: "Frete", value: shipping },
      { name: "Custos Adicionais", value: additional },
    ].filter((d) => d.value > 0);
  }, [totals]);

  // ── Gráficos ────────────────────────────────────────────────────
  const dailyData = useMemo(() => {
    const days = eachDayOfInterval({ start: range.from, end: range.to });
    const buckets = new Map<string, { date: string; revenue: number; profit: number; pedidos: number }>();
    days.forEach((d) => {
      buckets.set(format(d, "dd/MM"), { date: format(d, "dd/MM"), revenue: 0, profit: 0, pedidos: 0 });
    });
    filtered.forEach((o) => {
      const d = format(new Date(o.date_created), "dd/MM");
      const b = buckets.get(d);
      if (!b) return;
      const c = costByOrder.get(o.id) ?? 0;
      b.revenue += o.total_amount;
      b.profit += o.total_amount - o.ml_fees - o.shipping_cost - c;
      b.pedidos += 1;
    });
    return Array.from(buckets.values());
  }, [filtered, costByOrder, range]);

  const byStore = useMemo(() => {
    const map = new Map<string, { name: string; revenue: number; profit: number }>();
    filtered.forEach((o) => {
      const name = stores.find((s) => s.id === o.store_id)?.name ?? "—";
      const cur = map.get(o.store_id) ?? { name, revenue: 0, profit: 0 };
      cur.revenue += o.total_amount;
      cur.profit += o.total_amount - o.ml_fees - o.shipping_cost - (costByOrder.get(o.id) ?? 0);
      map.set(o.store_id, cur);
    });
    return Array.from(map.values());
  }, [filtered, stores, costByOrder]);

  const cards = [
    { label: "Faturamento", value: fmtBRL(totals.revenue), icon: DollarSign, color: "text-primary" },
    { label: "Recebido", value: fmtBRL(totals.receivedNet), icon: Wallet, color: "text-success" },
    { label: "Custo produtos", value: fmtBRL(totals.cost), icon: Package, color: "text-warning" },
    { label: "Custos adicionais", value: fmtBRL(totals.additional), icon: Wallet, color: "text-warning" },
    { label: "Lucro", value: fmtBRL(totals.profit), icon: totals.profit >= 0 ? TrendingUp : TrendingDown,
      color: totals.profit >= 0 ? "text-success" : "text-destructive" },
    { label: "Margem", value: fmtPct(totals.margin), icon: Percent, color: "text-muted-foreground" },
  ];

  const secondaryCards = [
    { label: "Ticket médio", value: fmtBRL(totals.ticketMedio), icon: Receipt, color: "text-primary" },
    { label: "Total frete", value: fmtBRL(totals.shipping), icon: Truck, color: "text-muted-foreground" },
    { label: "Itens vendidos", value: String(totals.itemsQty), icon: ShoppingBag, color: "text-success" },
    { label: "Cancelados", value: String(cancelledCount), icon: XCircle, color: cancelledCount > 0 ? "text-destructive" : "text-muted-foreground" },
  ];

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* ── Cabeçalho ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {totals.count} pedido(s) · cancelados/reembolsados excluídos · Lucro = Faturamento − Tarifa ML − Frete − Custo Produtos − Custos Adicionais
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Select value={storeFilter} onValueChange={setStoreFilter}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as lojas</SelectItem>
              {stores.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Últimos 7 dias</SelectItem>
              <SelectItem value="30">Últimos 30 dias</SelectItem>
              <SelectItem value="90">Últimos 90 dias</SelectItem>
              <SelectItem value="custom">Personalizado</SelectItem>
            </SelectContent>
          </Select>
          {period === "custom" && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className={cn("w-[260px] justify-start text-left font-normal", !customRange?.from && "text-muted-foreground")}>
                  <CalendarIcon className="h-4 w-4 mr-2" />
                  {customRange?.from ? (
                    customRange.to
                      ? <>{format(customRange.from, "dd/MM/yyyy")} – {format(customRange.to, "dd/MM/yyyy")}</>
                      : format(customRange.from, "dd/MM/yyyy")
                  ) : <span>Selecionar datas</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar mode="range" selected={customRange} onSelect={setCustomRange}
                  numberOfMonths={2} initialFocus className={cn("p-3 pointer-events-auto")} />
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>

      {!loading && stores.length === 0 && (
        <Alert className="border-primary/30 bg-primary/5">
          <AlertCircle className="h-4 w-4 text-primary" />
          <AlertTitle>Nenhuma loja conectada</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-4">
            <span>Conecte sua primeira loja do Mercado Livre para começar.</span>
            <Button asChild size="sm">
              <Link to="/configuracoes">Conectar loja <ArrowRight className="h-4 w-4 ml-2" /></Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* ── KPIs principais ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {cards.map((c) => (
          <Card key={c.label} className="shadow-soft border-border/60">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-sm font-medium text-muted-foreground">{c.label}</CardTitle>
              <c.icon className={`h-4 w-4 ${c.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tabular-nums">{c.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── KPIs secundários ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {secondaryCards.map((c) => (
          <Card key={c.label} className="shadow-soft border-border/60 bg-muted/20">
            <CardContent className="flex items-center gap-3 pt-4 pb-4">
              <div className={`rounded-md p-2 bg-background border`}>
                <c.icon className={`h-4 w-4 ${c.color}`} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{c.label}</p>
                <p className="text-lg font-bold tabular-nums">{c.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Gráficos ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="shadow-soft border-border/60 lg:col-span-2">
          <CardHeader><CardTitle>Faturamento e lucro por dia</CardTitle></CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dailyData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12}
                    tickFormatter={(v) => `R$${Math.round(v / 1000)}k`} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                    formatter={(v: number) => fmtBRL(v)} />
                  <Legend />
                  <Line type="monotone" dataKey="revenue" name="Faturamento"
                    stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="profit" name="Lucro"
                    stroke="hsl(var(--success))" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-soft border-border/60">
          <CardHeader><CardTitle>Distribuição do faturamento</CardTitle></CardHeader>
          <CardContent>
            <div className="h-72 flex flex-col items-center justify-center">
              {costDistribution.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sem dados</p>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={costDistribution} dataKey="value" nameKey="name"
                        cx="50%" cy="50%" outerRadius={80} innerRadius={46}
                        paddingAngle={2}>
                        {costDistribution.map((_, i) => (
                          <Cell key={i} fill={COST_COLORS[i % COST_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number) => fmtBRL(v)}
                        contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-1">
                    {costDistribution.map((d, i) => (
                      <div key={d.name} className="flex items-center gap-1 text-xs text-muted-foreground">
                        <span className="inline-block w-2 h-2 rounded-full" style={{ background: COST_COLORS[i % COST_COLORS.length] }} />
                        {d.name}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Comparativo entre lojas + pedidos/dia ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="shadow-soft border-border/60">
          <CardHeader><CardTitle>Comparativo entre lojas</CardTitle></CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byStore} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12}
                    tickFormatter={(v) => `R$${Math.round(v / 1000)}k`} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                    formatter={(v: number) => fmtBRL(v)} />
                  <Legend />
                  <Bar dataKey="revenue" name="Faturamento" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="profit" name="Lucro" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-soft border-border/60">
          <CardHeader><CardTitle>Pedidos por dia</CardTitle></CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="pedidos" name="Pedidos" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Produtos mais vendidos ── */}
      <Card className="shadow-soft border-border/60">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Produtos mais vendidos</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {productStats.length} produto(s) · lucro bruto antes de tarifas ML e frete
            </p>
          </div>
          <Badge variant="outline">{totals.itemsQty} itens</Badge>
        </CardHeader>
        <CardContent>
          {productStats.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Nenhum dado no período selecionado.</p>
          ) : (
            <div className="rounded-lg border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead className="text-right">Qtd Vendida</TableHead>
                    <TableHead className="text-right">Faturamento</TableHead>
                    <TableHead className="text-right">Custo Produto</TableHead>
                    <TableHead className="text-right">Lucro Bruto</TableHead>
                    <TableHead className="text-right">Margem Bruta</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {productStats.map((p, idx) => {
                    const grossProfit = p.revenue - p.cost;
                    const grossMargin = p.revenue > 0 ? (grossProfit / p.revenue) * 100 : 0;
                    return (
                      <TableRow key={p.title}>
                        <TableCell className="text-muted-foreground text-sm">{idx + 1}</TableCell>
                        <TableCell className="max-w-xs">
                          <span className="truncate block text-sm font-medium" title={p.title}>
                            {p.title.length > 55 ? p.title.slice(0, 55) + "…" : p.title}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{p.qty}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtBRL(p.revenue)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">-{fmtBRL(p.cost)}</TableCell>
                        <TableCell className={`text-right tabular-nums font-semibold ${grossProfit >= 0 ? "text-success" : "text-destructive"}`}>
                          {fmtBRL(grossProfit)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant={grossMargin >= 30 ? "default" : grossMargin >= 10 ? "secondary" : "destructive"}>
                            {fmtPct(grossMargin)}
                          </Badge>
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
    </div>
  );
};

export default Index;

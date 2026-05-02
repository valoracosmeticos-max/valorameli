import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, Legend,
} from "recharts";
import {
  TrendingUp, TrendingDown, DollarSign, Wallet, Package,
  AlertCircle, ArrowRight, Percent,
} from "lucide-react";
import { format, startOfDay, subDays } from "date-fns";

interface OrderRow {
  id: string; store_id: string; status: string;
  date_created: string; total_amount: number; amount_received: number;
  ml_fees: number; shipping_cost: number;
}
interface ItemRow { order_id: string; quantity: number; cost_price: number }
interface StoreRow { id: string; name: string }
interface AddCostRow {
  amount: number; cost_type: "fixed" | "sporadic"; cost_date: string;
}

const fmtBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const Index = () => {
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [addCosts, setAddCosts] = useState<AddCostRow[]>([]);
  const [period, setPeriod] = useState<string>("30");
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
        supabase.from("order_items").select("order_id, quantity, cost_price"),
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

  const filtered = useMemo(() => {
    const days = Number(period);
    const since = startOfDay(subDays(new Date(), days - 1)).getTime();
    return orders.filter((o) => {
      if (o.status === "cancelled") return false;
      if (new Date(o.date_created).getTime() < since) return false;
      if (storeFilter !== "all" && o.store_id !== storeFilter) return false;
      return true;
    });
  }, [orders, period, storeFilter]);

  // Custos adicionais alocados ao período selecionado
  const additionalForPeriod = useMemo(() => {
    const days = Number(period);
    const since = startOfDay(subDays(new Date(), days - 1)).getTime();
    const now = Date.now();
    let total = 0;
    addCosts.forEach((c) => {
      const amt = Number(c.amount) || 0;
      if (c.cost_type === "fixed") {
        // proporcional: valor mensal × (dias do período / 30)
        total += amt * (days / 30);
      } else {
        const d = new Date(c.cost_date + "T00:00").getTime();
        if (d >= since && d <= now) total += amt;
      }
    });
    return total;
  }, [addCosts, period]);

  const totals = useMemo(() => {
    let revenue = 0, received = 0, fees = 0, cost = 0, shipping = 0;
    filtered.forEach((o) => {
      revenue += o.total_amount;
      received += o.amount_received;
      fees += o.ml_fees;
      shipping += o.shipping_cost;
      cost += costByOrder.get(o.id) ?? 0;
    });
    const profit = received - cost - fees - shipping - additionalForPeriod;
    const margin = received > 0 ? (profit / received) * 100 : 0;
    return { revenue, received, fees, cost, profit, margin, additional: additionalForPeriod, count: filtered.length };
  }, [filtered, costByOrder, additionalForPeriod]);

  const dailyData = useMemo(() => {
    const days = Number(period);
    const buckets = new Map<string, { date: string; revenue: number; profit: number }>();
    for (let i = days - 1; i >= 0; i--) {
      const d = format(subDays(new Date(), i), "dd/MM");
      buckets.set(d, { date: d, revenue: 0, profit: 0 });
    }
    filtered.forEach((o) => {
      const d = format(new Date(o.date_created), "dd/MM");
      const b = buckets.get(d);
      if (!b) return;
      const c = costByOrder.get(o.id) ?? 0;
      b.revenue += o.amount_received;
      b.profit += o.amount_received - c - o.ml_fees - o.shipping_cost;
    });
    return Array.from(buckets.values());
  }, [filtered, costByOrder, period]);

  const byStore = useMemo(() => {
    const map = new Map<string, { name: string; revenue: number; profit: number }>();
    filtered.forEach((o) => {
      const name = stores.find((s) => s.id === o.store_id)?.name ?? "—";
      const cur = map.get(o.store_id) ?? { name, revenue: 0, profit: 0 };
      cur.revenue += o.amount_received;
      cur.profit += o.amount_received - (costByOrder.get(o.id) ?? 0) - o.ml_fees - o.shipping_cost;
      map.set(o.store_id, cur);
    });
    return Array.from(map.values());
  }, [filtered, stores, costByOrder]);

  const cards = [
    { label: "Faturamento", value: fmtBRL(totals.revenue), icon: DollarSign, color: "text-primary" },
    { label: "Recebido", value: fmtBRL(totals.received), icon: Wallet, color: "text-success" },
    { label: "Custo produtos", value: fmtBRL(totals.cost), icon: Package, color: "text-warning" },
    { label: "Custos adicionais", value: fmtBRL(totals.additional), icon: Wallet, color: "text-warning" },
    { label: "Lucro", value: fmtBRL(totals.profit), icon: totals.profit >= 0 ? TrendingUp : TrendingDown,
      color: totals.profit >= 0 ? "text-success" : "text-destructive" },
    { label: "Margem", value: `${totals.margin.toFixed(1)}%`, icon: Percent, color: "text-muted-foreground" },
  ];

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            {totals.count} pedido(s) · cancelados excluídos · Lucro = Recebido − Custo − Tarifa ML − Frete − Custos Adicionais
          </p>
        </div>
        <div className="flex gap-2">
          <Select value={storeFilter} onValueChange={setStoreFilter}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as lojas</SelectItem>
              {stores.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Últimos 7 dias</SelectItem>
              <SelectItem value="30">Últimos 30 dias</SelectItem>
              <SelectItem value="90">Últimos 90 dias</SelectItem>
            </SelectContent>
          </Select>
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
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8, fontSize: 12,
                    }}
                    formatter={(v: number) => fmtBRL(v)}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="revenue" name="Recebido"
                    stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="profit" name="Lucro"
                    stroke="hsl(var(--success))" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-soft border-border/60">
          <CardHeader><CardTitle>Comparativo entre lojas</CardTitle></CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byStore} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12}
                    tickFormatter={(v) => `R$${Math.round(v / 1000)}k`} />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8, fontSize: 12,
                    }}
                    formatter={(v: number) => fmtBRL(v)}
                  />
                  <Legend />
                  <Bar dataKey="revenue" name="Recebido" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="profit" name="Lucro" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Index;

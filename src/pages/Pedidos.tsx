import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { ShoppingCart, Search } from "lucide-react";
import { format } from "date-fns";

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

const Pedidos = () => {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
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
    })();
  }, []);

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
      if (storeFilter !== "all" && o.store_id !== storeFilter) return false;
      if (statusFilter !== "all" && o.status !== statusFilter) return false;
      if (search && !o.ml_order_id.includes(search)) return false;
      return true;
    });
  }, [orders, storeFilter, statusFilter, search]);

  const storeName = (id: string) => stores.find((s) => s.id === id)?.name ?? "—";

  const computeProfit = (o: OrderRow) => {
    const its = itemsByOrder.get(o.id) ?? [];
    const cost = its.reduce((acc, i) => acc + i.cost_price * i.quantity, 0);
    const profit = (o.amount_received || 0) - cost - (o.ml_fees || 0) - (o.shipping_cost || 0);
    return { cost, profit };
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Pedidos</h1>
        <p className="text-muted-foreground mt-1">Histórico de vendas com cálculo de lucro</p>
      </div>

      <Card className="shadow-soft border-border/60">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <CardTitle>Lista ({filtered.length})</CardTitle>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por nº do pedido"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 w-56"
              />
            </div>
            <Select value={storeFilter} onValueChange={setStoreFilter}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as lojas</SelectItem>
                {stores.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos status</SelectItem>
                <SelectItem value="paid">Pago</SelectItem>
                <SelectItem value="cancelled">Cancelado</SelectItem>
                <SelectItem value="confirmed">Confirmado</SelectItem>
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
                    <TableHead className="text-right">Custo</TableHead>
                    <TableHead className="text-right">Lucro</TableHead>
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
                        <TableCell className="text-right tabular-nums text-muted-foreground">-{fmtBRL(cost)}</TableCell>
                        <TableCell className={`text-right tabular-nums font-semibold ${profit >= 0 ? "text-success" : "text-destructive"}`}>
                          {fmtBRL(profit)}
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

export default Pedidos;

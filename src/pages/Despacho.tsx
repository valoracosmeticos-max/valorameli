import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Truck, Search, Package } from "lucide-react";
import { format, subDays, startOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";

interface OrderRow {
  id: string;
  ml_order_id: string;
  date_created: string;
  status: string;
  store_id: string;
  buyer_name: string | null;
}

interface ItemRow {
  order_id: string;
  title: string;
  quantity: number;
}

interface StoreRow {
  id: string;
  name: string;
}

const statusLabel: Record<string, string> = {
  paid: "Pago",
  confirmed: "Confirmado",
  pending: "Pendente",
  cancelled: "Cancelado",
  invalid: "Inválido",
};

const statusVariant = (s: string): "default" | "secondary" | "destructive" | "outline" => {
  if (s === "paid") return "default";
  if (s === "confirmed") return "secondary";
  if (s === "cancelled") return "destructive";
  return "outline";
};

const PERIOD_OPTIONS = [
  { value: "1", label: "Hoje" },
  { value: "7", label: "Últimos 7 dias" },
  { value: "30", label: "Últimos 30 dias" },
  { value: "all", label: "Todos" },
];

export default function Despacho() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState("7");
  const [storeFilter, setStoreFilter] = useState("all");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [ordRes, itmRes, stRes] = await Promise.all([
        supabase
          .from("orders")
          .select("id, ml_order_id, date_created, status, store_id, buyer_name")
          .in("status", ["paid", "confirmed", "pending"])
          .order("date_created", { ascending: false })
          .limit(500),
        supabase
          .from("order_items")
          .select("order_id, title, quantity")
          .limit(2000),
        supabase.from("stores").select("id, name"),
      ]);
      setOrders((ordRes.data ?? []) as OrderRow[]);
      setItems((itmRes.data ?? []) as ItemRow[]);
      setStores((stRes.data ?? []) as StoreRow[]);
      setLoading(false);
    };
    load();
  }, []);

  const storeMap = useMemo(() => new Map(stores.map((s) => [s.id, s.name])), [stores]);

  const itemsByOrder = useMemo(() => {
    const m = new Map<string, ItemRow[]>();
    for (const it of items) {
      const arr = m.get(it.order_id) ?? [];
      arr.push(it);
      m.set(it.order_id, arr);
    }
    return m;
  }, [items]);

  const sinceDate = useMemo(() => {
    if (period === "all") return null;
    return startOfDay(subDays(new Date(), Number(period) - 1));
  }, [period]);

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      if (sinceDate && new Date(o.date_created) < sinceDate) return false;
      if (storeFilter !== "all" && o.store_id !== storeFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const nameMatch = (o.buyer_name ?? "").toLowerCase().includes(q);
        const idMatch = o.ml_order_id.includes(q);
        const itemMatch = (itemsByOrder.get(o.id) ?? []).some((it) =>
          it.title.toLowerCase().includes(q)
        );
        if (!nameMatch && !idMatch && !itemMatch) return false;
      }
      return true;
    });
  }, [orders, sinceDate, storeFilter, search, itemsByOrder]);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-primary flex items-center justify-center shadow-glow">
            <Truck className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Despacho</h1>
            <p className="text-sm text-muted-foreground">
              Lista de pedidos para expedição · {filtered.length} pedido{filtered.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar cliente, pedido ou produto..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIOD_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {stores.length > 1 && (
          <Select value={storeFilter} onValueChange={setStoreFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Todas as lojas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as lojas</SelectItem>
              {stores.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="text-center py-16 text-muted-foreground">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">Nenhum pedido encontrado.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((o) => {
            const its = itemsByOrder.get(o.id) ?? [];
            const dateStr = format(new Date(o.date_created), "dd/MM/yy HH:mm", { locale: ptBR });
            const storeName = storeMap.get(o.store_id) ?? "—";

            return (
              <Card key={o.id} className="border border-border rounded-xl shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-4 space-y-3">
                  {/* Topo: status + loja */}
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant={statusVariant(o.status)} className="text-xs">
                      {statusLabel[o.status] ?? o.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground truncate">{storeName}</span>
                  </div>

                  {/* Nome do cliente */}
                  <div>
                    <p className="font-semibold text-foreground text-sm leading-tight truncate">
                      {o.buyer_name ?? "—"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">{dateStr}</p>
                  </div>

                  {/* Nº do pedido */}
                  <p className="text-xs font-mono text-muted-foreground truncate">
                    #{o.ml_order_id}
                  </p>

                  {/* Produtos */}
                  <div className="border-t border-border pt-3 space-y-1.5">
                    {its.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic">Sem itens</p>
                    ) : (
                      its.map((it, idx) => (
                        <div key={idx} className="flex items-start gap-2">
                          <Package className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                          <p className="text-xs text-foreground leading-snug">
                            <span className="font-medium">{it.quantity}×</span> {it.title}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

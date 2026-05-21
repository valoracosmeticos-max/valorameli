import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Package, Search, Save } from "lucide-react";

interface ProductRow {
  id: string;
  store_id: string;
  ml_item_id: string;
  title: string;
  sku: string | null;
  thumbnail: string | null;
  cost_price: number;
}
interface StoreRow { id: string; name: string }

const fmtBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const Produtos = () => {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [avgShipping, setAvgShipping] = useState<Record<string, number>>({});

  const load = async () => {
    setLoading(true);
    const [{ data: storesData }, { data: prodData, error }, { data: itemsData }] = await Promise.all([
      supabase.from("stores").select("id, name").order("created_at"),
      supabase.from("products").select("id, store_id, ml_item_id, title, sku, thumbnail, cost_price").order("title"),
      supabase.from("order_items").select("product_id, order_id").not("product_id", "is", null),
    ]);
    if (error) toast.error(error.message);
    setStores(storesData ?? []);
    setProducts((prodData ?? []) as ProductRow[]);

    if (itemsData?.length) {
      const orderIds = [...new Set(itemsData.map((i) => i.order_id))];
      const { data: ordersData } = await supabase
        .from("orders")
        .select("id, shipping_cost")
        .in("id", orderIds);

      const acc: Record<string, { total: number; count: number }> = {};
      itemsData.forEach((item) => {
        if (!item.product_id) return;
        const sc = Number(ordersData?.find((o) => o.id === item.order_id)?.shipping_cost ?? 0);
        if (!acc[item.product_id]) acc[item.product_id] = { total: 0, count: 0 };
        acc[item.product_id].total += sc;
        acc[item.product_id].count += 1;
      });
      const avg: Record<string, number> = {};
      for (const [pid, { total, count }] of Object.entries(acc)) {
        avg[pid] = count > 0 ? total / count : 0;
      }
      setAvgShipping(avg);
    }

    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (storeFilter !== "all" && p.store_id !== storeFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!p.title.toLowerCase().includes(q)
          && !p.ml_item_id.toLowerCase().includes(q)
          && !(p.sku ?? "").toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [products, storeFilter, search]);

  const storeName = (id: string) => stores.find((s) => s.id === id)?.name ?? "—";

  const saveCost = async (p: ProductRow) => {
    const raw = edits[p.id];
    if (raw === undefined) return;
    const value = Number(raw.replace(",", "."));
    if (Number.isNaN(value) || value < 0) {
      toast.error("Custo inválido");
      return;
    }
    setSavingId(p.id);
    const { error } = await supabase.from("products").update({ cost_price: value }).eq("id", p.id);
    if (error) {
      setSavingId(null);
      toast.error(error.message);
      return;
    }
    // Propaga para os order_items existentes (atualiza pedidos e dashboard)
    const { error: itemsErr, count } = await supabase
      .from("order_items")
      .update({ cost_price: value }, { count: "exact" })
      .eq("product_id", p.id);
    setSavingId(null);
    if (itemsErr) {
      toast.warning("Custo salvo, mas falhou ao atualizar pedidos: " + itemsErr.message);
    } else {
      toast.success(`Custo atualizado · ${count ?? 0} item(ns) de pedidos recalculado(s)`);
    }
    setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, cost_price: value } : x)));
    setEdits((prev) => {
      const n = { ...prev };
      delete n[p.id];
      return n;
    });
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Produtos & Custos</h1>
        <p className="text-muted-foreground mt-1">Cadastre o custo de cada produto para calcular o lucro</p>
      </div>

      <Card className="shadow-soft border-border/60">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <CardTitle>Catálogo ({filtered.length})</CardTitle>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por título, SKU ou ML ID"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 w-72"
              />
            </div>
            <Select value={storeFilter} onValueChange={setStoreFilter}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as lojas</SelectItem>
                {stores.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Carregando...</p>
          ) : filtered.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center gap-2 text-muted-foreground">
              <Package className="h-12 w-12 opacity-30" />
              <p>Nenhum produto encontrado.</p>
              <p className="text-xs">Sincronize uma loja em Configurações.</p>
            </div>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead>Loja</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead className="text-right">Frete Médio</TableHead>
                    <TableHead className="text-right">Custo (R$)</TableHead>
                    <TableHead className="w-20"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((p) => {
                    const editing = edits[p.id];
                    const dirty = editing !== undefined && Number(editing.replace(",", ".")) !== p.cost_price;
                    return (
                      <TableRow key={p.id}>
                        <TableCell>
                          <div className="flex items-center gap-3 min-w-0">
                            {p.thumbnail ? (
                              <img src={p.thumbnail} alt="" className="h-10 w-10 rounded object-cover border" />
                            ) : (
                              <div className="h-10 w-10 rounded bg-muted flex items-center justify-center">
                                <Package className="h-4 w-4 text-muted-foreground" />
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="font-medium truncate max-w-md">{p.title}</p>
                              <p className="text-xs text-muted-foreground">{p.ml_item_id}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell><Badge variant="secondary">{storeName(p.store_id)}</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground">{p.sku ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {avgShipping[p.id] > 0 ? `-${fmtBRL(avgShipping[p.id])}` : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="text"
                            inputMode="decimal"
                            className="w-28 ml-auto text-right"
                            value={editing ?? String(p.cost_price)}
                            onChange={(e) => setEdits((prev) => ({ ...prev, [p.id]: e.target.value }))}
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant={dirty ? "default" : "ghost"}
                            disabled={!dirty || savingId === p.id}
                            onClick={() => saveCost(p)}
                          >
                            <Save className="h-3.5 w-3.5" />
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
    </div>
  );
};

export default Produtos;

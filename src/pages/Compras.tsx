import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, ShoppingBag } from "lucide-react";
import { CompraDialog } from "@/components/compras/CompraDialog";
import { ComprasTable, Purchase } from "@/components/compras/ComprasTable";
import { useAuth } from "@/hooks/useAuth";

interface StoreRow { id: string; name: string }

const fmtR = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const Compras = () => {
  const { user } = useAuth();
  const [stores,       setStores]       = useState<StoreRow[]>([]);
  const [storeFilter,  setStoreFilter]  = useState<string>("");
  const [purchases,    setPurchases]    = useState<Purchase[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [dialogOpen,   setDialogOpen]   = useState(false);
  const [editId,       setEditId]       = useState<string | null>(null);

  // Carregar lojas
  useEffect(() => {
    supabase
      .from("stores")
      .select("id, name")
      .order("created_at")
      .then(({ data }) => {
        const rows = data ?? [];
        setStores(rows);
        if (rows.length > 0) setStoreFilter(rows[0].id);
      });
  }, []);

  const loadPurchases = useCallback(async () => {
    if (!storeFilter) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("purchases")
      .select("id, supplier, description, invoice_number, purchase_date, due_date, paid_date, total_amount, status")
      .eq("store_id", storeFilter)
      .order("purchase_date", { ascending: false });
    if (error) toast.error(error.message);
    setPurchases((data ?? []) as Purchase[]);
    setLoading(false);
  }, [storeFilter]);

  useEffect(() => { loadPurchases(); }, [loadPurchases]);

  const handleDelete = async (id: string) => {
    if (!confirm("Excluir esta compra?")) return;
    await supabase.from("purchase_items").delete().eq("purchase_id", id);
    const { error } = await supabase.from("purchases").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Compra removida");
    loadPurchases();
  };

  const handleEdit = (id: string) => { setEditId(id); setDialogOpen(true); };

  const handleNew = () => { setEditId(null); setDialogOpen(true); };

  // Calcular totais
  const totalPending = purchases.filter((p) => p.status === "pending").reduce((s, p) => s + p.total_amount, 0);
  const totalOverdue = purchases.filter((p) => p.status === "overdue").reduce((s, p) => s + p.total_amount, 0);
  const totalPaid    = purchases.filter((p) => p.status === "paid").reduce((s, p) => s + p.total_amount, 0);

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Compras</h1>
          <p className="text-muted-foreground mt-1">Registre notas fiscais e compras para calcular PMP e NCG</p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={storeFilter} onValueChange={setStoreFilter}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Selecionar loja" /></SelectTrigger>
            <SelectContent>
              {stores.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={handleNew} disabled={!storeFilter}>
            <Plus className="h-4 w-4 mr-2" />Nova Compra
          </Button>
        </div>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="shadow-soft border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">A Pagar</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{fmtR(totalPending)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {purchases.filter((p) => p.status === "pending").length} compra(s)
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-soft border-destructive/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-destructive">Vencido</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-destructive">{fmtR(totalOverdue)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {purchases.filter((p) => p.status === "overdue").length} compra(s)
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-soft border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pago (total)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-600">{fmtR(totalPaid)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {purchases.filter((p) => p.status === "paid").length} compra(s)
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabela */}
      <Card className="shadow-soft border-border/60">
        <CardHeader>
          <CardTitle>Histórico de Compras</CardTitle>
        </CardHeader>
        <CardContent>
          {!storeFilter ? (
            <div className="py-16 text-center text-muted-foreground">
              <ShoppingBag className="h-12 w-12 opacity-30 mx-auto mb-3" />
              <p>Selecione uma loja para ver as compras</p>
            </div>
          ) : loading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Carregando...</p>
          ) : (
            <ComprasTable
              purchases={purchases}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          )}
        </CardContent>
      </Card>

      {storeFilter && user && (
        <CompraDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          onSaved={loadPurchases}
          storeId={storeFilter}
          userId={user.id}
          editId={editId}
        />
      )}
    </div>
  );
};

export default Compras;

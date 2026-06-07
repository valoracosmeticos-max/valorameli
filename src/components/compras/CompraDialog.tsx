import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

interface Product { id: string; title: string; cost_price: number }
interface ItemRow  { product_id: string | null; description: string; quantity: number; unit_cost: number }

interface Props {
  open:      boolean;
  onClose:   () => void;
  onSaved:   () => void;
  storeId:   string;
  userId:    string;
  editId?:   string | null;
}

const today = () => new Date().toISOString().slice(0, 10);

export const CompraDialog = ({ open, onClose, onSaved, storeId, userId, editId }: Props) => {
  const [supplier,       setSupplier]       = useState("");
  const [description,    setDescription]    = useState("");
  const [invoiceNumber,  setInvoiceNumber]  = useState("");
  const [purchaseDate,   setPurchaseDate]   = useState(today());
  const [dueDate,        setDueDate]        = useState("");
  const [paidDate,       setPaidDate]       = useState("");
  const [notes,          setNotes]          = useState("");
  const [items,          setItems]          = useState<ItemRow[]>([
    { product_id: null, description: "", quantity: 1, unit_cost: 0 },
  ]);
  const [products,       setProducts]       = useState<Product[]>([]);
  const [saving,         setSaving]         = useState(false);

  // Buscar produtos da loja
  useEffect(() => {
    if (!storeId) return;
    supabase
      .from("products")
      .select("id, title, cost_price")
      .eq("store_id", storeId)
      .order("title")
      .then(({ data }) => setProducts(data ?? []));
  }, [storeId]);

  // Carregar dados de edição
  useEffect(() => {
    if (!editId || !open) return;
    supabase
      .from("purchases")
      .select("*, purchase_items(*)")
      .eq("id", editId)
      .single()
      .then(({ data }) => {
        if (!data) return;
        setSupplier(data.supplier ?? "");
        setDescription(data.description ?? "");
        setInvoiceNumber(data.invoice_number ?? "");
        setPurchaseDate(data.purchase_date);
        setDueDate(data.due_date);
        setPaidDate(data.paid_date ?? "");
        setNotes(data.notes ?? "");
        setItems(
          (data.purchase_items ?? []).map((i: any) => ({
            product_id: i.product_id ?? null,
            description: i.description,
            quantity: i.quantity,
            unit_cost: Number(i.unit_cost),
          })) ?? [{ product_id: null, description: "", quantity: 1, unit_cost: 0 }]
        );
      });
  }, [editId, open]);

  const totalAmount = items.reduce((s, i) => s + i.quantity * i.unit_cost, 0);

  const reset = () => {
    setSupplier(""); setDescription(""); setInvoiceNumber("");
    setPurchaseDate(today()); setDueDate(""); setPaidDate(""); setNotes("");
    setItems([{ product_id: null, description: "", quantity: 1, unit_cost: 0 }]);
  };

  const handleClose = () => { reset(); onClose(); };

  const save = async () => {
    if (!supplier.trim() || !purchaseDate || !dueDate) {
      toast.error("Preencha fornecedor, data da compra e vencimento.");
      return;
    }
    const validItems = items.filter((i) => i.description.trim() && i.quantity > 0 && i.unit_cost >= 0);
    if (validItems.length === 0) {
      toast.error("Adicione ao menos um item válido.");
      return;
    }

    setSaving(true);
    try {
      const overdue  = new Date(dueDate) < new Date() && !paidDate;
      const purchaseRow = {
        user_id:        userId,
        store_id:       storeId,
        supplier:       supplier.trim(),
        description:    description.trim() || null,
        invoice_number: invoiceNumber.trim() || null,
        purchase_date:  purchaseDate,
        due_date:       dueDate,
        paid_date:      paidDate || null,
        total_amount:   totalAmount,
        status:         paidDate ? "paid" : overdue ? "overdue" : "pending",
        notes:          notes.trim() || null,
      };

      let purchaseId: string;
      if (editId) {
        const { error } = await supabase.from("purchases").update(purchaseRow).eq("id", editId);
        if (error) throw error;
        await supabase.from("purchase_items").delete().eq("purchase_id", editId);
        purchaseId = editId;
      } else {
        const { data, error } = await supabase.from("purchases").insert(purchaseRow).select("id").single();
        if (error) throw error;
        purchaseId = data.id;
      }

      const { error: itemsErr } = await supabase.from("purchase_items").insert(
        validItems.map((i) => ({ purchase_id: purchaseId, ...i }))
      );
      if (itemsErr) throw itemsErr;

      toast.success(editId ? "Compra atualizada" : "Compra registrada");
      reset(); onSaved(); onClose();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar compra");
    } finally {
      setSaving(false);
    }
  };

  const updateItem = (idx: number, field: keyof ItemRow, value: any) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)));

  const fillFromProduct = (idx: number, productId: string) => {
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    setItems((prev) =>
      prev.map((it, i) =>
        i === idx ? { ...it, product_id: productId, description: p.title, unit_cost: p.cost_price } : it
      )
    );
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editId ? "Editar Compra" : "Nova Compra / Nota Fiscal"}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 py-2">
          <div className="col-span-2">
            <Label>Fornecedor *</Label>
            <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Nome do fornecedor" />
          </div>

          <div>
            <Label>Nº Nota Fiscal</Label>
            <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="NF-e 000123" />
          </div>
          <div>
            <Label>Descrição</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Resumo da compra" />
          </div>

          <div>
            <Label>Data da Compra / NF *</Label>
            <Input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
          </div>
          <div>
            <Label>Vencimento *</Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>

          <div className="col-span-2">
            <Label>Data de Pagamento <span className="text-muted-foreground text-xs">(deixe vazio se ainda não pago)</span></Label>
            <Input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
          </div>

          {/* Itens */}
          <div className="col-span-2 space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold">Itens</Label>
              <Button
                size="sm" variant="outline"
                onClick={() => setItems((prev) => [...prev, { product_id: null, description: "", quantity: 1, unit_cost: 0 }])}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />Adicionar item
              </Button>
            </div>

            {/* Cabeçalho */}
            <div className="grid grid-cols-12 gap-2 text-xs text-muted-foreground px-1">
              <span className="col-span-4">Produto (opcional)</span>
              <span className="col-span-3">Descrição *</span>
              <span className="col-span-2 text-right">Qtd</span>
              <span className="col-span-2 text-right">Custo unit.</span>
            </div>

            {items.map((item, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-4">
                  <Select
                    value={item.product_id ?? "__manual__"}
                    onValueChange={(v) =>
                      v === "__manual__" ? updateItem(idx, "product_id", null) : fillFromProduct(idx, v)
                    }
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Produto..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__manual__">— Digitar manualmente —</SelectItem>
                      {products.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-3">
                  <Input
                    className="h-8 text-xs"
                    placeholder="Descrição"
                    value={item.description}
                    onChange={(e) => updateItem(idx, "description", e.target.value)}
                  />
                </div>
                <div className="col-span-2">
                  <Input
                    className="h-8 text-xs text-right"
                    type="number" min="1"
                    value={item.quantity}
                    onChange={(e) => updateItem(idx, "quantity", Number(e.target.value))}
                  />
                </div>
                <div className="col-span-2">
                  <Input
                    className="h-8 text-xs text-right"
                    type="number" min="0" step="0.01"
                    value={item.unit_cost}
                    onChange={(e) => updateItem(idx, "unit_cost", Number(e.target.value))}
                  />
                </div>
                <div className="col-span-1 flex justify-center">
                  {items.length > 1 && (
                    <Button
                      size="icon" variant="ghost" className="h-8 w-8"
                      onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  )}
                </div>
              </div>
            ))}

            <p className="text-sm font-semibold text-right pr-10">
              Total: {totalAmount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
            </p>
          </div>

          <div className="col-span-2">
            <Label>Observações</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Notas adicionais..." />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Salvando..." : editId ? "Salvar alterações" : "Registrar Compra"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Trash2, Wallet, Pencil } from "lucide-react";
import { format } from "date-fns";

interface CostRow {
  id: string;
  description: string;
  amount: number;
  cost_type: "fixed" | "sporadic";
  cost_date: string;
  category: string | null;
  notes: string | null;
}

const fmtBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const emptyForm = () => ({
  id: "",
  description: "",
  amount: "",
  cost_type: "sporadic" as "fixed" | "sporadic",
  cost_date: format(new Date(), "yyyy-MM-dd"),
  category: "",
  notes: "",
});

const CustosAdicionais = () => {
  const [costs, setCosts] = useState<CostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [filterType, setFilterType] = useState<string>("all");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("additional_costs")
      .select("id, description, amount, cost_type, cost_date, category, notes")
      .order("cost_date", { ascending: false });
    if (error) toast.error(error.message);
    setCosts((data ?? []) as CostRow[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (filterType === "all") return costs;
    return costs.filter((c) => c.cost_type === filterType);
  }, [costs, filterType]);

  const totals = useMemo(() => {
    const fixed = costs.filter((c) => c.cost_type === "fixed").reduce((a, c) => a + Number(c.amount), 0);
    const sporadic = costs.filter((c) => c.cost_type === "sporadic").reduce((a, c) => a + Number(c.amount), 0);
    return { fixed, sporadic, total: fixed + sporadic };
  }, [costs]);

  const openNew = () => {
    setForm(emptyForm());
    setOpen(true);
  };

  const openEdit = (c: CostRow) => {
    setForm({
      id: c.id,
      description: c.description,
      amount: String(c.amount),
      cost_type: c.cost_type,
      cost_date: c.cost_date,
      category: c.category ?? "",
      notes: c.notes ?? "",
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.description.trim()) return toast.error("Descrição obrigatória");
    const amountNum = Number(form.amount.replace(",", "."));
    if (Number.isNaN(amountNum) || amountNum <= 0) return toast.error("Valor inválido");

    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      toast.error("Sessão expirada");
      setSaving(false);
      return;
    }

    const payload = {
      user_id: userData.user.id,
      description: form.description.trim(),
      amount: amountNum,
      cost_type: form.cost_type,
      cost_date: form.cost_date,
      category: form.category.trim() || null,
      notes: form.notes.trim() || null,
    };

    const { error } = form.id
      ? await supabase.from("additional_costs").update(payload).eq("id", form.id)
      : await supabase.from("additional_costs").insert(payload);

    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(form.id ? "Custo atualizado" : "Custo adicionado");
    setOpen(false);
    setForm(emptyForm());
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Remover este custo?")) return;
    const { error } = await supabase.from("additional_costs").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Removido");
    load();
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Custos Adicionais</h1>
          <p className="text-muted-foreground mt-1">
            Custos operacionais (embalagens, sistemas, etc.) usados no cálculo do lucro
          </p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setForm(emptyForm()); }}>
          <DialogTrigger asChild>
            <Button onClick={openNew}><Plus className="h-4 w-4 mr-2" />Adicionar custo</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{form.id ? "Editar custo" : "Novo custo"}</DialogTitle>
              <DialogDescription>
                Custos fixos contam todo mês. Esporádicos só no mês da data informada.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Descrição *</Label>
                <Input
                  placeholder="Ex: Embalagens"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  maxLength={120}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Valor (R$) *</Label>
                  <Input
                    inputMode="decimal"
                    placeholder="0,00"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Tipo</Label>
                  <Select value={form.cost_type} onValueChange={(v) => setForm({ ...form, cost_type: v as any })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fixed">Fixo (mensal recorrente)</SelectItem>
                      <SelectItem value="sporadic">Esporádico (só no mês)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Data</Label>
                  <Input
                    type="date"
                    value={form.cost_date}
                    onChange={(e) => setForm({ ...form, cost_date: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Categoria</Label>
                  <Input
                    placeholder="Ex: Logística"
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    maxLength={60}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Notas</Label>
                <Textarea
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  maxLength={500}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
              <Button onClick={save} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="shadow-soft border-border/60">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Fixos / mês</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold tabular-nums">{fmtBRL(totals.fixed)}</div></CardContent>
        </Card>
        <Card className="shadow-soft border-border/60">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Esporádicos (total)</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold tabular-nums">{fmtBRL(totals.sporadic)}</div></CardContent>
        </Card>
        <Card className="shadow-soft border-border/60">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total cadastrado</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold tabular-nums">{fmtBRL(totals.total)}</div></CardContent>
        </Card>
      </div>

      <Card className="shadow-soft border-border/60">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <CardTitle>Lançamentos ({filtered.length})</CardTitle>
            <CardDescription>Use a aba Dashboard para ver o impacto no lucro</CardDescription>
          </div>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os tipos</SelectItem>
              <SelectItem value="fixed">Apenas fixos</SelectItem>
              <SelectItem value="sporadic">Apenas esporádicos</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Carregando...</p>
          ) : filtered.length === 0 ? (
            <div className="h-48 flex flex-col items-center justify-center gap-2 text-muted-foreground">
              <Wallet className="h-10 w-10 opacity-30" />
              <p>Nenhum custo cadastrado.</p>
            </div>
          ) : (
            <div className="rounded-lg border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="w-24"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="whitespace-nowrap text-sm">
                        {format(new Date(c.cost_date + "T00:00"), "dd/MM/yyyy")}
                      </TableCell>
                      <TableCell>
                        <p className="font-medium">{c.description}</p>
                        {c.notes && <p className="text-xs text-muted-foreground truncate max-w-md">{c.notes}</p>}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{c.category ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={c.cost_type === "fixed" ? "default" : "secondary"}>
                          {c.cost_type === "fixed" ? "Fixo" : "Esporádico"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{fmtBRL(Number(c.amount))}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(c)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => remove(c.id)}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default CustosAdicionais;

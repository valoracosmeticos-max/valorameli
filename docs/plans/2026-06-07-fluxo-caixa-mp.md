# Fluxo de Caixa — Integração Mercado Pago

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrar a API do Mercado Pago para exibir calendário de recebimentos e calcular indicadores financeiros (PMR, PMP, Ciclo de Estoque, Ciclo Financeiro, NCG) a partir de dados reais de pagamentos, estoque e compras.

**Architecture:** O token ML existente (`stores.access_token`) já funciona para a API do Mercado Pago (mesma infraestrutura OAuth). Uma nova edge function `mp-sync-payments` usa esse token para buscar `money_release_date` de cada pagamento via `/v1/payments/search`, cruzando pelo `external_reference` = `ml_order_id`. Um novo módulo de Compras permite registrar NFs de fornecedor para calcular PMP. O dashboard Fluxo de Caixa agrega tudo.

**Tech Stack:** React 18 + TypeScript, shadcn/ui, React Query, Recharts (já no projeto via chart.tsx), Supabase (Postgres + Edge Functions Deno), date-fns, Mercado Pago API v1

---

## Mapa de Arquivos

### Criar (novos)
| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/YYYYMMDD_fluxo_caixa.sql` | Schema: payments_releases, purchases, purchase_items, stock em products |
| `supabase/functions/mp-sync-payments/index.ts` | Busca pagamentos MP, salva money_release_date |
| `src/pages/FluxoCaixa.tsx` | Página principal: calendário + indicadores |
| `src/pages/Compras.tsx` | CRUD de compras de fornecedor (NF/PMP) |
| `src/components/cashflow/CalendarioRecebimentos.tsx` | Timeline semanal de liberações futuras |
| `src/components/cashflow/IndicadoresCard.tsx` | Cards PMR / PMP / CE / NCG |
| `src/components/cashflow/CicloChart.tsx` | Gráfico de barras: Ciclo Operacional e Financeiro |
| `src/components/cashflow/ContasReceberTable.tsx` | Lista de pagamentos pendentes com datas |
| `src/components/compras/CompraDialog.tsx` | Formulário modal de nova/editar compra |
| `src/components/compras/ComprasTable.tsx` | Tabela de compras com status e ações |
| `src/hooks/useMpSync.ts` | Trigger sync + estado de loading |
| `src/hooks/useCashFlow.ts` | Cálculos: PMR, PMP, CE, NCG, Ciclo Financeiro |

### Modificar (existentes)
| Arquivo | O que muda |
|---|---|
| `src/App.tsx` | Adicionar rotas `/fluxo-caixa` e `/compras` |
| `src/components/AppLayout.tsx` | Adicionar itens no nav: Fluxo de Caixa, Compras |
| `src/pages/Configuracoes.tsx` | Adicionar botão "Sincronizar Pagamentos MP" e campo estoque nos produtos |
| `src/pages/Produtos.tsx` | Adicionar coluna e editor de estoque |

---

## Task 1: Migração do Banco de Dados

**Files:**
- Create: `supabase/migrations/20260607_fluxo_caixa.sql`

### Contexto
O schema atual (`stores`, `products`, `orders`, `order_items`) não tem: campo de estoque em produtos, pagamentos MP com money_release_date, nem tabela de compras.

- [ ] **Step 1: Criar o arquivo de migração**

```sql
-- supabase/migrations/20260607_fluxo_caixa.sql

-- 1. Estoque nos produtos
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS stock INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stock_updated_at TIMESTAMPTZ;

-- 2. Liberações de pagamentos MP
-- Cruzamento: ml_order_id (EXTERNAL_REFERENCE no MP) ↔ orders.ml_order_id
CREATE TABLE IF NOT EXISTS public.payments_releases (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL,
  store_id              UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  mp_payment_id         TEXT NOT NULL,
  ml_order_id           TEXT,
  order_db_id           UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  date_created          TIMESTAMPTZ,
  date_approved         TIMESTAMPTZ,
  money_release_date    TIMESTAMPTZ,
  money_release_status  TEXT,
  transaction_amount    NUMERIC(12,2),
  net_received_amount   NUMERIC(12,2),
  fee_amount            NUMERIC(12,2),
  shipping_fee_amount   NUMERIC(12,2),
  financing_fee_amount  NUMERIC(12,2),
  taxes_amount          NUMERIC(12,2),
  coupon_amount         NUMERIC(12,2),
  installments          INTEGER,
  payment_method_id     TEXT,
  payment_method_type   TEXT,
  status                TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(store_id, mp_payment_id)
);

ALTER TABLE public.payments_releases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own payments_releases" ON public.payments_releases
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_pr_store       ON public.payments_releases(store_id);
CREATE INDEX idx_pr_release     ON public.payments_releases(money_release_date);
CREATE INDEX idx_pr_ml_order    ON public.payments_releases(ml_order_id);
CREATE INDEX idx_pr_status      ON public.payments_releases(money_release_status);

CREATE TRIGGER trg_pr_updated BEFORE UPDATE ON public.payments_releases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Compras de fornecedor (para PMP)
CREATE TABLE IF NOT EXISTS public.purchases (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL,
  store_id        UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  supplier        TEXT NOT NULL,
  description     TEXT,
  invoice_number  TEXT,
  purchase_date   DATE NOT NULL,
  due_date        DATE NOT NULL,
  paid_date       DATE,
  total_amount    NUMERIC(12,2) NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'paid', 'overdue')),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own purchases" ON public.purchases
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_purchases_user  ON public.purchases(user_id);
CREATE INDEX idx_purchases_store ON public.purchases(store_id);
CREATE INDEX idx_purchases_due   ON public.purchases(due_date);

CREATE TRIGGER trg_purchases_updated BEFORE UPDATE ON public.purchases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Itens das compras
CREATE TABLE IF NOT EXISTS public.purchase_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id  UUID NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
  product_id   UUID REFERENCES public.products(id) ON DELETE SET NULL,
  description  TEXT NOT NULL,
  quantity     INTEGER NOT NULL DEFAULT 1,
  unit_cost    NUMERIC(12,2) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.purchase_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own purchase_items" ON public.purchase_items
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.purchases p
      WHERE p.id = purchase_items.purchase_id
        AND p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.purchases p
      WHERE p.id = purchase_items.purchase_id
        AND p.user_id = auth.uid()
    )
  );
CREATE INDEX idx_pi_purchase ON public.purchase_items(purchase_id);
CREATE INDEX idx_pi_product  ON public.purchase_items(product_id);
```

- [ ] **Step 2: Aplicar via Lovable**

No chat do Lovable, enviar:
```
Apply this SQL migration to the Supabase database. Run it in the SQL editor:
[colar o SQL acima]
```
OU acessar o Supabase Studio → SQL Editor → colar e executar.

- [ ] **Step 3: Verificar**

No Supabase Studio → Table Editor, confirmar:
- `products` tem coluna `stock`
- Tabelas `payments_releases`, `purchases`, `purchase_items` existem
- RLS está ativo em todas

- [ ] **Step 4: Commit**
```bash
git add supabase/migrations/20260607_fluxo_caixa.sql
git commit -m "feat: migração DB para fluxo de caixa (payments_releases, purchases, stock)"
```

---

## Task 2: Edge Function — mp-sync-payments

**Files:**
- Create: `supabase/functions/mp-sync-payments/index.ts`

### Contexto
O `stores.access_token` (token ML `APP_USR-...`) funciona para a API MP em `api.mercadopago.com`. O endpoint `/v1/payments/search` aceita `external_reference` que é o `ml_order_id`. O campo `money_release_date` indica quando o dinheiro será liberado.

Lógica:
1. Recebe `store_id` e `days` (padrão 90)
2. Busca todos os pagamentos MP do período via `/v1/payments/search`
3. Para cada pagamento: tenta cruzar com `orders` via `external_reference` = `ml_order_id`
4. Faz upsert em `payments_releases`

- [ ] **Step 1: Criar o arquivo**

```typescript
// supabase/functions/mp-sync-payments/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MP_API = "https://api.mercadopago.com";

async function mpGet(url: string, token: string): Promise<any> {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`MP API ${r.status}: ${txt.slice(0, 200)}`);
  }
  return r.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl  = Deno.env.get("SUPABASE_URL")!;
    const anonKey      = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;
    const admin  = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const storeId: string | null = body.store_id ?? null;
    const days = Number(body.days ?? 90);

    // Buscar lojas do usuário
    const storeQuery = admin.from("stores").select("id, access_token, ml_seller_id").eq("user_id", userId);
    if (storeId) storeQuery.eq("id", storeId);
    const { data: stores, error: stErr } = await storeQuery;
    if (stErr || !stores?.length) {
      return new Response(JSON.stringify({ error: "Nenhuma loja encontrada" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const summary: any[] = [];

    for (const store of stores) {
      const token = store.access_token;
      if (!token) { summary.push({ store_id: store.id, error: "Sem token" }); continue; }

      const beginDate = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 19) + ".000-00:00";
      const endDate   = new Date().toISOString().slice(0, 19) + ".000-00:00";

      let offset = 0;
      const limit = 50;
      let totalSynced = 0;
      let totalFetched = 0;
      let lastError = "";

      // Paginação: buscar todos os pagamentos do período
      while (true) {
        let data: any;
        try {
          const url = `${MP_API}/v1/payments/search?sort=date_created&criteria=desc`
            + `&range=date_created&begin_date=${beginDate}&end_date=${endDate}`
            + `&offset=${offset}&limit=${limit}`;
          data = await mpGet(url, token);
        } catch (e) {
          lastError = String(e).slice(0, 300);
          break;
        }

        const results: any[] = data?.results ?? [];
        if (results.length === 0) break;
        totalFetched += results.length;

        for (const p of results) {
          // Extrair fee_details
          const fees: any[] = p.fee_details ?? [];
          const feeTotal    = fees.reduce((s: number, f: any) => s + Math.abs(Number(f.amount ?? 0)), 0);
          const shippingFee = fees.find((f: any) => f.type === "shipping")?.amount ?? 0;
          const financingFee = fees.find((f: any) => f.type === "financing")?.amount ?? 0;

          // Cruzar ml_order_id via external_reference
          const mlOrderId: string | null = p.external_reference
            ? String(p.external_reference)
            : null;

          // Buscar order_db_id (FK)
          let orderDbId: string | null = null;
          if (mlOrderId) {
            const { data: ord } = await admin
              .from("orders")
              .select("id")
              .eq("store_id", store.id)
              .eq("ml_order_id", mlOrderId)
              .maybeSingle();
            orderDbId = ord?.id ?? null;
          }

          const row = {
            user_id:               userId,
            store_id:              store.id,
            mp_payment_id:         String(p.id),
            ml_order_id:           mlOrderId,
            order_db_id:           orderDbId,
            date_created:          p.date_created ?? null,
            date_approved:         p.date_approved ?? null,
            money_release_date:    p.money_release_date ?? null,
            money_release_status:  p.money_release_status ?? null,
            transaction_amount:    Number(p.transaction_amount ?? 0),
            net_received_amount:   Number(p.net_received_amount ?? 0),
            fee_amount:            Math.abs(feeTotal),
            shipping_fee_amount:   Math.abs(Number(shippingFee)),
            financing_fee_amount:  Math.abs(Number(financingFee)),
            taxes_amount:          Number(p.taxes_amount ?? 0),
            coupon_amount:         Number(p.coupon_amount ?? 0),
            installments:          Number(p.installments ?? 1),
            payment_method_id:     p.payment_method_id ?? null,
            payment_method_type:   p.payment_type_id ?? null,
            status:                p.status ?? null,
          };

          const { error: upErr } = await admin
            .from("payments_releases")
            .upsert(row, { onConflict: "store_id,mp_payment_id" });

          if (!upErr) totalSynced++;
        }

        if (results.length < limit) break;
        offset += limit;

        // Limite de segurança: máximo 20 páginas (1000 pagamentos) por loja
        if (offset >= 1000) break;
      }

      summary.push({
        store_id: store.id,
        fetched: totalFetched,
        synced: totalSynced,
        error: lastError || undefined,
      });
    }

    return new Response(JSON.stringify({ ok: true, summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
```

- [ ] **Step 2: Commit e deploy via Lovable**

```bash
git add supabase/functions/mp-sync-payments/index.ts
git commit -m "feat: edge function mp-sync-payments via API Mercado Pago"
git push origin main
```

Prompt no Lovable:
```
Deploy the latest GitHub commit. No code changes needed — just sync the new Edge Function mp-sync-payments.
```

- [ ] **Step 3: Teste manual**

No Configurações, adicionar botão temporário e chamar via browser console:
```js
const { data } = await supabase.functions.invoke('mp-sync-payments', {
  body: { days: 90 }
})
console.log(data)
```
Verificar no Supabase Studio → `payments_releases` que tem registros com `money_release_date` preenchido.

---

## Task 3: Botão "Sincronizar Pagamentos" em Configurações

**Files:**
- Modify: `src/pages/Configuracoes.tsx`

### Contexto
Adicionar um botão "Sincronizar Pagamentos MP" ao lado do "Sincronizar" existente em cada loja.

- [ ] **Step 1: Adicionar estado e função de sync MP**

Adicionar antes do `return` em `Configuracoes`:
```tsx
const [syncingMpId, setSyncingMpId] = useState<string | null>(null);

const syncPayments = async (storeId: string) => {
  setSyncingMpId(storeId);
  toast.info("Sincronizando pagamentos do Mercado Pago...");
  const { data, error } = await supabase.functions.invoke("mp-sync-payments", {
    body: { store_id: storeId, days: 90 },
  });
  setSyncingMpId(null);
  if (error) { toast.error("Erro ao sincronizar pagamentos: " + error.message); return; }
  const s = data?.summary?.[0];
  toast.success(`Pagamentos sincronizados: ${s?.synced ?? 0} registro(s)`);
};
```

- [ ] **Step 2: Adicionar o botão no JSX**

Logo após o botão "Sincronizar" existente (que chama `syncStore`), adicionar:
```tsx
<Button
  size="sm" variant="outline"
  onClick={() => syncPayments(s.id)}
  disabled={syncingMpId === s.id}
  title="Sincronizar prazos de recebimento do Mercado Pago"
>
  <CreditCard className={`h-3.5 w-3.5 mr-1.5 ${syncingMpId === s.id ? "animate-pulse" : ""}`} />
  {syncingMpId === s.id ? "Sincronizando..." : "Pagamentos MP"}
</Button>
```

Adicionar `CreditCard` ao import do lucide-react.

- [ ] **Step 3: Commit**
```bash
git add src/pages/Configuracoes.tsx
git commit -m "feat: botão Sincronizar Pagamentos MP em Configurações"
git push origin main
```

---

## Task 4: Estoque nos Produtos

**Files:**
- Modify: `src/pages/Produtos.tsx`

### Contexto
Adicionar coluna "Estoque" editável na tabela de produtos. O valor é usado no cálculo do Ciclo de Estoque (CE) e NCG.

- [ ] **Step 1: Ler o arquivo Produtos.tsx para entender estrutura atual**

```bash
cat src/pages/Produtos.tsx
```

- [ ] **Step 2: Adicionar coluna de estoque à tabela**

Na tabela de produtos, após a coluna "Custo" (cost_price), adicionar coluna "Estoque":
```tsx
<TableHead className="text-right">Estoque</TableHead>
```

Na linha de cada produto, adicionar célula editável:
```tsx
<TableCell className="text-right">
  <Input
    type="number"
    min="0"
    className="w-20 h-7 text-right text-sm"
    value={editingStock[p.id] ?? p.stock ?? 0}
    onChange={(e) => setEditingStock(prev => ({ ...prev, [p.id]: Number(e.target.value) }))}
    onBlur={async (e) => {
      const newStock = Number(e.target.value);
      await supabase.from("products").update({ stock: newStock }).eq("id", p.id);
      toast.success("Estoque atualizado");
    }}
  />
</TableCell>
```

Adicionar estado:
```tsx
const [editingStock, setEditingStock] = useState<Record<string, number>>({});
```

- [ ] **Step 3: Commit**
```bash
git add src/pages/Produtos.tsx
git commit -m "feat: campo de estoque editável nos produtos"
git push origin main
```

---

## Task 5: Módulo de Compras (PMP)

**Files:**
- Create: `src/components/compras/CompraDialog.tsx`
- Create: `src/components/compras/ComprasTable.tsx`
- Create: `src/pages/Compras.tsx`

### Contexto
O PMP (Prazo Médio de Pagamento) é calculado como `média(paid_date - purchase_date)` para compras pagas. Cada compra tem: fornecedor, data da NF (purchase_date), data de vencimento (due_date), data que pagou (paid_date), valor total, e itens (produto + qtd + custo unitário).

- [ ] **Step 1: Criar CompraDialog.tsx**

```tsx
// src/components/compras/CompraDialog.tsx
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

interface Product { id: string; title: string; cost_price: number; }
interface PurchaseItem { product_id: string | null; description: string; quantity: number; unit_cost: number; }

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  storeId: string;
  userId: string;
  editId?: string | null;
}

export const CompraDialog = ({ open, onClose, onSaved, storeId, userId, editId }: Props) => {
  const [supplier, setSupplier] = useState("");
  const [description, setDescription] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [paidDate, setPaidDate] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<PurchaseItem[]>([
    { product_id: null, description: "", quantity: 1, unit_cost: 0 },
  ]);
  const [products, setProducts] = useState<Product[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from("products").select("id, title, cost_price").eq("store_id", storeId)
      .order("title").then(({ data }) => setProducts(data ?? []));
  }, [storeId]);

  useEffect(() => {
    if (!editId || !open) return;
    supabase.from("purchases").select("*, purchase_items(*)").eq("id", editId).single()
      .then(({ data }) => {
        if (!data) return;
        setSupplier(data.supplier);
        setDescription(data.description ?? "");
        setInvoiceNumber(data.invoice_number ?? "");
        setPurchaseDate(data.purchase_date);
        setDueDate(data.due_date);
        setPaidDate(data.paid_date ?? "");
        setNotes(data.notes ?? "");
        setItems(data.purchase_items?.map((i: any) => ({
          product_id: i.product_id ?? null,
          description: i.description,
          quantity: i.quantity,
          unit_cost: Number(i.unit_cost),
        })) ?? [{ product_id: null, description: "", quantity: 1, unit_cost: 0 }]);
      });
  }, [editId, open]);

  const totalAmount = items.reduce((s, i) => s + i.quantity * i.unit_cost, 0);

  const reset = () => {
    setSupplier(""); setDescription(""); setInvoiceNumber("");
    setPurchaseDate(new Date().toISOString().slice(0, 10));
    setDueDate(""); setPaidDate(""); setNotes("");
    setItems([{ product_id: null, description: "", quantity: 1, unit_cost: 0 }]);
  };

  const save = async () => {
    if (!supplier || !purchaseDate || !dueDate) {
      toast.error("Preencha fornecedor, data da compra e vencimento.");
      return;
    }
    setSaving(true);
    try {
      const purchaseRow = {
        user_id: userId, store_id: storeId,
        supplier, description: description || null,
        invoice_number: invoiceNumber || null,
        purchase_date: purchaseDate, due_date: dueDate,
        paid_date: paidDate || null,
        total_amount: totalAmount,
        status: paidDate ? "paid" : (new Date(dueDate) < new Date() ? "overdue" : "pending"),
        notes: notes || null,
      };

      let purchaseId: string;
      if (editId) {
        await supabase.from("purchases").update(purchaseRow).eq("id", editId);
        await supabase.from("purchase_items").delete().eq("purchase_id", editId);
        purchaseId = editId;
      } else {
        const { data, error } = await supabase.from("purchases").insert(purchaseRow).select("id").single();
        if (error) throw error;
        purchaseId = data.id;
      }

      const itemsRows = items
        .filter(i => i.description && i.quantity > 0 && i.unit_cost >= 0)
        .map(i => ({ purchase_id: purchaseId, ...i }));
      if (itemsRows.length > 0) {
        await supabase.from("purchase_items").insert(itemsRows);
      }

      toast.success(editId ? "Compra atualizada" : "Compra registrada");
      reset(); onSaved(); onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const updateItem = (idx: number, field: keyof PurchaseItem, value: any) => {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it));
  };

  const autoFillFromProduct = (idx: number, productId: string) => {
    const p = products.find(p => p.id === productId);
    if (!p) return;
    updateItem(idx, "product_id", productId);
    updateItem(idx, "description", p.title);
    updateItem(idx, "unit_cost", p.cost_price);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editId ? "Editar Compra" : "Nova Compra / Nota Fiscal"}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 py-2">
          <div className="col-span-2">
            <Label>Fornecedor *</Label>
            <Input value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="Nome do fornecedor" />
          </div>
          <div>
            <Label>Nº Nota Fiscal</Label>
            <Input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} placeholder="NF 000123" />
          </div>
          <div>
            <Label>Descrição</Label>
            <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Resumo da compra" />
          </div>
          <div>
            <Label>Data da Compra / NF *</Label>
            <Input type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} />
          </div>
          <div>
            <Label>Vencimento *</Label>
            <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </div>
          <div className="col-span-2">
            <Label>Data de Pagamento</Label>
            <Input type="date" value={paidDate} onChange={e => setPaidDate(e.target.value)}
              placeholder="Deixe vazio se ainda não foi pago" />
          </div>

          {/* Itens */}
          <div className="col-span-2 space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-base font-medium">Itens</Label>
              <Button size="sm" variant="outline" onClick={() =>
                setItems(prev => [...prev, { product_id: null, description: "", quantity: 1, unit_cost: 0 }])
              }>
                <Plus className="h-3.5 w-3.5 mr-1" />Adicionar item
              </Button>
            </div>
            {items.map((item, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-4">
                  <Select value={item.product_id ?? "__manual__"}
                    onValueChange={v => v === "__manual__"
                      ? updateItem(idx, "product_id", null)
                      : autoFillFromProduct(idx, v)
                    }>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Produto (opcional)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__manual__">— Digitar manualmente —</SelectItem>
                      {products.map(p => (
                        <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-3">
                  <Input className="h-8 text-xs" placeholder="Descrição" value={item.description}
                    onChange={e => updateItem(idx, "description", e.target.value)} />
                </div>
                <div className="col-span-2">
                  <Input className="h-8 text-xs text-right" type="number" min="1" placeholder="Qtd"
                    value={item.quantity}
                    onChange={e => updateItem(idx, "quantity", Number(e.target.value))} />
                </div>
                <div className="col-span-2">
                  <Input className="h-8 text-xs text-right" type="number" min="0" step="0.01"
                    placeholder="Custo unit." value={item.unit_cost}
                    onChange={e => updateItem(idx, "unit_cost", Number(e.target.value))} />
                </div>
                <div className="col-span-1 flex justify-center">
                  <Button size="icon" variant="ghost" className="h-8 w-8"
                    onClick={() => setItems(prev => prev.filter((_, i) => i !== idx))}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
            <p className="text-sm font-medium text-right text-muted-foreground">
              Total: R$ {totalAmount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
            </p>
          </div>

          <div className="col-span-2">
            <Label>Observações</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Salvando..." : (editId ? "Salvar alterações" : "Registrar Compra")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
```

- [ ] **Step 2: Criar ComprasTable.tsx**

```tsx
// src/components/compras/ComprasTable.tsx
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Edit, Trash2 } from "lucide-react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Purchase {
  id: string; supplier: string; description: string | null;
  invoice_number: string | null; purchase_date: string; due_date: string;
  paid_date: string | null; total_amount: number; status: string;
}

interface Props {
  purchases: Purchase[];
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}

const statusConfig = {
  pending: { label: "Pendente", variant: "secondary" as const },
  paid:    { label: "Pago",     variant: "default" as const },
  overdue: { label: "Vencido",  variant: "destructive" as const },
};

const fmt = (d: string) => format(parseISO(d), "dd/MM/yyyy", { locale: ptBR });
const fmtR = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const ComprasTable = ({ purchases, onEdit, onDelete }: Props) => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>Fornecedor</TableHead>
        <TableHead>NF</TableHead>
        <TableHead>Compra</TableHead>
        <TableHead>Vencimento</TableHead>
        <TableHead>Pagamento</TableHead>
        <TableHead className="text-right">Total</TableHead>
        <TableHead>Status</TableHead>
        <TableHead className="w-20" />
      </TableRow>
    </TableHeader>
    <TableBody>
      {purchases.length === 0 && (
        <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">
          Nenhuma compra registrada.
        </TableCell></TableRow>
      )}
      {purchases.map((p) => {
        const sc = statusConfig[p.status as keyof typeof statusConfig] ?? statusConfig.pending;
        return (
          <TableRow key={p.id}>
            <TableCell className="font-medium">{p.supplier}</TableCell>
            <TableCell className="text-xs text-muted-foreground">{p.invoice_number ?? "—"}</TableCell>
            <TableCell>{fmt(p.purchase_date)}</TableCell>
            <TableCell>{fmt(p.due_date)}</TableCell>
            <TableCell>{p.paid_date ? fmt(p.paid_date) : <span className="text-muted-foreground">—</span>}</TableCell>
            <TableCell className="text-right font-mono">{fmtR(p.total_amount)}</TableCell>
            <TableCell><Badge variant={sc.variant}>{sc.label}</Badge></TableCell>
            <TableCell>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onEdit(p.id)}>
                  <Edit className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onDelete(p.id)}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        );
      })}
    </TableBody>
  </Table>
);
```

- [ ] **Step 3: Criar Compras.tsx**

```tsx
// src/pages/Compras.tsx
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { CompraDialog } from "@/components/compras/CompraDialog";
import { ComprasTable } from "@/components/compras/ComprasTable";

interface Store { id: string; name: string; }
interface Purchase {
  id: string; supplier: string; description: string | null;
  invoice_number: string | null; purchase_date: string; due_date: string;
  paid_date: string | null; total_amount: number; status: string;
}

const Compras = () => {
  const { user } = useAuth();
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState<string>("");
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase.from("stores").select("id, name").eq("user_id", user.id).order("created_at")
      .then(({ data }) => {
        setStores(data ?? []);
        if (data?.[0]) setStoreId(data[0].id);
      });
  }, [user]);

  const load = async () => {
    if (!storeId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("purchases")
      .select("id, supplier, description, invoice_number, purchase_date, due_date, paid_date, total_amount, status")
      .eq("store_id", storeId)
      .order("purchase_date", { ascending: false });
    if (error) toast.error(error.message);
    setPurchases(data ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [storeId]);

  const handleDelete = async (id: string) => {
    if (!confirm("Excluir esta compra?")) return;
    const { error } = await supabase.from("purchases").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Compra excluída");
    load();
  };

  // Totais
  const totalPendente = purchases.filter(p => p.status !== "paid").reduce((s, p) => s + p.total_amount, 0);
  const totalPago     = purchases.filter(p => p.status === "paid").reduce((s, p) => s + p.total_amount, 0);
  const fmtR = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Compras</h1>
          <p className="text-muted-foreground mt-1">Registre NFs e compras de fornecedor para calcular PMP e NCG.</p>
        </div>
        <div className="flex gap-2">
          {stores.length > 1 && (
            <Select value={storeId} onValueChange={setStoreId}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>{stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          )}
          <Button onClick={() => { setEditId(null); setDialogOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" />Nova Compra
          </Button>
        </div>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total registrado", value: fmtR(totalPago + totalPendente), sub: `${purchases.length} compra(s)` },
          { label: "Contas a pagar", value: fmtR(totalPendente), sub: `${purchases.filter(p => p.status !== "paid").length} pendente(s)` },
          { label: "Total pago", value: fmtR(totalPago), sub: `${purchases.filter(p => p.status === "paid").length} pago(s)` },
        ].map(c => (
          <Card key={c.label} className="shadow-soft border-border/60">
            <CardHeader className="pb-1 pt-4 px-5">
              <CardDescription>{c.label}</CardDescription>
            </CardHeader>
            <CardContent className="pb-4 px-5">
              <p className="text-2xl font-bold">{c.value}</p>
              <p className="text-xs text-muted-foreground">{c.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="shadow-soft border-border/60">
        <CardHeader>
          <CardTitle>Histórico de Compras</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? <p className="text-sm text-muted-foreground">Carregando...</p> : (
            <ComprasTable
              purchases={purchases}
              onEdit={(id) => { setEditId(id); setDialogOpen(true); }}
              onDelete={handleDelete}
            />
          )}
        </CardContent>
      </Card>

      {user && storeId && (
        <CompraDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          onSaved={load}
          storeId={storeId}
          userId={user.id}
          editId={editId}
        />
      )}
    </div>
  );
};

export default Compras;
```

- [ ] **Step 4: Commit**
```bash
git add src/components/compras/ src/pages/Compras.tsx
git commit -m "feat: módulo de compras para cálculo de PMP"
git push origin main
```

---

## Task 6: Hook useCashFlow — Todos os Cálculos

**Files:**
- Create: `src/hooks/useCashFlow.ts`

### Contexto
Este hook centraliza todos os cálculos financeiros. Recebe o `storeId` e um período (dias), busca os dados das 3 fontes (payments_releases, purchases, products + order_items) e retorna os indicadores calculados.

```
PMR = média(money_release_date − date_approved) → dias até receber do ML
PMP = média(paid_date − purchase_date) → dias até pagar fornecedor
CE  = (estoque_em_R$ / CMV_diário) → dias de giro de estoque
Ciclo Operacional = CE + PMR
Ciclo Financeiro  = CE + PMR − PMP
NCG = Estoques + Contas_a_Receber − Contas_a_Pagar
```

- [ ] **Step 1: Criar useCashFlow.ts**

```typescript
// src/hooks/useCashFlow.ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { differenceInDays, isAfter, isBefore, parseISO } from "date-fns";

export interface CashFlowIndicators {
  PMR: number;          // Prazo Médio de Recebimento (dias)
  PMP: number;          // Prazo Médio de Pagamento (dias)
  CE: number;           // Ciclo de Estoque (dias)
  cicloOperacional: number;   // CE + PMR
  cicloFinanceiro: number;    // CE + PMR - PMP
  NCG: number;          // Necessidade de Capital de Giro (R$)
  contasReceber: number;      // Pagamentos ainda não liberados (R$)
  contasPagar: number;        // Compras pendentes (R$)
  estoqueTotal: number;       // Valor total em estoque (R$)
  PMRSamples: number;   // Quantos pagamentos usados no PMR
  PMPSamples: number;   // Quantas compras usadas no PMP
}

export interface ReleaseEvent {
  mp_payment_id: string;
  ml_order_id: string | null;
  money_release_date: string;
  money_release_status: string | null;
  net_received_amount: number;
  transaction_amount: number;
  installments: number;
  payment_method_id: string | null;
}

export const useCashFlow = (storeId: string, days = 90) => {
  const today = new Date();
  const beginDate = new Date(Date.now() - days * 86400_000);

  // Pagamentos para PMR e calendário
  const { data: releases = [], isLoading: loadingReleases } = useQuery({
    queryKey: ["payments_releases", storeId, days],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments_releases")
        .select("mp_payment_id, ml_order_id, money_release_date, money_release_status, net_received_amount, transaction_amount, date_approved, installments, payment_method_id")
        .eq("store_id", storeId)
        .not("money_release_date", "is", null)
        .order("money_release_date", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!storeId,
  });

  // Compras para PMP
  const { data: purchases = [], isLoading: loadingPurchases } = useQuery({
    queryKey: ["purchases", storeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchases")
        .select("id, purchase_date, due_date, paid_date, total_amount, status")
        .eq("store_id", storeId);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!storeId,
  });

  // Produtos para estoque
  const { data: products = [], isLoading: loadingProducts } = useQuery({
    queryKey: ["products_stock", storeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, cost_price, stock")
        .eq("store_id", storeId);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!storeId,
  });

  // CMV do período (para CE)
  const { data: orderItems = [], isLoading: loadingItems } = useQuery({
    queryKey: ["order_items_cost", storeId, days],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("order_items")
        .select("quantity, cost_price, orders!inner(date_created, store_id)")
        .eq("orders.store_id", storeId)
        .gte("orders.date_created", beginDate.toISOString());
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!storeId,
  });

  const isLoading = loadingReleases || loadingPurchases || loadingProducts || loadingItems;

  const indicators = (() => {
    if (isLoading) return null;

    // ---- PMR: média dos dias entre aprovação e liberação ----
    const releasedPayments = releases.filter(r =>
      r.date_approved && r.money_release_date && r.money_release_status === "released"
    );
    const PMR = releasedPayments.length > 0
      ? releasedPayments.reduce((sum, r) => {
          const days = Math.max(0, differenceInDays(
            parseISO(r.money_release_date!),
            parseISO(r.date_approved!)
          ));
          return sum + days;
        }, 0) / releasedPayments.length
      : 0;

    // ---- Contas a Receber: pagamentos futuros não liberados ----
    const contasReceber = releases
      .filter(r => r.money_release_status !== "released" && r.money_release_date && isAfter(parseISO(r.money_release_date), today))
      .reduce((sum, r) => sum + (r.net_received_amount ?? 0), 0);

    // ---- PMP: média dos dias entre compra e pagamento ----
    const paidPurchases = purchases.filter(p => p.paid_date && p.purchase_date);
    const PMP = paidPurchases.length > 0
      ? paidPurchases.reduce((sum, p) => {
          const d = Math.max(0, differenceInDays(parseISO(p.paid_date!), parseISO(p.purchase_date)));
          return sum + d;
        }, 0) / paidPurchases.length
      : 0;

    // ---- Contas a Pagar: compras não pagas ----
    const contasPagar = purchases
      .filter(p => p.status !== "paid")
      .reduce((sum, p) => sum + p.total_amount, 0);

    // ---- Estoque total em R$ ----
    const estoqueTotal = products.reduce((sum, p) => sum + (p.cost_price ?? 0) * (p.stock ?? 0), 0);

    // ---- CE: Ciclo de Estoque ----
    const CMVtotal  = orderItems.reduce((sum, i) => sum + (i.cost_price ?? 0) * (i.quantity ?? 1), 0);
    const CMVdiario = days > 0 ? CMVtotal / days : 0;
    const CE        = CMVdiario > 0 ? estoqueTotal / CMVdiario : 0;

    // ---- Ciclos ----
    const cicloOperacional = CE + PMR;
    const cicloFinanceiro  = CE + PMR - PMP;

    // ---- NCG ----
    const NCG = estoqueTotal + contasReceber - contasPagar;

    return {
      PMR, PMP, CE,
      cicloOperacional, cicloFinanceiro,
      NCG, contasReceber, contasPagar, estoqueTotal,
      PMRSamples: releasedPayments.length,
      PMPSamples: paidPurchases.length,
    } as CashFlowIndicators;
  })();

  // Eventos futuros de liberação (para calendário)
  const upcomingReleases: ReleaseEvent[] = releases.filter(r =>
    r.money_release_date && r.money_release_status !== "released"
    && isAfter(parseISO(r.money_release_date), today)
  );

  // Histórico de liberações já ocorridas
  const pastReleases: ReleaseEvent[] = releases.filter(r =>
    r.money_release_date && r.money_release_status === "released"
    && isBefore(parseISO(r.money_release_date), today)
  );

  return { indicators, upcomingReleases, pastReleases, isLoading, releases };
};
```

- [ ] **Step 2: Commit**
```bash
git add src/hooks/useCashFlow.ts
git commit -m "feat: hook useCashFlow com cálculos PMR/PMP/CE/NCG/Ciclo Financeiro"
git push origin main
```

---

## Task 7: Componentes Visuais do Dashboard

**Files:**
- Create: `src/components/cashflow/IndicadoresCard.tsx`
- Create: `src/components/cashflow/CalendarioRecebimentos.tsx`
- Create: `src/components/cashflow/CicloChart.tsx`
- Create: `src/components/cashflow/ContasReceberTable.tsx`

- [ ] **Step 1: Criar IndicadoresCard.tsx**

```tsx
// src/components/cashflow/IndicadoresCard.tsx
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import { CashFlowIndicators } from "@/hooks/useCashFlow";

interface Props { indicators: CashFlowIndicators | null; }

const fmtDias = (d: number) => `${d.toFixed(1)} dias`;
const fmtR    = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const InfoIcon = ({ tip }: { tip: string }) => (
  <Tooltip>
    <TooltipTrigger><Info className="h-3.5 w-3.5 text-muted-foreground ml-1" /></TooltipTrigger>
    <TooltipContent className="max-w-xs"><p className="text-xs">{tip}</p></TooltipContent>
  </Tooltip>
);

export const IndicadoresCard = ({ indicators }: Props) => {
  if (!indicators) return null;
  const { PMR, PMP, CE, cicloOperacional, cicloFinanceiro, NCG, contasReceber, contasPagar, estoqueTotal } = indicators;

  const cards = [
    {
      title: "PMR", sub: "Prazo Médio de Recebimento",
      value: fmtDias(PMR), color: "text-blue-600",
      tip: "Média de dias entre a aprovação do pagamento e a liberação pelo Mercado Pago.",
      sample: `${indicators.PMRSamples} pagamento(s)`,
    },
    {
      title: "PMP", sub: "Prazo Médio de Pagamento",
      value: fmtDias(PMP), color: "text-orange-600",
      tip: "Média de dias entre a data da compra (NF) e o pagamento ao fornecedor.",
      sample: `${indicators.PMPSamples} compra(s)`,
    },
    {
      title: "CE", sub: "Ciclo de Estoque",
      value: fmtDias(CE), color: "text-purple-600",
      tip: "Dias médios que o produto fica em estoque antes de ser vendido.",
      sample: fmtR(estoqueTotal) + " em estoque",
    },
    {
      title: "Ciclo Financeiro", sub: "CE + PMR − PMP",
      value: fmtDias(cicloFinanceiro), color: cicloFinanceiro > 0 ? "text-red-600" : "text-green-600",
      tip: "Quantos dias o capital fica comprometido. Ciclo negativo = você recebe antes de pagar.",
      sample: `Ciclo operacional: ${cicloOperacional.toFixed(1)} dias`,
    },
    {
      title: "NCG", sub: "Necessidade de Capital de Giro",
      value: fmtR(NCG), color: NCG > 0 ? "text-red-600" : "text-green-600",
      tip: "Capital necessário para financiar o ciclo operacional. NCG < 0 = fornecedor financia você.",
      sample: `CR ${fmtR(contasReceber)} · CP ${fmtR(contasPagar)}`,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
      {cards.map(c => (
        <Card key={c.title} className="shadow-soft border-border/60">
          <CardHeader className="pb-1 pt-4 px-5">
            <div className="flex items-center">
              <CardDescription className="text-xs font-medium uppercase tracking-wide">{c.sub}</CardDescription>
              <InfoIcon tip={c.tip} />
            </div>
          </CardHeader>
          <CardContent className="pb-4 px-5">
            <p className={`text-2xl font-bold ${c.color}`}>{c.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{c.sample}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};
```

- [ ] **Step 2: Criar CalendarioRecebimentos.tsx**

```tsx
// src/components/cashflow/CalendarioRecebimentos.tsx
import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format, parseISO, startOfWeek, addDays, isAfter, isBefore, addWeeks } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ReleaseEvent } from "@/hooks/useCashFlow";

interface Props { releases: ReleaseEvent[]; }

const fmtR = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const CalendarioRecebimentos = ({ releases }: Props) => {
  const today = new Date();
  // Agrupar por semana (próximas 8 semanas)
  const weeks = useMemo(() => {
    const result: Array<{ start: Date; end: Date; total: number; events: ReleaseEvent[] }> = [];
    for (let w = 0; w < 8; w++) {
      const start = startOfWeek(addWeeks(today, w), { weekStartsOn: 1 });
      const end   = addDays(start, 6);
      const events = releases.filter(r => {
        const d = parseISO(r.money_release_date);
        return !isBefore(d, start) && !isAfter(d, addDays(end, 1));
      });
      const total = events.reduce((s, e) => s + (e.net_received_amount ?? 0), 0);
      result.push({ start, end, total, events });
    }
    return result;
  }, [releases]);

  const totalUpcoming = releases.reduce((s, r) => s + (r.net_received_amount ?? 0), 0);

  return (
    <Card className="shadow-soft border-border/60">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Calendário de Recebimentos</CardTitle>
          <Badge variant="outline" className="text-base font-semibold px-3">
            {fmtR(totalUpcoming)} a receber
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {weeks.map(({ start, end, total, events }) => (
            <div key={start.toISOString()} className={`rounded-lg border p-3 ${total > 0 ? "border-primary/30 bg-primary/5" : "border-border/40 bg-muted/20"}`}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium">
                  {format(start, "dd MMM", { locale: ptBR })} – {format(end, "dd MMM", { locale: ptBR })}
                </p>
                {total > 0
                  ? <span className="text-sm font-bold text-primary">{fmtR(total)}</span>
                  : <span className="text-xs text-muted-foreground">Sem liberações</span>
                }
              </div>
              {events.length > 0 && (
                <div className="space-y-1">
                  {events.slice(0, 5).map(ev => (
                    <div key={ev.mp_payment_id} className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{format(parseISO(ev.money_release_date), "EEE dd/MM", { locale: ptBR })}</span>
                      <span>{fmtR(ev.net_received_amount ?? 0)}</span>
                    </div>
                  ))}
                  {events.length > 5 && (
                    <p className="text-xs text-muted-foreground text-center">+{events.length - 5} liberações</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
```

- [ ] **Step 3: Criar CicloChart.tsx**

```tsx
// src/components/cashflow/CicloChart.tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { CashFlowIndicators } from "@/hooks/useCashFlow";

interface Props { indicators: CashFlowIndicators | null; }

export const CicloChart = ({ indicators }: Props) => {
  if (!indicators) return null;
  const { CE, PMR, PMP, cicloFinanceiro } = indicators;

  const data = [
    { name: "Estoque (CE)", value: Math.round(CE * 10) / 10, color: "#a855f7" },
    { name: "Recebimento (PMR)", value: Math.round(PMR * 10) / 10, color: "#3b82f6" },
    { name: "Pagamento (PMP)", value: Math.round(PMP * 10) / 10, color: "#f97316" },
    { name: "Ciclo Financeiro", value: Math.round(cicloFinanceiro * 10) / 10, color: cicloFinanceiro > 0 ? "#ef4444" : "#22c55e" },
  ];

  return (
    <Card className="shadow-soft border-border/60">
      <CardHeader>
        <CardTitle>Ciclo Financeiro — Decomposição (dias)</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} unit=" d" />
            <Tooltip
              formatter={(v: number) => [`${v} dias`]}
              contentStyle={{ borderRadius: 8, fontSize: 12 }}
            />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              {data.map((entry, idx) => (
                <Cell key={idx} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <p>📦 <b>CE:</b> dias de giro do estoque</p>
          <p>💰 <b>PMR:</b> dias até receber do ML</p>
          <p>🏭 <b>PMP:</b> dias até pagar fornecedor</p>
          <p className={cicloFinanceiro > 0 ? "text-red-500" : "text-green-500"}>
            ⚡ <b>Ciclo Financeiro:</b> CE + PMR − PMP
          </p>
        </div>
      </CardContent>
    </Card>
  );
};
```

- [ ] **Step 4: Criar ContasReceberTable.tsx**

```tsx
// src/components/cashflow/ContasReceberTable.tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format, parseISO, differenceInDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ReleaseEvent } from "@/hooks/useCashFlow";

interface Props { releases: ReleaseEvent[]; }

const fmtR   = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDt  = (d: string) => format(parseISO(d), "dd/MM/yyyy", { locale: ptBR });

export const ContasReceberTable = ({ releases }: Props) => {
  const today = new Date();

  return (
    <Card className="shadow-soft border-border/60">
      <CardHeader>
        <CardTitle>Contas a Receber — Detalhamento</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pedido ML</TableHead>
              <TableHead>Liberação</TableHead>
              <TableHead>Dias restantes</TableHead>
              <TableHead>Parcelas</TableHead>
              <TableHead className="text-right">Valor líquido</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {releases.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                Nenhum recebimento pendente.
              </TableCell></TableRow>
            )}
            {releases.map(r => {
              const daysLeft = differenceInDays(parseISO(r.money_release_date), today);
              return (
                <TableRow key={r.mp_payment_id}>
                  <TableCell className="font-mono text-xs">{r.ml_order_id ?? "—"}</TableCell>
                  <TableCell>{fmtDt(r.money_release_date)}</TableCell>
                  <TableCell>
                    <Badge variant={daysLeft <= 3 ? "default" : daysLeft <= 7 ? "secondary" : "outline"}>
                      {daysLeft === 0 ? "Hoje" : `${daysLeft}d`}
                    </Badge>
                  </TableCell>
                  <TableCell>{r.installments ?? 1}x</TableCell>
                  <TableCell className="text-right font-mono">{fmtR(r.net_received_amount ?? 0)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};
```

- [ ] **Step 5: Commit**
```bash
git add src/components/cashflow/
git commit -m "feat: componentes visuais do dashboard de fluxo de caixa"
git push origin main
```

---

## Task 8: Página FluxoCaixa + Rotas + Nav

**Files:**
- Create: `src/pages/FluxoCaixa.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/AppLayout.tsx`

- [ ] **Step 1: Criar FluxoCaixa.tsx**

```tsx
// src/pages/FluxoCaixa.tsx
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { useCashFlow } from "@/hooks/useCashFlow";
import { IndicadoresCard } from "@/components/cashflow/IndicadoresCard";
import { CalendarioRecebimentos } from "@/components/cashflow/CalendarioRecebimentos";
import { CicloChart } from "@/components/cashflow/CicloChart";
import { ContasReceberTable } from "@/components/cashflow/ContasReceberTable";

interface Store { id: string; name: string; }

const FluxoCaixa = () => {
  const { user } = useAuth();
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState<string>("");
  const [days, setDays] = useState(90);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase.from("stores").select("id, name").eq("user_id", user.id).order("created_at")
      .then(({ data }) => { setStores(data ?? []); if (data?.[0]) setStoreId(data[0].id); });
  }, [user]);

  const { indicators, upcomingReleases, isLoading } = useCashFlow(storeId, days);

  const syncNow = async () => {
    setSyncing(true);
    toast.info("Sincronizando pagamentos com Mercado Pago...");
    const { data, error } = await supabase.functions.invoke("mp-sync-payments", {
      body: { store_id: storeId, days },
    });
    setSyncing(false);
    if (error) { toast.error("Erro: " + error.message); return; }
    const s = data?.summary?.[0];
    toast.success(`${s?.synced ?? 0} pagamento(s) sincronizado(s)`);
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Fluxo de Caixa</h1>
          <p className="text-muted-foreground mt-1">PMR · PMP · NCG · Ciclo Financeiro · Calendário de Recebimentos</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {stores.length > 1 && (
            <Select value={storeId} onValueChange={setStoreId}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>{stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          )}
          <Select value={String(days)} onValueChange={v => setDays(Number(v))}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="30">30 dias</SelectItem>
              <SelectItem value="60">60 dias</SelectItem>
              <SelectItem value="90">90 dias</SelectItem>
              <SelectItem value="180">180 dias</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={syncNow} disabled={syncing || !storeId}>
            <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Sincronizando..." : "Atualizar"}
          </Button>
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando indicadores...</p>}

      {/* Indicadores */}
      <IndicadoresCard indicators={indicators} />

      {/* Gráfico de ciclo + Calendário lado a lado */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CicloChart indicators={indicators} />
        <CalendarioRecebimentos releases={upcomingReleases} />
      </div>

      {/* Detalhamento contas a receber */}
      <ContasReceberTable releases={upcomingReleases} />
    </div>
  );
};

export default FluxoCaixa;
```

- [ ] **Step 2: Adicionar rota em App.tsx**

```tsx
// src/App.tsx — adicionar import e rota

// No topo, adicionar:
import FluxoCaixa from "./pages/FluxoCaixa";
import Compras from "./pages/Compras";

// Dentro das <Routes>, após a rota /custos-adicionais:
<Route path="/fluxo-caixa" element={<FluxoCaixa />} />
<Route path="/compras" element={<Compras />} />
```

- [ ] **Step 3: Adicionar itens ao nav em AppLayout.tsx**

```tsx
// src/components/AppLayout.tsx

// Adicionar ao imports do lucide-react:
import { TrendingUp, Wallet, LayoutDashboard, ShoppingCart, Package, Settings, LogOut, CreditCard, ShoppingBag } from "lucide-react";

// Substituir o array `nav` por:
const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/pedidos", label: "Pedidos", icon: ShoppingCart },
  { to: "/produtos", label: "Produtos", icon: Package },
  { to: "/fluxo-caixa", label: "Fluxo de Caixa", icon: TrendingUp },
  { to: "/compras", label: "Compras", icon: ShoppingBag },
  { to: "/custos-adicionais", label: "Custos Adicionais", icon: Wallet },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
];
```

- [ ] **Step 4: Commit e deploy via Lovable**

```bash
git add src/pages/FluxoCaixa.tsx src/pages/Compras.tsx src/App.tsx src/components/AppLayout.tsx
git commit -m "feat: páginas FluxoCaixa e Compras + rotas + nav"
git push origin main
```

Prompt no Lovable:
```
Deploy the latest GitHub commit — adds FluxoCaixa and Compras pages with routes and nav items.
```

---

## Task 9: Verificação Final e Ajustes

- [ ] **Step 1: Testar fluxo completo**
1. Ir em Configurações → clicar "Pagamentos MP" em uma loja → aguardar toast de sucesso
2. Verificar no Supabase Studio que `payments_releases` tem registros com `money_release_date`
3. Ir em Fluxo de Caixa → verificar se indicadores aparecem (PMR deve ser ≥ 0 dias)
4. Verificar Calendário de Recebimentos com as datas corretas
5. Ir em Compras → criar uma compra → verificar que aparece na tabela
6. Ir em Produtos → verificar campo de estoque editável
7. Voltar em Fluxo de Caixa → verificar que NCG reflete o estoque e compras

- [ ] **Step 2: Caso PMR = 0 (sem pagamentos liberados)**

Se `payments_releases` tem dados mas PMR = 0, é porque `money_release_status` não é `"released"` ou `date_approved` está nulo. Verificar no Supabase:
```sql
SELECT mp_payment_id, date_approved, money_release_date, money_release_status
FROM payments_releases
WHERE money_release_status = 'released'
LIMIT 10;
```
Se vazio: o campo `money_release_status` pode retornar algo diferente de `"released"` na API MP. Ajustar o filtro no `useCashFlow.ts` conforme o valor real.

- [ ] **Step 3: Commit final**
```bash
git add .
git commit -m "feat: fluxo de caixa completo — PMR/PMP/CE/NCG/calendário"
git push origin main
```

---

## Resumo dos Entregáveis

| Indicador | Fonte de dados | Status |
|---|---|---|
| PMR | `payments_releases.money_release_date − date_approved` | Automático via MP API |
| PMP | `purchases.paid_date − purchase_date` | Entrada manual NF |
| CE | `products.stock × cost_price / CMV_diário` | Estoque manual + pedidos |
| Ciclo Financeiro | CE + PMR − PMP | Calculado |
| NCG | Estoques + CR − CP | Calculado |
| Calendário | `payments_releases` ordenado por `money_release_date` | Automático via MP API |

---

## Notas Técnicas

- **Token MP**: o `stores.access_token` (ML OAuth `APP_USR-...`) funciona para `api.mercadopago.com` com o escopo `payments_read` já ativo. Sem necessidade de OAuth separado.
- **Cruzamento ML↔MP**: `payments_releases.ml_order_id` = `external_reference` do pagamento MP = `orders.ml_order_id`. O join é direto.
- **Recharts**: já existe em `src/components/ui/chart.tsx` via shadcn; importar `BarChart`, `Bar`, etc. diretamente de `recharts`.
- **date-fns**: já está no projeto (usado em Configuracoes.tsx e Pedidos.tsx).
- **Atualização de status de compras**: o status `overdue` é calculado no momento do save. Futuramente pode ser feito automaticamente via cron ou calculado no frontend comparando `due_date` com `today`.

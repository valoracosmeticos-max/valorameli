import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { useCashFlow } from "@/hooks/useCashFlow";
import { IndicadoresCard } from "@/components/cashflow/IndicadoresCard";
import { CalendarioRecebimentos } from "@/components/cashflow/CalendarioRecebimentos";
import { CicloChart } from "@/components/cashflow/CicloChart";
import { ContasReceberTable } from "@/components/cashflow/ContasReceberTable";

interface StoreRow { id: string; name: string }

const FluxoCaixa = () => {
  const [stores,      setStores]      = useState<StoreRow[]>([]);
  const [storeId,     setStoreId]     = useState<string>("");
  const [syncingMp,   setSyncingMp]   = useState(false);
  const [days,        setDays]        = useState(90);

  useEffect(() => {
    supabase
      .from("stores")
      .select("id, name")
      .order("created_at")
      .then(({ data }) => {
        const rows = data ?? [];
        setStores(rows);
        if (rows.length > 0) setStoreId(rows[0].id);
      });
  }, []);

  const { indicators, upcomingReleases, isLoading, refetch } = useCashFlow(storeId || undefined, days);

  const syncPayments = async () => {
    if (!storeId) return;
    setSyncingMp(true);
    toast.info("Sincronizando pagamentos MP... aguarde.");
    const { data, error } = await supabase.functions.invoke("mp-sync-payments", {
      body: { store_id: storeId, days },
    });
    setSyncingMp(false);
    if (error) {
      toast.error("Falha ao sincronizar MP: " + error.message);
      return;
    }
    const s = data?.summary?.[0];
    const synced = s?.synced ?? 0;
    const fetched = s?.fetched ?? 0;
    if (s?.error) toast.warning(`Sync MP: ${s.error}`);
    else toast.success(`Sincronização concluída: ${synced} salvo(s) de ${fetched} buscado(s)`);
    refetch();
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Fluxo de Caixa</h1>
          <p className="text-muted-foreground mt-1">
            PMR · PMP · Ciclo de Estoque · Ciclo Financeiro · NCG
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="30">30 dias</SelectItem>
              <SelectItem value="60">60 dias</SelectItem>
              <SelectItem value="90">90 dias</SelectItem>
              <SelectItem value="180">180 dias</SelectItem>
            </SelectContent>
          </Select>
          <Select value={storeId} onValueChange={setStoreId}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Selecionar loja" /></SelectTrigger>
            <SelectContent>
              {stores.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={syncPayments} disabled={syncingMp || !storeId} variant="outline">
            <RefreshCw className={`h-4 w-4 mr-2 ${syncingMp ? "animate-spin" : ""}`} />
            {syncingMp ? "Sincronizando..." : "Sync MP"}
          </Button>
        </div>
      </div>

      {/* Indicadores */}
      {isLoading ? (
        <Card className="shadow-soft border-border/60">
          <CardContent className="py-12 text-center text-muted-foreground">Carregando indicadores...</CardContent>
        </Card>
      ) : !storeId ? (
        <Card className="shadow-soft border-border/60">
          <CardContent className="py-12 text-center text-muted-foreground">Selecione uma loja para ver o fluxo de caixa</CardContent>
        </Card>
      ) : (
        <>
          <IndicadoresCard indicators={indicators} />

          {/* Chart */}
          <CicloChart indicators={indicators} />

          {/* Tabs: Calendário / Contas a Receber */}
          <Tabs defaultValue="calendario">
            <TabsList>
              <TabsTrigger value="calendario">Calendário de Recebimentos</TabsTrigger>
              <TabsTrigger value="tabela">Detalhamento</TabsTrigger>
            </TabsList>
            <TabsContent value="calendario" className="mt-4">
              {upcomingReleases.length === 0 ? (
                <Card className="shadow-soft border-border/60">
                  <CardHeader><CardTitle>Calendário de Recebimentos</CardTitle></CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground text-center py-8">
                      Nenhum recebimento futuro encontrado. Clique em "Sync MP" para importar os pagamentos do Mercado Pago.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <CalendarioRecebimentos releases={upcomingReleases} />
              )}
            </TabsContent>
            <TabsContent value="tabela" className="mt-4">
              <ContasReceberTable releases={upcomingReleases} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
};

export default FluxoCaixa;

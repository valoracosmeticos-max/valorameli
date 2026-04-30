import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TrendingUp, TrendingDown, DollarSign, Wallet, Package, AlertCircle, ArrowRight } from "lucide-react";

const Index = () => {
  const [storeCount, setStoreCount] = useState<number | null>(null);

  useEffect(() => {
    supabase.from("stores").select("id", { count: "exact", head: true }).then(({ count }) => {
      setStoreCount(count ?? 0);
    });
  }, []);

  const cards = [
    { label: "Faturamento", value: "R$ 0,00", icon: DollarSign, color: "text-primary" },
    { label: "Valor recebido", value: "R$ 0,00", icon: Wallet, color: "text-success" },
    { label: "Custo total", value: "R$ 0,00", icon: Package, color: "text-warning" },
    { label: "Lucro", value: "R$ 0,00", icon: TrendingUp, color: "text-success" },
    { label: "Margem", value: "0%", icon: TrendingDown, color: "text-muted-foreground" },
  ];

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Visão geral das suas vendas</p>
      </div>

      {storeCount === 0 && (
        <Alert className="border-primary/30 bg-primary/5">
          <AlertCircle className="h-4 w-4 text-primary" />
          <AlertTitle>Nenhuma loja conectada</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-4">
            <span>Conecte sua primeira loja do Mercado Livre para começar a sincronizar vendas.</span>
            <Button asChild size="sm">
              <Link to="/configuracoes">
                Conectar loja <ArrowRight className="h-4 w-4 ml-2" />
              </Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {cards.map((c) => (
          <Card key={c.label} className="shadow-soft border-border/60">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-sm font-medium text-muted-foreground">{c.label}</CardTitle>
              <c.icon className={`h-4 w-4 ${c.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{c.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="shadow-soft border-border/60">
        <CardHeader>
          <CardTitle>Lucro por dia</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
            Sem dados ainda. Conecte uma loja e sincronize seus pedidos.
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Index;

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShoppingCart } from "lucide-react";

const Pedidos = () => {
  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Pedidos</h1>
        <p className="text-muted-foreground mt-1">Histórico de vendas com cálculo de lucro</p>
      </div>
      <Card className="shadow-soft border-border/60">
        <CardHeader>
          <CardTitle>Lista de pedidos</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex flex-col items-center justify-center text-center gap-3 text-muted-foreground">
            <ShoppingCart className="h-12 w-12 opacity-30" />
            <p>Nenhum pedido sincronizado ainda.</p>
            <p className="text-xs">Conecte sua loja em Configurações para começar.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Pedidos;

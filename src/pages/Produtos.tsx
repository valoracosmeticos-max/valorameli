import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Package } from "lucide-react";

const Produtos = () => {
  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Produtos & Custos</h1>
        <p className="text-muted-foreground mt-1">Cadastre o custo de cada produto para calcular o lucro</p>
      </div>
      <Card className="shadow-soft border-border/60">
        <CardHeader>
          <CardTitle>Catálogo</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex flex-col items-center justify-center text-center gap-3 text-muted-foreground">
            <Package className="h-12 w-12 opacity-30" />
            <p>Nenhum produto sincronizado ainda.</p>
            <p className="text-xs">Conecte uma loja primeiro em Configurações.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Produtos;

import { Card, CardContent, CardHeader, CardDescription } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import { CashFlowIndicators } from "@/hooks/useCashFlow";

interface Props { indicators: CashFlowIndicators | null; }

const fmtDias = (d: number) => `${d.toFixed(1)} dias`;
const fmtR    = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const InfoIcon = ({ tip }: { tip: string }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <span className="cursor-help"><Info className="h-3.5 w-3.5 text-muted-foreground ml-1 inline" /></span>
    </TooltipTrigger>
    <TooltipContent className="max-w-64 text-xs">{tip}</TooltipContent>
  </Tooltip>
);

export const IndicadoresCard = ({ indicators }: Props) => {
  if (!indicators) return null;
  const { PMR, PMP, CE, cicloOperacional, cicloFinanceiro, NCG, contasReceber, contasPagar, estoqueTotal } = indicators;

  const cards = [
    {
      title: "PMR",
      sub: "Prazo Médio de Recebimento",
      value: fmtDias(PMR),
      color: "text-blue-600",
      tip: "Média de dias entre a aprovação do pagamento e a liberação pelo Mercado Pago.",
      sample: `${indicators.PMRSamples} pgto(s) analisados`,
    },
    {
      title: "PMP",
      sub: "Prazo Médio de Pagamento",
      value: fmtDias(PMP),
      color: "text-orange-600",
      tip: "Média de dias entre a data da compra (NF) e o pagamento efetivo ao fornecedor.",
      sample: `${indicators.PMPSamples} compra(s) pagas`,
    },
    {
      title: "CE",
      sub: "Ciclo de Estoque",
      value: fmtDias(CE),
      color: "text-purple-600",
      tip: "Dias médios que o produto fica em estoque antes de ser vendido. Calculado como Estoque ÷ CMV diário.",
      sample: `${fmtR(estoqueTotal)} em estoque`,
    },
    {
      title: "Ciclo Financeiro",
      sub: "CE + PMR − PMP",
      value: fmtDias(cicloFinanceiro),
      color: cicloFinanceiro > 0 ? "text-red-600" : "text-green-600",
      tip: "Quantos dias o capital fica comprometido. Negativo = você recebe antes de ter que pagar o fornecedor.",
      sample: `Ciclo operacional: ${cicloOperacional.toFixed(1)}d`,
    },
    {
      title: "NCG",
      sub: "Necessidade de Capital de Giro",
      value: fmtR(NCG),
      color: NCG > 0 ? "text-red-600" : "text-green-600",
      tip: "Capital necessário = Estoques + Contas a Receber − Contas a Pagar. NCG negativo = fornecedor financia seu ciclo.",
      sample: `CR ${fmtR(contasReceber)} · CP ${fmtR(contasPagar)}`,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
      {cards.map((c) => (
        <Card key={c.title} className="shadow-soft border-border/60">
          <CardHeader className="pb-1 pt-4 px-5">
            <div className="flex items-center">
              <CardDescription className="text-xs font-medium uppercase tracking-wide leading-tight">
                {c.sub}
              </CardDescription>
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

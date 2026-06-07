import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CashFlowIndicators } from "@/hooks/useCashFlow";

interface Props { indicators: CashFlowIndicators | null }

export const CicloChart = ({ indicators }: Props) => {
  if (!indicators) return null;

  const { CE, PMR, PMP, cicloFinanceiro } = indicators;

  const data = [
    { name: "Estoque\n(CE)",      value: Math.round(CE * 10) / 10,              color: "#a855f7" },
    { name: "Recebimento\n(PMR)", value: Math.round(PMR * 10) / 10,             color: "#3b82f6" },
    { name: "Pagamento\n(PMP)",   value: Math.round(PMP * 10) / 10,             color: "#f97316" },
    {
      name: "Ciclo\nFinanceiro",
      value: Math.round(cicloFinanceiro * 10) / 10,
      color: cicloFinanceiro > 0 ? "#ef4444" : "#22c55e",
    },
  ];

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const { name, value } = payload[0].payload;
    return (
      <div className="rounded-lg border bg-background px-3 py-2 shadow-md text-sm">
        <p className="font-medium">{name.replace("\n", " ")}</p>
        <p className="text-muted-foreground">{value} dias</p>
      </div>
    );
  };

  return (
    <Card className="shadow-soft border-border/60">
      <CardHeader>
        <CardTitle>Ciclo Financeiro — Decomposição</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 5, right: 16, left: -8, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 10 }}
              tickFormatter={(v) => v.replace("\n", " ")}
            />
            <YAxis tick={{ fontSize: 11 }} unit="d" />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine y={0} stroke="hsl(var(--border))" />
            <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={60}>
              {data.map((entry, idx) => (
                <Cell key={idx} fill={entry.color} fillOpacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted-foreground">
          <p><span className="inline-block h-2.5 w-2.5 rounded-full bg-purple-500 mr-1.5 align-middle" />CE: dias de giro do estoque</p>
          <p><span className="inline-block h-2.5 w-2.5 rounded-full bg-blue-500 mr-1.5 align-middle" />PMR: dias até receber do ML</p>
          <p><span className="inline-block h-2.5 w-2.5 rounded-full bg-orange-500 mr-1.5 align-middle" />PMP: dias até pagar fornecedor</p>
          <p className={cicloFinanceiro > 0 ? "text-red-500" : "text-green-500"}>
            <span className={`inline-block h-2.5 w-2.5 rounded-full mr-1.5 align-middle ${cicloFinanceiro > 0 ? "bg-red-500" : "bg-green-500"}`} />
            Ciclo: CE + PMR − PMP
          </p>
        </div>
      </CardContent>
    </Card>
  );
};

import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useCashProfit } from "@/hooks/useCashProfit";

const fmtR = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtD = (ymd: string) => ymd.split("-").reverse().slice(0, 2).join("/");

const monthOptions = () => {
  const now = new Date(Date.now() - 3 * 3600_000);
  return [-2, -1, 0, 1, 2].map((d) => {
    const dt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + d, 1));
    const key = dt.toISOString().slice(0, 7);
    const label = dt.toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
    return { key, label };
  });
};

export const LucroCaixaMes = ({ storeId }: { storeId?: string }) => {
  const opts = useMemo(monthOptions, []);
  const [month, setMonth] = useState(opts[2].key);
  const [open, setOpen] = useState<string | null>(null);
  const { data, isLoading, error } = useCashProfit(storeId, month);

  const byDay = useMemo(() => {
    const map = new Map<string, NonNullable<typeof data>["orders"]>();
    (data?.orders ?? []).forEach((o) => map.set(o.release_date, [...(map.get(o.release_date) ?? []), o]));
    return [...map.entries()];
  }, [data]);

  const leftover = data ? data.total - data.advertising - data.additional : 0;

  return (
    <Card className="shadow-soft border-border/60">
      <CardHeader>
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <CardTitle>Lucro em Caixa do Mês</CardTitle>
            <CardDescription>Lucro de cada venda (recebido − custo) contado no dia em que o dinheiro é liberado</CardDescription>
          </div>
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="w-48 capitalize"><SelectValue /></SelectTrigger>
            <SelectContent>
              {opts.map((o) => <SelectItem key={o.key} value={o.key} className="capitalize">{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Calculando...</p>
        ) : error || !data ? (
          <p className="text-sm text-destructive py-6 text-center">Não foi possível calcular.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { l: "Lucro que cai no mês", v: data.total, c: "text-primary", s: `${data.orders.length} pedido(s)` },
                { l: "Já caiu", v: data.released, c: "text-success", s: "liberado até hoje" },
                { l: "Ainda vai cair", v: data.pending, c: "text-foreground", s: "previsto até o fim do mês" },
                { l: "Fica para o mês seguinte", v: data.nextMonth, c: "text-muted-foreground", s: `${data.nextMonthCount} venda(s) já feitas` },
              ].map((k) => (
                <div key={k.l} className="rounded-lg border border-border/60 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{k.l}</p>
                  <p className={`text-2xl font-bold mt-1 ${k.c}`}>{fmtR(k.v)}</p>
                  <p className="text-xs text-muted-foreground mt-1">{k.s}</p>
                </div>
              ))}
            </div>

            <div className="rounded-lg bg-muted/30 p-4 text-sm space-y-1">
              <div className="flex justify-between"><span>Lucro que cai no mês</span><span className="font-mono">{fmtR(data.total)}</span></div>
              <div className="flex justify-between text-muted-foreground"><span>− Publicidade cobrada no mês</span><span className="font-mono">{fmtR(data.advertising)}</span></div>
              <div className="flex justify-between text-muted-foreground"><span>− Custos adicionais do mês</span><span className="font-mono">{fmtR(data.additional)}</span></div>
              <div className="flex justify-between font-semibold border-t border-border/60 pt-2 mt-1">
                <span>Sobra para gastar</span>
                <span className={`font-mono ${leftover >= 0 ? "text-success" : "text-destructive"}`}>{fmtR(leftover)}</span>
              </div>
            </div>

            <div className="space-y-1.5">
              {byDay.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Nenhuma liberação neste mês.</p>}
              {byDay.map(([day, list]) => {
                const total = list.reduce((s, o) => s + o.profit, 0);
                const isOpen = open === day;
                const done = list.every((o) => o.released);
                return (
                  <div key={day} className="rounded-lg border border-border/50">
                    <button onClick={() => setOpen(isOpen ? null : day)} className="w-full flex items-center justify-between px-3 py-2 text-sm">
                      <span className="flex items-center gap-2">
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        <span className="font-medium">{fmtD(day)}</span>
                        <span className="text-muted-foreground">{list.length} pedido(s)</span>
                        {done && <Badge variant="secondary">liberado</Badge>}
                      </span>
                      <span className={`font-mono font-semibold ${total >= 0 ? "text-primary" : "text-destructive"}`}>{fmtR(total)}</span>
                    </button>
                    {isOpen && (
                      <div className="px-3 pb-3 overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead className="text-muted-foreground">
                            <tr className="text-left"><th className="py-1">Loja</th><th>Pedido</th><th>Venda</th><th className="text-right">Recebido</th><th className="text-right">Custo</th><th className="text-right">Lucro</th><th className="text-right">Liberação</th></tr>
                          </thead>
                          <tbody>
                            {list.map((o) => (
                              <tr key={o.id} className="border-t border-border/40">
                                <td className="py-1">{o.store_name}</td>
                                <td className="font-mono">{o.ml_order_id}</td>
                                <td>{new Date(o.date_created).toLocaleDateString("pt-BR")}</td>
                                <td className="text-right font-mono">{fmtR(o.received)}</td>
                                <td className="text-right font-mono">{fmtR(o.cost)}</td>
                                <td className="text-right font-mono">{fmtR(o.profit)}</td>
                                <td className="text-right">{o.confirmed ? "confirmada" : "estimada"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

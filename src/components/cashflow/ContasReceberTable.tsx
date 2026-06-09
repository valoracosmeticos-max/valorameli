import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { format, parseISO, differenceInDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ReleaseEvent } from "@/hooks/useCashFlow";

interface Props { releases: ReleaseEvent[] }

const fmtR  = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDt = (d: string) => format(parseISO(d), "dd/MM/yyyy", { locale: ptBR });

export const ContasReceberTable = ({ releases }: Props) => {
  const today = new Date();

  if (releases.length === 0) {
    return (
      <Card className="shadow-soft border-border/60">
        <CardHeader><CardTitle>Contas a Receber</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-8">
            Nenhum recebimento pendente. Sincronize os pagamentos para ver o calendário.
          </p>
        </CardContent>
      </Card>
    );
  }

  const total = releases.reduce((s, r) => s + (r.net_received_amount ?? 0), 0);

  return (
    <Card className="shadow-soft border-border/60">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Contas a Receber — Detalhamento</CardTitle>
          <span className="text-sm font-semibold text-primary">{fmtR(total)} total</span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pedido ML</TableHead>
                <TableHead>Data do pedido</TableHead>
                <TableHead>Data liberação</TableHead>
                <TableHead>Dias restantes</TableHead>
                <TableHead className="text-right">Valor líquido</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {releases.map((r) => {
                const daysLeft = differenceInDays(parseISO(r.money_release_date), today);
                return (
                  <TableRow key={r.mp_payment_id}>
                    <TableCell className="font-mono text-xs">
                      {r.ml_order_id ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {r.date_approved ? fmtDt(r.date_approved) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="tabular-nums">{fmtDt(r.money_release_date)}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          daysLeft === 0 ? "default" :
                          daysLeft <= 3  ? "default" :
                          daysLeft <= 7  ? "secondary" : "outline"
                        }
                      >
                        {daysLeft === 0 ? "Hoje" : `${daysLeft}d`}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {fmtR(r.net_received_amount ?? 0)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  format, parseISO, startOfWeek, addDays, isAfter, isBefore, addWeeks,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { ReleaseEvent } from "@/hooks/useCashFlow";

interface Props { releases: ReleaseEvent[] }

const fmtR = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const CalendarioRecebimentos = ({ releases }: Props) => {
  const today = new Date();

  // Próximas 8 semanas agrupadas
  const weeks = useMemo(() => {
    return Array.from({ length: 8 }, (_, w) => {
      const start  = startOfWeek(addWeeks(today, w), { weekStartsOn: 1 });
      const end    = addDays(start, 6);
      const endInc = addDays(end, 1);
      const events = releases.filter((r) => {
        const d = parseISO(r.money_release_date);
        return !isBefore(d, start) && isBefore(d, endInc);
      });
      const total = events.reduce((s, e) => s + (e.net_received_amount ?? 0), 0);
      return { start, end, total, events };
    });
  }, [releases]);

  const totalUpcoming = releases.reduce((s, r) => s + (r.net_received_amount ?? 0), 0);

  return (
    <Card className="shadow-soft border-border/60">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Calendário de Recebimentos</CardTitle>
          <Badge variant="outline" className="text-sm font-semibold px-3 py-1">
            {fmtR(totalUpcoming)} a receber
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {weeks.map(({ start, end, total, events }) => (
            <div
              key={start.toISOString()}
              className={`rounded-lg border p-3 transition-colors ${
                total > 0
                  ? "border-primary/30 bg-primary/5"
                  : "border-border/40 bg-muted/10"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium">
                  {format(start, "dd MMM", { locale: ptBR })}
                  {" – "}
                  {format(end, "dd MMM", { locale: ptBR })}
                </p>
                {total > 0 ? (
                  <span className="text-sm font-bold text-primary">{fmtR(total)}</span>
                ) : (
                  <span className="text-xs text-muted-foreground">Sem liberações</span>
                )}
              </div>
              {events.length > 0 && (
                <div className="space-y-0.5 mt-1">
                  {events.slice(0, 6).map((ev) => (
                    <div
                      key={ev.mp_payment_id}
                      className="flex items-center justify-between text-xs text-muted-foreground"
                    >
                      <span>
                        {format(parseISO(ev.money_release_date), "EEE dd/MM", { locale: ptBR })}
                        {ev.installments > 1 && (
                          <span className="ml-1 text-muted-foreground/60">{ev.installments}x</span>
                        )}
                      </span>
                      <span className="font-mono">{fmtR(ev.net_received_amount ?? 0)}</span>
                    </div>
                  ))}
                  {events.length > 6 && (
                    <p className="text-xs text-muted-foreground text-center pt-0.5">
                      +{events.length - 6} liberações
                    </p>
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

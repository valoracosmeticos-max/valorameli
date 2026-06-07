import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Edit, Trash2 } from "lucide-react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

export interface Purchase {
  id:             string;
  supplier:       string;
  description:    string | null;
  invoice_number: string | null;
  purchase_date:  string;
  due_date:       string;
  paid_date:      string | null;
  total_amount:   number;
  status:         string;
}

interface Props {
  purchases: Purchase[];
  onEdit:    (id: string) => void;
  onDelete:  (id: string) => void;
}

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "Pendente", variant: "secondary" },
  paid:    { label: "Pago",     variant: "default" },
  overdue: { label: "Vencido",  variant: "destructive" },
};

const fmt  = (d: string) => format(parseISO(d), "dd/MM/yyyy", { locale: ptBR });
const fmtR = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const ComprasTable = ({ purchases, onEdit, onDelete }: Props) => (
  <div className="rounded-lg border">
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
          <TableRow>
            <TableCell colSpan={8} className="text-center text-muted-foreground py-12">
              Nenhuma compra registrada. Clique em "Nova Compra" para começar.
            </TableCell>
          </TableRow>
        )}
        {purchases.map((p) => {
          const sc = statusConfig[p.status] ?? statusConfig.pending;
          return (
            <TableRow key={p.id}>
              <TableCell className="font-medium">{p.supplier}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{p.invoice_number ?? "—"}</TableCell>
              <TableCell className="tabular-nums">{fmt(p.purchase_date)}</TableCell>
              <TableCell className="tabular-nums">{fmt(p.due_date)}</TableCell>
              <TableCell className="tabular-nums">
                {p.paid_date ? fmt(p.paid_date) : <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell className="text-right font-mono">{fmtR(p.total_amount)}</TableCell>
              <TableCell>
                <Badge variant={sc.variant}>{sc.label}</Badge>
              </TableCell>
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
  </div>
);

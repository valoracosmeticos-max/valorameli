import { useEffect, useState } from "react";
import { format } from "date-fns";
import { User, Package } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface OrderItem {
  id: string;
  title: string;
  quantity: number;
}

interface DispatchOrder {
  id: string;
  ml_order_id: string;
  buyer_name: string | null;
  date_created: string;
  order_items: OrderItem[];
}

const Despacho = () => {
  const [orders, setOrders] = useState<DispatchOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("orders")
        .select("id, ml_order_id, buyer_name, date_created, order_items(id, title, quantity)")
        .in("status", ["paid", "confirmed"])
        .order("date_created", { ascending: false })
        .limit(100);
      if (!error && data) setOrders(data as any);
      setLoading(false);
    };
    load();
  }, []);

  return (
    <div className="p-8 space-y-6">
      <header>
        <h1 className="text-3xl font-bold">Despacho</h1>
        <p className="text-muted-foreground">Pedidos pagos prontos para separação</p>
      </header>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-lg" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Nenhum pedido para despacho no momento.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {orders.map((order) => (
            <Card key={order.id} className="shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <User className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold truncate">
                        {order.buyer_name || "Cliente não informado"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        #{order.ml_order_id}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {format(new Date(order.date_created), "dd/MM HH:mm")}
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {order.order_items?.map((item) => (
                    <li key={item.id} className="flex items-start gap-2 text-sm">
                      <Badge variant="default" className="shrink-0 text-sm px-2.5 py-0.5">
                        {item.quantity}x
                      </Badge>
                      <span className="leading-snug">{item.title}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default Despacho;

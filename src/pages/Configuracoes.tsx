import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, RefreshCw, Store, CheckCircle2, AlertTriangle, Trash2, DownloadCloud } from "lucide-react";
import { format } from "date-fns";

interface StoreRow {
  id: string;
  name: string;
  ml_seller_id: string | null;
  ml_nickname: string | null;
  token_expires_at: string | null;
  last_sync_at: string | null;
  created_at: string;
}

const ML_AUTH_BASE = "https://auth.mercadolivre.com.br/authorization";
const REDIRECT_PATH = "/auth/ml-callback";

async function generatePKCE() {
  const random = new Uint8Array(32);
  crypto.getRandomValues(random);
  const verifier = btoa(String.fromCharCode(...random))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const enc = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", enc);
  const challenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return { verifier, challenge };
}

const Configuracoes = () => {
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [storeName, setStoreName] = useState("");
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("stores")
      .select("id, name, ml_seller_id, ml_nickname, token_expires_at, last_sync_at, created_at")
      .order("created_at", { ascending: true });
    if (error) toast.error(error.message);
    setStores(data ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const startOAuth = async () => {
    if (!storeName.trim()) {
      toast.error("Informe um nome para a loja");
      return;
    }
    // ML_CLIENT_ID is server-side only. We need it client-side to start OAuth.
    // Use a public env or fetch from a small edge function. Here we ask the user
    // to set it in a discoverable way: read from window or prompt fallback.
    // Solution: store client_id in the stores via secret-bridge endpoint. For
    // simplicity we use a tiny edge function "ml-public-config" to expose it.
    try {
      const { data, error } = await supabase.functions.invoke("ml-public-config");
      if (error || !data?.client_id) {
        toast.error("Não foi possível obter o Client ID do Mercado Livre");
        return;
      }
      const clientId = data.client_id as string;
      const redirectUri = `${window.location.origin}${REDIRECT_PATH}`;
      const { verifier, challenge } = await generatePKCE();
      sessionStorage.setItem("ml_pkce_verifier", verifier);
      sessionStorage.setItem("ml_store_name", storeName);
      sessionStorage.setItem("ml_redirect_uri", redirectUri);

      const params = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: challenge,
        code_challenge_method: "S256",
      });
      window.location.href = `${ML_AUTH_BASE}?${params.toString()}`;
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao iniciar OAuth");
    }
  };

  const refreshToken = async (storeId: string) => {
    setRefreshingId(storeId);
    const { error } = await supabase.functions.invoke("ml-refresh-token", {
      body: { store_id: storeId },
    });
    setRefreshingId(null);
    if (error) {
      toast.error("Falha ao renovar token");
      return;
    }
    toast.success("Token renovado");
    load();
  };

  const syncStore = async (storeId: string) => {
    setSyncingId(storeId);
    toast.info("Sincronizando pedidos... isso pode levar alguns minutos.");
    const { data, error } = await supabase.functions.invoke("ml-sync-orders", {
      body: { store_id: storeId, days: 90 },
    });
    setSyncingId(null);
    if (error) {
      toast.error("Falha ao sincronizar: " + error.message);
      return;
    }
    const sum = data?.summary?.[0];
    toast.success(`Sincronização concluída: ${sum?.fetched ?? 0} pedido(s)`);
    load();
  };

  const removeStore = async (storeId: string) => {
    if (!confirm("Remover esta loja e todos os pedidos/produtos vinculados?")) return;
    const { error } = await supabase.from("stores").delete().eq("id", storeId);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Loja removida");
    load();
  };

  const tokenStatus = (s: StoreRow) => {
    if (!s.token_expires_at) return { label: "Sem token", variant: "destructive" as const };
    const expires = new Date(s.token_expires_at).getTime();
    if (expires < Date.now()) return { label: "Token expirado", variant: "destructive" as const };
    return { label: "Conectada", variant: "default" as const };
  };

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Configurações</h1>
          <p className="text-muted-foreground mt-1">Gerencie a conexão com suas lojas Mercado Livre</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" />Conectar Loja</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Conectar nova loja</DialogTitle>
              <DialogDescription>
                Dê um nome para identificar essa loja. Em seguida você será redirecionado ao Mercado Livre para autorizar o acesso.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="store-name">Nome da loja</Label>
              <Input
                id="store-name"
                placeholder="Ex: Loja 1 - Valora"
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={startOAuth}>Continuar para o Mercado Livre</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="shadow-soft border-border/60">
        <CardHeader>
          <CardTitle>Lojas conectadas</CardTitle>
          <CardDescription>{stores.length} loja(s) configurada(s)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading && <p className="text-sm text-muted-foreground">Carregando...</p>}
          {!loading && stores.length === 0 && (
            <div className="py-12 text-center space-y-2">
              <Store className="h-12 w-12 opacity-30 mx-auto" />
              <p className="text-muted-foreground">Nenhuma loja conectada ainda.</p>
            </div>
          )}
          {stores.map((s) => {
            const st = tokenStatus(s);
            return (
              <div key={s.id} className="flex items-center justify-between gap-4 p-4 rounded-lg border border-border bg-card">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-10 w-10 rounded-lg bg-gradient-primary flex items-center justify-center shrink-0">
                    <Store className="h-5 w-5 text-primary-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium truncate">{s.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      Seller ID: {s.ml_seller_id ?? "—"} {s.ml_nickname && `· ${s.ml_nickname}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Última sync: {s.last_sync_at ? format(new Date(s.last_sync_at), "dd/MM/yyyy HH:mm") : "nunca"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant={st.variant} className="gap-1">
                    {st.variant === "default" ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                    {st.label}
                  </Badge>
                  <Button
                    size="sm"
                    onClick={() => syncStore(s.id)}
                    disabled={syncingId === s.id}
                  >
                    <DownloadCloud className={`h-3.5 w-3.5 mr-1.5 ${syncingId === s.id ? "animate-pulse" : ""}`} />
                    {syncingId === s.id ? "Sincronizando..." : "Sincronizar"}
                  </Button>
                  <Button
                    size="sm" variant="outline"
                    onClick={() => refreshToken(s.id)}
                    disabled={refreshingId === s.id}
                    title="Renovar token"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${refreshingId === s.id ? "animate-spin" : ""}`} />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => removeStore(s.id)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
};

export default Configuracoes;

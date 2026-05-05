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
import { Plus, RefreshCw, Store, CheckCircle2, AlertTriangle, Trash2, DownloadCloud, Info, ExternalLink } from "lucide-react";
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

const Configuracoes = () => {
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [storeName, setStoreName] = useState("");
  const [sellerId, setSellerId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [refreshTokenInput, setRefreshTokenInput] = useState("");
  const [saving, setSaving] = useState(false);
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

  const resetForm = () => {
    setStoreName("");
    setSellerId("");
    setAccessToken("");
    setRefreshTokenInput("");
  };

  const saveManualToken = async () => {
    if (!storeName.trim()) return toast.error("Informe o nome da loja");
    if (!sellerId.trim()) return toast.error("Informe o Seller ID (User ID do ML)");
    if (!accessToken.trim()) return toast.error("Informe o Access Token");

    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("ml-connect-store", {
        body: {
          store_name: storeName.trim(),
          seller_id: sellerId.trim(),
          access_token: accessToken.trim(),
          refresh_token: refreshTokenInput.trim() || undefined,
        },
      });

      if (error) {
        // Try to extract server message
        const ctx: any = (error as any).context;
        let serverMsg: string | null = null;
        try {
          if (ctx && typeof ctx.json === "function") {
            const j = await ctx.json();
            serverMsg = j?.error ?? null;
          }
        } catch (_) {}
        toast.error(serverMsg ?? error.message ?? "Falha ao conectar loja");
        return;
      }

      if (data?.mismatch) {
        toast.warning(`O token pertence ao Seller ${data.seller_id} (${data.nickname ?? "—"}). Salvo com esse ID.`);
      }
      toast.success(
        data?.updated
          ? `Loja "${storeName}" atualizada${data?.nickname ? ` (${data.nickname})` : ""}`
          : `Loja "${storeName}" conectada${data?.nickname ? ` (${data.nickname})` : ""}`
      );

      resetForm();
      setOpen(false);
      load();
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const refreshToken = async (storeId: string) => {
    setRefreshingId(storeId);
    const { error } = await supabase.functions.invoke("ml-refresh-token", {
      body: { store_id: storeId },
    });
    setRefreshingId(null);
    if (error) {
      toast.error("Falha ao renovar token. Verifique se o refresh token está cadastrado.");
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
          <p className="text-muted-foreground mt-1">Conecte suas lojas usando os tokens gerados no painel de Devs do Mercado Livre</p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" />Conectar Loja</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Conectar nova loja</DialogTitle>
              <DialogDescription>
                Cole abaixo o Seller ID, Access Token e Refresh Token gerados no painel de desenvolvedores do Mercado Livre.
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-md border border-border bg-muted/40 p-3 text-xs space-y-2">
              <div className="flex gap-2">
                <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-medium text-foreground">Como obter os tokens</p>
                  <p className="text-muted-foreground">
                    Acesse <span className="font-mono">developers.mercadolivre.com.br</span> → sua aplicação → use o flow OAuth para gerar os tokens dessa conta de vendedor específica e cole aqui.
                  </p>
                  <a
                    href="https://developers.mercadolivre.com.br/devcenter"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    Abrir Dev Center <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="store-name">Nome da loja *</Label>
                <Input
                  id="store-name"
                  placeholder="Ex: Loja Madama"
                  value={storeName}
                  onChange={(e) => setStoreName(e.target.value)}
                  maxLength={80}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="seller-id">Seller ID (User ID) *</Label>
                <Input
                  id="seller-id"
                  placeholder="Ex: 123456789"
                  value={sellerId}
                  onChange={(e) => setSellerId(e.target.value.replace(/\D/g, ""))}
                  inputMode="numeric"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="access-token">Access Token *</Label>
                <Input
                  id="access-token"
                  placeholder="APP_USR-..."
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="refresh-token">Refresh Token (recomendado)</Label>
                <Input
                  id="refresh-token"
                  placeholder="TG-..."
                  value={refreshTokenInput}
                  onChange={(e) => setRefreshTokenInput(e.target.value)}
                  className="font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">
                  Sem o refresh token, o access token expira em 6h e precisa ser atualizado manualmente.
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
              <Button onClick={saveManualToken} disabled={saving}>
                {saving ? "Validando..." : "Salvar e validar"}
              </Button>
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
                    title="Renovar token via refresh_token"
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

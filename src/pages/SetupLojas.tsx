import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CheckCircle2, Store, Plus, Trash2, ExternalLink, ArrowLeft } from "lucide-react";

interface StoreSlot {
  name: string;
  status: "idle" | "connected";
  seller_id?: string;
  nickname?: string;
  store_id?: string;
}

// PKCE helpers
function base64UrlEncode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function generatePkce() {
  const arr = new Uint8Array(64);
  crypto.getRandomValues(arr);
  const verifier = base64UrlEncode(arr.buffer).slice(0, 96);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = base64UrlEncode(digest);
  return { verifier, challenge };
}

const STORAGE_KEY = "ml_setup_slots";

const SetupLojas = () => {
  const [slots, setSlots] = useState<StoreSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectingName, setConnectingName] = useState<string | null>(null);

  const loadFromDb = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("stores")
      .select("id, name, ml_seller_id, ml_nickname")
      .order("created_at", { ascending: true });
    if (error) toast.error(error.message);

    const dbStores = data ?? [];
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as string[];

    // Merge: dbStores first (mark connected), then planned names that aren't in db
    const merged: StoreSlot[] = dbStores.map((s) => ({
      name: s.name,
      status: "connected" as const,
      seller_id: s.ml_seller_id ?? undefined,
      nickname: s.ml_nickname ?? undefined,
      store_id: s.id,
    }));
    for (const name of saved) {
      if (!merged.find((m) => m.name.toLowerCase() === name.toLowerCase())) {
        merged.push({ name, status: "idle" });
      }
    }
    if (merged.length === 0) merged.push({ name: "", status: "idle" });
    setSlots(merged);
    setLoading(false);
  };

  useEffect(() => { loadFromDb(); }, []);

  const persistPlanned = (next: StoreSlot[]) => {
    const planned = next.filter((s) => s.status === "idle" && s.name.trim()).map((s) => s.name.trim());
    localStorage.setItem(STORAGE_KEY, JSON.stringify(planned));
  };

  const updateSlot = (idx: number, patch: Partial<StoreSlot>) => {
    setSlots((prev) => {
      const next = prev.map((s, i) => (i === idx ? { ...s, ...patch } : s));
      persistPlanned(next);
      return next;
    });
  };

  const addSlot = () => {
    setSlots((prev) => [...prev, { name: "", status: "idle" }]);
  };

  const removeSlot = async (idx: number) => {
    const slot = slots[idx];
    if (slot.status === "connected" && slot.store_id) {
      if (!confirm(`Remover a loja "${slot.name}"? Os pedidos vinculados também serão removidos.`)) return;
      const { error } = await supabase.from("stores").delete().eq("id", slot.store_id);
      if (error) return toast.error(error.message);
      toast.success("Loja removida");
      loadFromDb();
      return;
    }
    setSlots((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      persistPlanned(next);
      return next.length ? next : [{ name: "", status: "idle" }];
    });
  };

  const startOAuth = async (idx: number) => {
    const slot = slots[idx];
    const name = slot.name.trim();
    if (!name) return toast.error("Informe um nome para a loja");
    if (slots.some((s, i) => i !== idx && s.name.trim().toLowerCase() === name.toLowerCase())) {
      return toast.error("Já existe outra loja com esse nome");
    }

    setConnectingName(name);
    try {
      const { data: cfg, error: cfgErr } = await supabase.functions.invoke("ml-public-config");
      if (cfgErr || !cfg?.client_id) {
        toast.error("Não foi possível obter o client_id do Mercado Livre.");
        setConnectingName(null);
        return;
      }
      const clientId = String(cfg.client_id);
      const { verifier, challenge } = await generatePkce();
      const redirectUri = `${window.location.origin}/auth/ml-callback`;

      sessionStorage.setItem("ml_pkce_verifier", verifier);
      sessionStorage.setItem("ml_store_name", name);
      sessionStorage.setItem("ml_redirect_uri", redirectUri);

      const authUrl =
        `https://auth.mercadolivre.com.br/authorization` +
        `?response_type=code` +
        `&client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&code_challenge=${encodeURIComponent(challenge)}` +
        `&code_challenge_method=S256`;

      // Force ML logout first so user can pick a different account
      const logoutUrl = `https://www.mercadolivre.com.br/jms/mlb/lgz/logout?go=${encodeURIComponent(authUrl)}`;
      window.location.href = logoutUrl;
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao iniciar OAuth");
      setConnectingName(null);
    }
  };

  const allConnected = slots.length > 0 && slots.every((s) => s.status === "connected");

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/configuracoes"><ArrowLeft className="h-4 w-4 mr-1" />Voltar</Link>
        </Button>
      </div>

      <div>
        <h1 className="text-3xl font-bold tracking-tight">Setup de Lojas</h1>
        <p className="text-muted-foreground mt-1">
          Adicione cada loja que você possui no Mercado Livre. Conecte uma de cada vez — entre cada conexão fazemos
          logout do ML para que você possa escolher a conta correta.
        </p>
      </div>

      <Card className="shadow-soft border-border/60">
        <CardHeader>
          <CardTitle>Suas lojas</CardTitle>
          <CardDescription>
            Dê um nome para cada loja e clique em "Conectar" para autorizar via Mercado Livre.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading && <p className="text-sm text-muted-foreground">Carregando...</p>}

          {!loading && slots.map((slot, idx) => (
            <div key={idx} className="flex items-center gap-3 p-4 rounded-lg border border-border bg-card">
              <div className="h-10 w-10 rounded-lg bg-gradient-primary flex items-center justify-center shrink-0">
                <Store className="h-5 w-5 text-primary-foreground" />
              </div>

              <div className="flex-1 min-w-0 space-y-1.5">
                {slot.status === "connected" ? (
                  <>
                    <p className="font-medium truncate">{slot.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      Seller ID: {slot.seller_id ?? "—"} {slot.nickname && `· ${slot.nickname}`}
                    </p>
                  </>
                ) : (
                  <>
                    <Label htmlFor={`name-${idx}`} className="text-xs">Nome da loja</Label>
                    <Input
                      id={`name-${idx}`}
                      placeholder="Ex: Loja Madama"
                      value={slot.name}
                      onChange={(e) => updateSlot(idx, { name: e.target.value })}
                      maxLength={80}
                      disabled={connectingName !== null}
                    />
                  </>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {slot.status === "connected" ? (
                  <Badge variant="default" className="gap-1">
                    <CheckCircle2 className="h-3 w-3" />Conectada
                  </Badge>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => startOAuth(idx)}
                    disabled={!slot.name.trim() || connectingName !== null}
                  >
                    <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                    {connectingName === slot.name.trim() ? "Redirecionando..." : `Conectar Loja`}
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => removeSlot(idx)} disabled={connectingName !== null}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            </div>
          ))}

          <Button variant="outline" onClick={addSlot} disabled={connectingName !== null} className="w-full">
            <Plus className="h-4 w-4 mr-2" />Adicionar outra loja
          </Button>
        </CardContent>
      </Card>

      {allConnected && (
        <div className="flex justify-end">
          <Button asChild>
            <Link to="/configuracoes">Concluir setup</Link>
          </Button>
        </div>
      )}
    </div>
  );
};

export default SetupLojas;

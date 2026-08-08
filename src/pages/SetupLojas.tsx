import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CheckCircle2, Store, Plus, Trash2, ExternalLink, ArrowLeft, KeyRound, LogOut } from "lucide-react";

interface ManualForm {
  open: boolean;
  seller_id: string;
  app_id: string;
  access_token: string;
  refresh_token: string;
  saving: boolean;
  error: string | null;
}

interface StoreSlot {
  name: string;
  status: "idle" | "connected";
  seller_id?: string;
  nickname?: string;
  store_id?: string;
  manual?: ManualForm;
}

const emptyManual = (): ManualForm => ({
  open: false,
  seller_id: "",
  app_id: "",
  access_token: "",
  refresh_token: "",
  saving: false,
  error: null,
});

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

// O redirect_uri precisa bater EXATAMENTE com o cadastrado no Dev Center do ML.
// window.location.origin muda entre localhost / preview / domínio próprio e quebra o match,
// por isso VITE_ML_REDIRECT_URI deve ser definido em produção.
const ML_REDIRECT_URI =
  import.meta.env.VITE_ML_REDIRECT_URI ?? `${window.location.origin}/auth/ml-callback`;

// Contexto do OAuth fica em localStorage indexado pelo state.
// sessionStorage se perde se o ML abrir o retorno em outra aba/janela.
const OAUTH_PREFIX = "ml_oauth_";
const OAUTH_TTL_MS = 30 * 60 * 1000;

const oauthKey = (state: string) => `${OAUTH_PREFIX}${state}`;

const pruneOauthState = () => {
  const now = Date.now();
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith(OAUTH_PREFIX)) continue;
    try {
      const { ts } = JSON.parse(localStorage.getItem(key) ?? "{}");
      if (!ts || now - ts > OAUTH_TTL_MS) localStorage.removeItem(key);
    } catch {
      localStorage.removeItem(key);
    }
  }
};

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
      const redirectUri = ML_REDIRECT_URI;

      // O ML exige redirect_uri estático, então o contexto da loja viaja pelo state.
      const state = crypto.randomUUID();
      pruneOauthState();
      localStorage.setItem(
        oauthKey(state),
        JSON.stringify({ verifier, name, redirectUri, returnTo: "/setup-lojas", ts: Date.now() }),
      );

      // Parâmetros suportados pelo ML: response_type, client_id, redirect_uri,
      // state, code_challenge, code_challenge_method. Não existe "prompt" —
      // enviar parâmetro não suportado faz o ML responder invalid_request.
      const authUrl =
        `https://auth.mercadolivre.com.br/authorization` +
        `?response_type=code` +
        `&client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&state=${encodeURIComponent(state)}` +
        `&code_challenge=${encodeURIComponent(challenge)}` +
        `&code_challenge_method=S256`;

      window.location.href = authUrl;
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao iniciar OAuth");
      setConnectingName(null);
    }
  };

  // O ML não aceita forçar re-login pela URL de autorização. Para conectar uma
  // segunda loja é preciso sair da conta atual antes de autorizar a próxima.
  const switchMlAccount = () => {
    const back = `${window.location.origin}/setup-lojas`;
    window.location.href =
      `https://www.mercadolivre.com.br/jms/mlb/lgz/logout?go=${encodeURIComponent(back)}`;
  };

  const toggleManual = (idx: number) => {
    setSlots((prev) => prev.map((s, i) => {
      if (i !== idx) return s;
      const cur = s.manual ?? emptyManual();
      return { ...s, manual: { ...cur, open: !cur.open, error: null } };
    }));
  };

  const updateManual = (idx: number, patch: Partial<ManualForm>) => {
    setSlots((prev) => prev.map((s, i) => {
      if (i !== idx) return s;
      const cur = s.manual ?? emptyManual();
      return { ...s, manual: { ...cur, ...patch } };
    }));
  };

  const submitManual = async (idx: number) => {
    const slot = slots[idx];
    const name = slot.name.trim();
    const m = slot.manual;
    if (!name) return updateManual(idx, { error: "Informe o nome da loja acima." });
    if (!m) return;
    if (!m.seller_id.trim() || !m.access_token.trim() || !m.refresh_token.trim()) {
      return updateManual(idx, { error: "Preencha Seller ID, Access Token e Refresh Token." });
    }
    updateManual(idx, { saving: true, error: null });
    try {
      const { data, error } = await supabase.functions.invoke("ml-manual-connect", {
        body: {
          store_name: name,
          seller_id: m.seller_id.trim(),
          app_id: m.app_id.trim() || undefined,
          access_token: m.access_token.trim(),
          refresh_token: m.refresh_token.trim(),
        },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error ?? "Falha ao validar tokens.");
      toast.success("Loja conectada manualmente");
      await loadFromDb();
    } catch (e: any) {
      updateManual(idx, { saving: false, error: e?.message ?? "Erro inesperado." });
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
          Adicione cada loja que você possui no Mercado Livre e clique em "Conectar" para autorizar.
        </p>
        <p className="text-xs text-muted-foreground mt-2">
          Ao clicar em Conectar, você será redirecionado ao Mercado Livre e a autorização será
          concedida para a conta que estiver logada no navegador. Para adicionar uma loja diferente,
          saia da conta atual antes.
        </p>
        <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3 space-y-2">
          <p className="text-xs font-medium">Para conectar outra loja</p>
          <ol className="text-xs text-muted-foreground list-decimal list-inside space-y-0.5">
            <li>Clique em "Sair da conta do Mercado Livre" abaixo.</li>
            <li>Volte aqui, informe o nome da nova loja e clique em "Conectar Loja".</li>
            <li>Faça login com a conta <strong>administradora principal</strong> dessa loja.</li>
          </ol>
          <p className="text-xs text-muted-foreground">
            Contas de <strong>colaborador/operador</strong> não conseguem autorizar aplicativos — o
            Mercado Livre recusa com "não foi possível conectar o aplicativo à sua conta".
          </p>
          <Button variant="outline" size="sm" onClick={switchMlAccount} disabled={connectingName !== null}>
            <LogOut className="h-3.5 w-3.5 mr-1.5" />Sair da conta do Mercado Livre
          </Button>
        </div>
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
            <div key={idx} className="rounded-lg border border-border bg-card">
              <div className="flex items-center gap-3 p-4">
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
                    <>
                      <Button
                        size="sm"
                        onClick={() => startOAuth(idx)}
                        disabled={!slot.name.trim() || connectingName !== null}
                      >
                        <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                        {connectingName === slot.name.trim() ? "Redirecionando..." : `Conectar Loja`}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => toggleManual(idx)}
                        disabled={connectingName !== null}
                      >
                        <KeyRound className="h-3.5 w-3.5 mr-1.5" />
                        {slot.manual?.open ? "Fechar" : "Inserir tokens manualmente"}
                      </Button>
                    </>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => removeSlot(idx)} disabled={connectingName !== null}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>

              {slot.status !== "connected" && slot.manual?.open && (
                <div className="border-t border-border p-4 space-y-3 bg-muted/30">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Seller ID (User ID numérico)</Label>
                      <Input
                        placeholder="Ex: 123456789"
                        value={slot.manual.seller_id}
                        onChange={(e) => updateManual(idx, { seller_id: e.target.value })}
                        disabled={slot.manual.saving}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Id do aplicativo</Label>
                      <Input
                        placeholder="Ex: 1234567890123456"
                        value={slot.manual.app_id}
                        onChange={(e) => updateManual(idx, { app_id: e.target.value })}
                        disabled={slot.manual.saving}
                      />
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <Label className="text-xs">Access Token</Label>
                      <Input
                        placeholder="APP_USR-..."
                        value={slot.manual.access_token}
                        onChange={(e) => updateManual(idx, { access_token: e.target.value })}
                        disabled={slot.manual.saving}
                      />
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <Label className="text-xs">Refresh Token</Label>
                      <Input
                        placeholder="TG-..."
                        value={slot.manual.refresh_token}
                        onChange={(e) => updateManual(idx, { refresh_token: e.target.value })}
                        disabled={slot.manual.saving}
                      />
                    </div>
                  </div>

                  {slot.manual.error && (
                    <p className="text-sm text-destructive">{slot.manual.error}</p>
                  )}

                  <div className="flex justify-end">
                    <Button size="sm" onClick={() => submitManual(idx)} disabled={slot.manual.saving}>
                      {slot.manual.saving ? "Validando..." : "Salvar e validar"}
                    </Button>
                  </div>
                </div>
              )}
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

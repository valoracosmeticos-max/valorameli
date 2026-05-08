import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const MLCallback = () => {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("Processando autorização...");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const code = params.get("code");
    const err = params.get("error");
    if (err) {
      setStatus("error");
      setMessage(`Autorização recusada: ${err}`);
      return;
    }
    if (!code) {
      setStatus("error");
      setMessage("Código de autorização ausente.");
      return;
    }

    const verifier = sessionStorage.getItem("ml_pkce_verifier");
    const storeName = sessionStorage.getItem("ml_store_name");
    const redirectUri = sessionStorage.getItem("ml_redirect_uri");
    const returnTo = sessionStorage.getItem("ml_return_to") || "/configuracoes";

    if (!verifier || !storeName || !redirectUri) {
      setStatus("error");
      setMessage("Sessão de autorização expirou. Tente conectar novamente.");
      return;
    }

    supabase.functions
      .invoke("ml-oauth-callback", {
        body: { code, redirect_uri: redirectUri, store_name: storeName, code_verifier: verifier },
      })
      .then(async ({ data, error }) => {
        sessionStorage.removeItem("ml_pkce_verifier");
        sessionStorage.removeItem("ml_store_name");
        sessionStorage.removeItem("ml_redirect_uri");
        sessionStorage.removeItem("ml_return_to");
        if (error || !data?.success) {
          setStatus("error");
          setMessage(data?.error ?? error?.message ?? "Falha ao trocar o código por um token.");
          return;
        }

        // Detect "same ML account reconnected with a different name" case
        const sellerId = data.seller_id ? String(data.seller_id) : null;
        if (sellerId) {
          const { data: matches } = await supabase
            .from("stores")
            .select("name, ml_seller_id")
            .eq("ml_seller_id", sellerId);
          const other = matches?.find((m: any) => m.name !== storeName);
          if (other && matches && matches.length === 1) {
            // Only one row exists for this seller and its name was just overwritten by our upsert.
            // That means the user authorized the SAME ML account they had before, just renamed it.
            // Heuristic: if the new name differs from typical "rename intent", warn them.
            // We can't perfectly tell, so we only warn when the seller already had a store with a different name.
          }
          if (other) {
            setStatus("error");
            setMessage(
              `Você autorizou a mesma conta ML que já está conectada como "${other.name}". ` +
              `Para conectar outra loja, faça logout do Mercado Livre no navegador e tente novamente entrando com a conta correta.`,
            );
            return;
          }
        }

        setStatus("success");
        setMessage(`Loja conectada com sucesso${data.nickname ? ` (${data.nickname})` : ""}!`);
        setTimeout(() => nav(returnTo, { replace: true }), 1500);
      });
  }, [params, nav]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-subtle p-4">
      <Card className="w-full max-w-md shadow-soft">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {status === "loading" && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
            {status === "success" && <CheckCircle2 className="h-5 w-5 text-success" />}
            {status === "error" && <XCircle className="h-5 w-5 text-destructive" />}
            {status === "loading" && "Conectando..."}
            {status === "success" && "Conectado!"}
            {status === "error" && "Erro na conexão"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{message}</p>
          {status === "error" && (
            <Button onClick={() => nav(returnTo, { replace: true })} className="w-full">
              Voltar
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default MLCallback;

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

    if (!verifier || !storeName || !redirectUri) {
      setStatus("error");
      setMessage("Sessão de autorização expirou. Tente conectar novamente.");
      return;
    }

    supabase.functions
      .invoke("ml-oauth-callback", {
        body: { code, redirect_uri: redirectUri, store_name: storeName, code_verifier: verifier },
      })
      .then(({ data, error }) => {
        sessionStorage.removeItem("ml_pkce_verifier");
        sessionStorage.removeItem("ml_store_name");
        sessionStorage.removeItem("ml_redirect_uri");
        if (error || !data?.success) {
          setStatus("error");
          setMessage(data?.error ?? error?.message ?? "Falha ao trocar o código por um token.");
          return;
        }
        setStatus("success");
        setMessage(`Loja conectada com sucesso${data.nickname ? ` (${data.nickname})` : ""}!`);
        setTimeout(() => nav("/configuracoes", { replace: true }), 1500);
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
            <Button onClick={() => nav("/configuracoes", { replace: true })} className="w-full">
              Voltar para Configurações
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default MLCallback;

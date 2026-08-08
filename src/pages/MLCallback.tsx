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
  const [returnTo, setReturnTo] = useState("/configuracoes");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const code = params.get("code");
    const err = params.get("error");
    const state = params.get("state");

    if (err) {
      const desc = params.get("error_description");
      setStatus("error");
      setMessage(
        err === "invalid_operator_user_id"
          ? "Essa conta é um colaborador/operador do Mercado Livre. Só a conta administradora principal da loja pode autorizar o aplicativo."
          : `Autorização recusada pelo Mercado Livre: ${err}${desc ? ` — ${desc}` : ""}`,
      );
      return;
    }
    if (!code) {
      setStatus("error");
      setMessage("Código de autorização ausente.");
      return;
    }

    // O contexto vai em localStorage indexado pelo state — sessionStorage se perde
    // quando o ML devolve o retorno em outra aba. Fallback mantém compatibilidade
    // com autorizações iniciadas antes desta mudança.
    let ctx: { verifier?: string; name?: string; redirectUri?: string; returnTo?: string } = {};
    if (state) {
      try {
        ctx = JSON.parse(localStorage.getItem(`ml_oauth_${state}`) ?? "{}");
      } catch {
        ctx = {};
      }
      localStorage.removeItem(`ml_oauth_${state}`);
    }

    const verifier = ctx.verifier ?? sessionStorage.getItem("ml_pkce_verifier");
    const storeName = ctx.name ?? sessionStorage.getItem("ml_store_name");
    const redirectUri = ctx.redirectUri ?? sessionStorage.getItem("ml_redirect_uri");
    const rt = ctx.returnTo ?? sessionStorage.getItem("ml_return_to") ?? "/configuracoes";
    setReturnTo(rt);

    if (!verifier || !storeName || !redirectUri) {
      setStatus("error");
      setMessage(
        "Não foi possível recuperar os dados desta autorização. Isso acontece se a aba foi fechada ou se passou muito tempo. Volte e clique em Conectar novamente.",
      );
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

        // O caso "mesma conta ML autorizada com outro nome" é recusado pela
        // edge function antes de gravar e chega aqui como data.error.
        setStatus("success");
        setMessage(`Loja conectada com sucesso${data.nickname ? ` (${data.nickname})` : ""}!`);
        setTimeout(() => nav(rt, { replace: true }), 1500);
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

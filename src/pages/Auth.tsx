import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { TrendingUp } from "lucide-react";

const Auth = () => {
  const { session, loading } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (loading) return null;
  if (session) return <Navigate to="/" replace />;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Bem-vindo!");
    nav("/", { replace: true });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-subtle p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-3">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-primary shadow-glow">
            <TrendingUp className="h-7 w-7 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">ERP Vendas ML</h1>
            <p className="text-sm text-muted-foreground mt-1">Gestão das suas lojas Mercado Livre</p>
          </div>
        </div>
        <Card className="shadow-soft border-border/60">
          <CardHeader>
            <CardTitle>Entrar</CardTitle>
            <CardDescription>Acesse com seu e-mail e senha</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Senha</Label>
                <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "Entrando..." : "Entrar"}
              </Button>
            </form>
            <p className="text-xs text-muted-foreground mt-4 text-center">
              Sistema de uso interno. Acesso somente para usuários autorizados.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Auth;

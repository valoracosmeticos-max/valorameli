import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ProtectedRoute } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import Index from "./pages/Index";
import Pedidos from "./pages/Pedidos";
import Produtos from "./pages/Produtos";
import Configuracoes from "./pages/Configuracoes";
import SetupLojas from "./pages/SetupLojas";
import CustosAdicionais from "./pages/CustosAdicionais";
import FluxoCaixa from "./pages/FluxoCaixa";
import Compras from "./pages/Compras";
import Despacho from "./pages/Despacho";
import Auth from "./pages/Auth";
import MLCallback from "./pages/MLCallback";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/auth" element={<Auth />} />
          <Route path="/auth/ml-callback" element={<ProtectedRoute><MLCallback /></ProtectedRoute>} />
          <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
            <Route path="/" element={<Index />} />
            <Route path="/pedidos" element={<Pedidos />} />
            <Route path="/produtos" element={<Produtos />} />
            <Route path="/custos-adicionais" element={<CustosAdicionais />} />
            <Route path="/fluxo-caixa" element={<FluxoCaixa />} />
            <Route path="/compras" element={<Compras />} />
            <Route path="/configuracoes" element={<Configuracoes />} />
            <Route path="/setup-lojas" element={<SetupLojas />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

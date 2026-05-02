-- Tabela de custos adicionais da operação
CREATE TABLE public.additional_costs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  cost_type TEXT NOT NULL DEFAULT 'sporadic', -- 'fixed' (mensal recorrente) | 'sporadic' (avulso)
  cost_date DATE NOT NULL DEFAULT CURRENT_DATE,
  category TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.additional_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own additional_costs"
ON public.additional_costs
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_additional_costs_user_date ON public.additional_costs(user_id, cost_date DESC);

CREATE TRIGGER update_additional_costs_updated_at
BEFORE UPDATE ON public.additional_costs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
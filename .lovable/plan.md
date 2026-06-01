## Situação atual (confirmada)

- Este projeto Lovable está **vinculado ao Lovable Cloud** (`bulaobebfuruerltzbbe`). É o backend que minhas tools (`migration`, `deploy_edge_functions`, `secrets`, `read_query`) gerenciam hoje.
- Você atualizou `.env` no GitHub para apontar para `bjljokggqflvzlenfbps`, mas o restante do projeto continua amarrado ao Cloud antigo (`config.toml`, `client.ts` gerado, secrets, edge functions deployadas).

## Limitação real do Lovable (precisa estar claro)

> **Uma vez que o Lovable Cloud é habilitado num projeto, ele NÃO pode ser desabilitado nele.** Restaurar uma versão anterior também não desfaz. Essa é uma regra da plataforma, não um bug que eu consiga contornar.

Consequência: **não consigo "trocar" o Supabase deste projeto Lovable de `bulaobebfuruerltzbbe` para `bjljokggqflvzlenfbps`**. As tools de Supabase do Lovable continuarão escrevendo no Cloud antigo enquanto este projeto existir.

O que dá pra fazer mesmo é **bypassar o Cloud** — usar o seu Supabase próprio diretamente via SDK no frontend, ignorando as tools nativas do Lovable. Mas isso tem trade-offs reais:

- `src/integrations/supabase/client.ts` e `src/integrations/supabase/types.ts` são **autogerados pelo Lovable** e apontam para `bulaobebfuruerltzbbe`. Eles vão ser sobrescritos sempre que o Lovable regenerar.
- Minhas tools de migration/deploy de edge function continuarão indo pro Cloud antigo, inúteis pro seu projeto.
- Edge functions teriam que ser deployadas por você via Supabase CLI (`supabase functions deploy`), porque `supabase--deploy_edge_functions` deploya no Cloud antigo.
- Secrets das edge functions (ML_CLIENT_ID, ML_CLIENT_SECRET, etc.) precisam ser configurados no painel do **seu** Supabase, não via `add_secret`.

## Opções reais

### Opção A — Criar um projeto Lovable NOVO conectado ao seu Supabase (recomendado)

1. No Lovable, criar um novo projeto **sem habilitar Cloud**.
2. Conectar `bjljokggqflvzlenfbps` via integração Supabase (Connectors).
3. Eu copio o código deste projeto pro novo (via tools cross_project) e rodo todas as migrations no seu Supabase.
4. Edge functions deployam normalmente porque o Lovable está vinculado ao seu projeto.

→ Único caminho onde as tools Lovable funcionam corretamente com o seu Supabase.

### Opção B — Manter este projeto e bypassar o Cloud (não recomendado)

1. Substituir manualmente `src/integrations/supabase/client.ts` por um cliente custom que lê do `.env` (sabendo que o Lovable pode sobrescrever).
2. Eu te entrego o SQL completo do schema (`stores`, `orders`, `order_items`, `products`, `additional_costs`, `profiles`, trigger `handle_new_user`, RLS, grants) para você colar no SQL Editor do seu Supabase.
3. Você roda `supabase link --project-ref bjljokggqflvzlenfbps` + `supabase functions deploy ml-public-config ml-oauth-callback ml-manual-connect ml-refresh-token ml-sync-orders` localmente.
4. Você seta os secrets `ML_CLIENT_ID` e `ML_CLIENT_SECRET` no painel do seu Supabase (Edge Functions → Secrets). `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` já existem automaticamente em qualquer edge function.
5. Aceitar que minhas tools de Supabase deste projeto continuam apontando pro Cloud antigo (e portanto inúteis para o seu workflow daqui pra frente).

### Opção C — Voltar a usar o Lovable Cloud

Reverter `.env` para `bulaobebfuruerltzbbe`. Tudo volta a funcionar via tools Lovable. Você perde controle direto do banco mas tudo é gerenciado.

## Diga qual opção e eu sigo

Se A: me confirma, e eu te oriento exatamente como criar o projeto novo e me passar acesso.
Se B: confirma e eu já gero (1) o SQL único do schema, (2) o novo `client.ts`, (3) o passo-a-passo de CLI/secrets.
Se C: confirma e eu reverto `.env` no código + valido que tudo está funcional.

Não vou mexer em nada até você escolher.

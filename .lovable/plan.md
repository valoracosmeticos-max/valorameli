# Corrigir conexão de novas lojas (Failed to fetch)

## Causa raiz
O modal "Conectar nova loja" valida o Access Token chamando `https://api.mercadolibre.com/users/me` **diretamente do navegador**. A API do Mercado Livre não envia headers CORS, então o navegador bloqueia a chamada e retorna `Failed to fetch` — antes de qualquer validação acontecer. Isso impede salvar qualquer loja nova.

## Solução

### 1. Nova edge function `ml-connect-store`
Criar `supabase/functions/ml-connect-store/index.ts` que:
- Recebe `{ store_name, seller_id, access_token, refresh_token }` do frontend (com Authorization do usuário logado).
- Chama `https://api.mercadolibre.com/users/me` **do servidor** (sem CORS) para validar o token e obter `id` (seller real) + `nickname`.
- Se o token for inválido → retorna 400 com mensagem clara.
- Se o `seller_id` informado não bater com o do token → usa o do token e avisa.
- Faz upsert na tabela `stores` por `(user_id, ml_seller_id)`:
  - Se já existe loja com esse seller para o usuário → atualiza nome/tokens.
  - Caso contrário → insere nova linha (permitindo **múltiplas lojas** por usuário).
- Define `token_expires_at = now + 6h`.
- Usa `SUPABASE_SERVICE_ROLE_KEY` para gravar (RLS já garante que o `user_id` vem do JWT validado).

Configuração: deploy automático; manter `verify_jwt` padrão (true) para proteger.

### 2. Atualizar `src/pages/Configuracoes.tsx`
Substituir o bloco `saveManualToken` que usa `fetch(...mercadolibre...)` + `supabase.from("stores").insert/update` por uma única chamada:

```ts
const { data, error } = await supabase.functions.invoke("ml-connect-store", {
  body: { store_name, seller_id, access_token, refresh_token }
});
```

Tratar:
- `error` → toast com mensagem do servidor (ex.: "Token inválido").
- sucesso → toast com nickname retornado, fechar modal, recarregar lista.

Manter o resto da página intacto (lista de lojas, sync, refresh, remover).

### 3. Garantir suporte a múltiplas lojas
Já está suportado no modelo (`stores` é por `user_id`, sem unique global em `ml_seller_id`). A edge function faz upsert por `(user_id, ml_seller_id)`, então:
- Tokens diferentes de **vendedores diferentes** → criam lojas separadas.
- Mesmo vendedor → atualiza a loja existente (evita duplicata).

Cada loja segue isolada no Dashboard e Pedidos pelo `store_id` (já implementado).

## Arquivos
- **Criar**: `supabase/functions/ml-connect-store/index.ts`
- **Editar**: `src/pages/Configuracoes.tsx` (apenas a função `saveManualToken`)

## Resultado esperado
- "Failed to fetch" desaparece.
- Usuário cola Seller ID + Access Token + Refresh Token de qualquer loja e ela é validada e salva.
- Várias lojas podem ser conectadas e aparecem separadas na listagem, cada uma com sync/refresh independentes.

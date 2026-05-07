## Objetivo

Criar uma página dedicada de **Setup de Lojas** onde o usuário define quantas lojas tem e conecta cada uma via OAuth com logout forçado do Mercado Livre entre conexões. Isso evita o problema atual em que reconectar pelo OAuth pega a sessão já logada e acaba salvando a mesma conta com nome diferente — e elimina a necessidade do connect manual (que gerou o erro da Madama com seller_id e token inválidos).

## Fluxo do usuário

1. Usuário acessa **/setup-lojas** (link a partir de Configurações).
2. Define quantas lojas vai conectar (input numérico) e dá nomes a elas (ex: "Madama", "Valora").
3. Para cada loja aparece um card com botão **"Conectar Loja {nome}"**:
   - Status inicial: "Não conectada"
   - Ao clicar: redireciona para `https://www.mercadolivre.com.br/jms/mlb/lgz/logout?go={auth_url_encoded}` — isso desloga a sessão atual do ML e em seguida joga no fluxo OAuth
   - `auth_url` é o endpoint padrão `https://auth.mercadolivre.com.br/authorization?...` com PKCE
   - Volta ao callback existente (`/auth/ml-callback`), salva os tokens via `ml-oauth-callback`
   - Card atualiza para **"Conectada ✓"** mostrando seller_id e nickname
4. Quando todas estão conectadas, botão **"Concluir setup"** leva para Configurações.

## Mudanças no código

### Novo: `src/pages/SetupLojas.tsx`
- Estado local: `stores: Array<{ name: string; status: 'idle'|'connecting'|'connected'; seller_id?; nickname? }>`
- Carrega lojas existentes do banco no mount para já marcar conectadas
- Botão por card aciona helper `startOAuth(storeName)`:
  - Gera PKCE (`code_verifier`/`code_challenge`)
  - Salva em `sessionStorage`: `ml_pkce_verifier`, `ml_store_name`, `ml_redirect_uri` (igual ao fluxo atual)
  - Busca `client_id` via `ml-public-config`
  - Constrói `authUrl = https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=...&redirect_uri=...&code_challenge=...&code_challenge_method=S256`
  - Faz `window.location.href = https://www.mercadolivre.com.br/jms/mlb/lgz/logout?go=${encodeURIComponent(authUrl)}`
- Após retorno (detecta via reload + checagem do banco), atualiza card para "Conectada ✓"

### Editar: `src/App.tsx`
Adicionar rota `<Route path="/setup-lojas" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>` com nested `<Route index element={<SetupLojas />} />`, ou simplesmente registrar `/setup-lojas` dentro do bloco do AppLayout.

### Editar: `src/pages/Configuracoes.tsx`
- **Remover** o diálogo de connect manual (Seller ID + Access Token + Refresh Token) — fonte do bug da Madama.
- Substituir o botão "Conectar Loja" por um link **"Setup de Lojas"** que leva para `/setup-lojas`.
- Manter listagem, sincronizar, refresh-token e remover loja.

### Editar: `supabase/functions/ml-oauth-callback/index.ts`
Endurecer validação:
- Após o token exchange, **exigir** que `meResp` (chamada `/users/me`) retorne 200. Se falhar, **não salvar** e retornar erro claro: "Não foi possível validar o token OAuth (HTTP X). Verifique se a aplicação no Dev Center tem escopos `read offline_access`."
- Validar que `tokenJson.access_token` começa com `APP_USR-` e tem comprimento > 50.
- Validar que `seller_id` é numérico e tem entre 6 e 12 dígitos.

### Deletar: `supabase/functions/ml-connect-store/index.ts`
Não é mais usado — connect agora é exclusivamente OAuth.

## Limpeza dos dados ruins
A loja **Madama** atual (`ml_seller_id=471508824365378`, token de 32 chars) está corrompida. Na nova página de setup, instruir o usuário a remover essa loja (ou a próxima sync vai continuar dando 0). Posso também limpar via tool de update se você preferir — confirme.

## O que NÃO está no escopo
- Não vamos mexer em `ml-sync-orders` (a lógica está correta; o bug atual é só dados ruins).
- Não vamos mudar `MLCallback.tsx` — ele já cobre o caso de conta duplicada.

Confirma que posso implementar?

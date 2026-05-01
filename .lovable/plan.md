## Problema

O Mercado Livre não tem um parâmetro tipo `prompt=select_account` (Google) no fluxo OAuth. Ele simplesmente reaproveita a sessão do navegador: se você já está logado na Loja 1, o "Autorizar" devolve um token da Loja 1 — independentemente de qual loja você queira conectar. Por isso clicar em "Continuar para o Mercado Livre" sempre acaba conectando a mesma loja.

## Solução

Forçar o logout da sessão atual do Mercado Livre antes de redirecionar para a tela de autorização. Assim o ML pede login novamente e o usuário escolhe em qual conta entrar (Valora ou Madama).

### Fluxo novo

```text
1. Usuário clica "Conectar Loja"
2. Diálogo mostra:
   - Campo "Nome da loja"
   - Aviso explicando que será deslogado do ML e precisará entrar com a conta da loja desejada
   - Checkbox "Já estou logado na conta correta do Mercado Livre" (pula o logout)
3. Clica "Continuar"
4. Se checkbox NÃO marcado → abre https://www.mercadolivre.com.br/jms/mlb/lgz/logout?go=<URL_AUTH_ML> 
   numa nova aba (ou mesma aba). O ML desloga e redireciona para a tela de login/autorização.
5. Usuário entra com a conta correta e autoriza.
6. Callback grava a nova loja (upsert por user_id + ml_seller_id).
```

### Proteção extra contra duplicidade

No `MLCallback.tsx`, depois de receber o `seller_id` da resposta, comparar com as lojas já cadastradas. Se o seller_id retornado for igual ao de uma loja já existente **com nome diferente** do que o usuário acabou de digitar, mostrar aviso: *"Você autorizou a mesma conta ML que já está conectada como 'Loja X'. Faça logout do Mercado Livre e tente novamente com a outra conta."* — e não sobrescrever silenciosamente.

## Mudanças técnicas

**`src/pages/Configuracoes.tsx`**
- Adicionar texto explicativo no `DialogContent` sobre a necessidade de estar logado na conta correta do ML.
- Adicionar `Checkbox` "Já estou logado na conta correta do Mercado Livre no navegador".
- Em `startOAuth()`:
  - Construir a URL de autorização ML como hoje.
  - Se checkbox **desmarcado**: redirecionar para  
    `https://www.mercadolivre.com.br/jms/mlb/lgz/logout?go=<encodeURIComponent(authUrl)>`
  - Se **marcado**: redirecionar direto para `authUrl` (comportamento atual).

**`src/pages/MLCallback.tsx`**
- Antes de chamar `ml-oauth-callback`, buscar `stores` existentes (seller_ids).
- Após o callback retornar `seller_id`, se ele já pertencia a uma loja com **nome diferente** do `ml_store_name` em sessionStorage, exibir mensagem de erro clara orientando refazer com logout, e **não** considerar como sucesso visual (a função já fez upsert; opcionalmente reverter o nome para o anterior — fora de escopo, apenas avisar).

**Backend**: nenhum alteração necessária. O `ml-oauth-callback` já faz upsert por `(user_id, ml_seller_id)` corretamente.

## Fora de escopo

- Inserção manual de tokens (descartada).
- Popup/janela anônima (não confiável entre navegadores).

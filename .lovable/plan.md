## Diagnóstico

A segunda loja está difícil porque o botão atual não força uma nova sessão do Mercado Livre: ele abre direto `https://auth.mercadolivre.com.br/authorization`. Com isso, o Mercado Livre reaproveita a conta já logada da primeira loja ou cai numa página intermediária de autenticação (`auth.mercadolivre.com.br`) que pode ser recusada pelo navegador.

Também há um problema de UX: depois de conectar, o callback manda o usuário para `/configuracoes`, interrompendo o setup sequencial.

## Plano de correção

1. **Restaurar o fluxo com logout forçado antes do OAuth**
   - Em `src/pages/SetupLojas.tsx`, voltar a redirecionar para:
     ```text
     https://www.mercadolivre.com.br/jms/mlb/lgz/msl/logout?go={auth_url_encoded}
     ```
   - Isso força a troca de conta antes da autorização da segunda loja.

2. **Usar o domínio correto do OAuth para o Brasil**
   - Ajustar a URL de autorização para o endpoint brasileiro esperado pelo Mercado Livre, evitando a navegação direta problemática para `auth.mercadolivre.com.br` quando necessário.
   - Manter os parâmetros atuais: `response_type=code`, `client_id`, `redirect_uri`, `code_challenge` e `code_challenge_method=S256`.

3. **Adicionar um identificador de setup ao state/sessionStorage**
   - Incluir no fluxo um marcador dizendo que o OAuth veio da página `/setup-lojas`.
   - Isso permite retornar para a tela de setup após conectar uma loja, em vez de ir para `/configuracoes`.

4. **Corrigir o retorno pós-callback**
   - Em `src/pages/MLCallback.tsx`, quando o fluxo vier do setup, redirecionar de volta para `/setup-lojas`.
   - Manter `/configuracoes` para conexões iniciadas fora do setup.

5. **Melhorar a mensagem da tela**
   - Trocar a instrução manual de “abra outra aba e faça logout” por uma indicação clara de que o sistema vai desconectar a sessão atual do Mercado Livre automaticamente antes de conectar a próxima loja.

## Resultado esperado

O usuário consegue conectar Loja 1, voltar para o setup, clicar em Loja 2, ser deslogado do Mercado Livre automaticamente, escolher a segunda conta, autorizar e ver o status `Conectada ✓` na sequência.
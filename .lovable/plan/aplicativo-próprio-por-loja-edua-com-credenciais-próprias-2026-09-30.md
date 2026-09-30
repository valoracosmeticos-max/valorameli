# Aplicativo próprio por loja (EDUA com credenciais próprias)

## Objetivo
Cada loja poderá usar seu próprio aplicativo do Mercado Livre. A Valora continua no app atual; a EDUA passa a usar o app dela (Client ID 8230432257051773), com renovação automática do token.

## O que muda para você
- Em **Setup de Lojas**, o formulário "Inserir tokens manualmente" ganha dois campos opcionais: **Client ID** e **Client Secret** do app da loja.
- A EDUA será reconectada agora com os dados enviados, e a sincronização volta a funcionar sozinha.
- O Client Secret fica guardado só no servidor; nunca aparece na tela.

## Etapas
1. Banco: adicionar à tabela de lojas `ml_client_id` e `ml_client_secret` (o secret sem permissão de leitura pelo navegador, igual aos tokens).
2. Funções de servidor passam a usar as credenciais da loja quando existirem, senão as globais:
   - `ml-refresh-token`, `ml-sync-orders`, `mp-sync-payments` (onde renovam token)
   - `ml-manual-connect`: aceita `client_id`/`client_secret`, troca o refresh token com eles, valida `/users/me` e o Seller ID, e salva tudo; a checagem de "aplicativo diferente" compara com o app da loja.
3. Tela `SetupLojas.tsx`: campos opcionais Client ID/Secret no formulário manual.
4. Deploy das funções e conexão da EDUA (Seller 3576089161) chamando `ml-manual-connect` com o refresh token TG-… enviado; em seguida disparar uma sincronização e conferir pedidos.

## Observações
- O refresh token do ML é de uso único: se ele já tiver sido usado, será preciso gerar outro no app da EDUA.
- Como o Client Secret foi colado no chat, recomendo gerar um novo no Dev Center depois e atualizar pelo formulário.

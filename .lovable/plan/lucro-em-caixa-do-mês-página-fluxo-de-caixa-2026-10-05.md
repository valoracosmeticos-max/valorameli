# Lucro em Caixa do Mês (página Fluxo de Caixa)

## O que você vai ver
Um novo bloco no topo da página Fluxo de Caixa, com um seletor de mês (padrão: mês atual):

- **Lucro que cai no mês**: soma do lucro de cada venda cuja liberação do dinheiro cai dentro do mês escolhido.
- **Já caiu**: parte desse lucro já liberada até hoje.
- **Ainda vai cair**: parte prevista para os próximos dias do mês.
- **Fica para o mês seguinte**: lucro de vendas já feitas, mas que só libera depois do fim do mês.

Abaixo, uma lista por dia de liberação (ex.: "31/10 — 3 pedidos — R$ 154,30"), e ao expandir, cada pedido: loja, data da venda, recebido, custo, lucro e data de liberação, marcada como "confirmada" (data do Mercado Pago) ou "estimada".

## Regra de cada pedido
Lucro do pedido = Recebido (já líquido de tarifa e frete) − Custo dos produtos.
Exemplo: R$ 399,23 − R$ 344,45 = R$ 54,78, conta no dia 31/10.

Data de liberação:
1. Se o Mercado Pago já informou a data, usa ela (confirmada).
2. Se não, estima pela regra da loja:
   - Valora: 8 dias após a entrega (sem entrega ainda: data da venda + prazo médio observado).
   - EDUA: 30 dias após a venda.

Pedidos cancelados/reembolsados ficam de fora. Publicidade e Custos Adicionais não entram por pedido; aparecem numa linha separada "Outras saídas do mês" para dar o valor final "Sobra para gastar".

## Detalhes técnicos
- Novo hook `useCashProfit(storeFilter, month)`: busca `orders` (amount_received, status, date_created, store_id, data de entrega se existir), `order_items` (quantity × cost_price) e `payments_releases` (vínculo por `order_db_id`, `money_release_date`, `money_release_status`).
- Antes de implementar, conferir se `orders` já guarda status/data de entrega; se não, adicionar coluna `delivered_at` e gravá-la no `ml-sync-orders` a partir do envio (`/shipments/{id}` status `delivered`), com backfill.
- Regra por loja em constante simples (Valora: entrega+8; EDUA: venda+30), fácil de mudar depois.
- Novo componente `LucroCaixaMes.tsx` inserido em `FluxoCaixa.tsx` acima dos indicadores; respeita o seletor de loja existente.
- Fuso BRT (UTC-3), igual ao Dashboard.

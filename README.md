# Publisher Radar — build 0.4.0 (multi-tenant + site + app)

Site publico (`/landing`) + app com login (`/login` → `/`). Cada publisher tem jogos, historico, alertas, webhook e Steamworks key isolados. Trial de 7 dias, depois R$ 99/mes via Pix.

Alerta no Discord a cada 6h para publishers Steam: preco BRL, reviews, review-bomb, forecast de nota, auditoria da pagina e relatorio semanal.

## Rodar
```bash
npm install
npm run dev      # http://localhost:3020/landing (site) · /login (entrar) · / (painel)
ADMIN_KEY=piloto123 npm run dev   # chave para ativar Pro via POST /api/billing/activate
npm run worker   # coleta cron de todos os usuarios (a cada 6h)
```

## Contas e cobranca (piloto honesto)
- `POST /api/auth/register {email, pass}` cria conta trial 7 dias + 3 jogos demo; `POST /api/auth/login`; cookie HttpOnly.
- `GET /api/billing` mostra plano e dias restantes; `POST /api/billing/checkout` devolve a chave Pix (`5711321a-8781-4817-892d-17029e88ff1c`) + instrucao (sem cobranca automatica no piloto).
- Ativacao manual: `POST /api/billing/activate {email, adminKey}`.
- Wishlist real: `POST /api/steamworks {key}` (Web API Key do grupo financeiro). Sem key, `GET /api/wishlist/:appId` responde 501 honesto e o painel usa reviews como proxy.

## Configurar Discord (2 min)
1. No Discord: canal #alertas-steam → Editar canal → Integracoes → Webhooks → Copiar URL
2. No painel: colar em "Webhook Discord" → Salvar → Testar alerta. Ou `DISCORD_WEBHOOK_URL` no env.

## Adicionar jogos
- Campo AppID/URL no painel, ou lote: `POST /api/games/bulk {"text":"557040 https://store.steampowered.com/app/1903560"}`
- Piloto vem com: 99Vidas 557040 (QUByte), Atomic Picnic 1903560 (BitCake), Sportia 3897390 (Hermit Crab)

## O que o painel tem (e por que vende)
- KPIs: jogos/30, reviews somados, em promo, criticos 24h
- Card por jogo: capsule real, preco, velocity/dia, aprovacao com barra, grafico de reviews 30d + grafico de preco 30d, botoes Recheck/Remover/Auditoria/Forecast/Resposta
- Comparativo em tabela + CSV (`/api/export.csv`, separador ; para Excel BR)
- Linha do tempo com severidade CRITICO/ATENCAO/INFO + filtros
- Calendario: Next Fest Out/2026, Made in Brazil Sale, Winter Sale com contagem regressiva
- Metodologia aberta (fonte + regra de cada alerta)

## Endpoints
- `POST /api/games {appId|url, mine, label}` · `POST /api/games/bulk` · `DELETE /api/games/:appId`
- `GET /api/check/:appId` · `GET /api/history/:appId` · `GET /api/alerts`
- `GET /api/audit/:appId` → score 0-100 + issues (descricao curta, screenshots, trailer)
- `GET /api/forecast/:appId` → faixa Steam atual + quantas positivas faltam para a proxima
- `GET /api/reply/:appId` → 3 reviews recentes + rascunho PT/EN pronto para colar
- `GET /api/report.md` → relatorio semanal em Markdown
- `GET/POST /api/config/webhook` · `POST /api/discord/test` · `POST /api/worker`

## Comparativo (para vender contra)
| Ferramenta | Preco | Forte | Onde o Radar ganha |
|---|---|---|---|
| SteamDB | gratis | dado bruto exato | Radar alerta sozinho; ninguem abre SteamDB todo dia |
| Wishlist Engine | US$ 15/mes | velocity + audit + streamers | Radar em PT, review-bomb em minutos, Sale BR, rascunho de resposta |
| Gamalytic | US$ 25/mes | estimativa com metodologia | Radar foca operacao diaria do publisher, nao estimativa |
| Page Analyzer | US$ 29 unico / 97 audit | score capsule/descricao | Radar inclui audit lite + monitoramento continuo + Discord |
| Review Rescue | parte do suite | resposta IA + bomb alert | Radar junta isso ao portfolio de 30 jogos por R$ 99 |
| PlaytestCloud | 1.130/mes | painel de playtest AAA | Radar e operacao diaria barata, nao pesquisa |

## Limites honestos
- Wishlist privada exige chave financeira Steamworks do dono (campo pronto no piloto, sob demanda).
- Estimativa de unidades: faixa, nao numero exato — metodologia aberta no painel.

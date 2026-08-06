# Kimitube — Radar de Canais YouTube em Crescimento

Ferramenta local/pessoal para identificar canais do YouTube em crescimento, keywords/sub-nichos aquecendo, outliers do momento, espionar concorrentes, gerar metadados prontos para publicação (com IA Kimi) e alertar por e-mail sobre novos vídeos de concorrentes.

Stack: **Python 3.14 + FastAPI + SQLite + frontend HTML/JS simples** (sem build). Uso local, 1 usuário.

## Funcionalidades

- **Radar** — crescimento % em 30/90/150 dias, consistência (% de semanas com crescimento positivo), views ganhas/dia e radar score 0-100 (z-score contra pares do mesmo nicho/faixa de inscritos) dos canais monitorados.
- **Keywords** — velocidade média de views de vídeos recentes por termo (`search.list`, 1x/dia) + Google Trends (pytrends).
- **Spy** — estatísticas completas de qualquer canal (handle, URL ou ID): inscritos, frequência de postagem, melhor dia/horário, médias de views/likes/comments, engajamento, Shorts vs longos, top 10 vídeos, tags e padrões de título.
- **Outliers de vídeo** — view velocity nas primeiras 24-72h vs média do canal (`app/spy.py`).
- **Análise Shorts vs long-form por nicho** — agregação por nicho a partir dos vídeos coletados (`GET /api/radar/shorts-vs-long`).
- **Descoberta automática de canais similares** — por canal relacionado ou por keyword, com scoring de relevância (`POST /api/discover`, `POST /api/discover/auto`).
- **Comparação lado a lado de concorrentes** — até 4 canais simultâneos (subs, views, engajamento, % shorts, líder) (`POST /api/compare`).
- **Estimativa de receita por nicho** — views/dia × RPM configurável, agregado por nicho (`GET /api/radar/revenue-estimate`).
- **Export CSV/PDF de watchlists** (`GET /api/watchlist/export.csv` e `export.pdf`).
- **Metadados com IA** — baixa a capa em alta resolução e gera (via API Kimi/Moonshot) prompt de IA para recriar a capa, 5 títulos alternativos, descrição pronta e tags.
- **Alertas** — polling RSS a cada 30 min dos canais monitorados; vídeo novo → e-mail SMTP (se configurado).

## Setup

```bash
cd kimitube
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt   # Windows/Git Bash
# Linux/Mac: .venv/bin/python -m pip install -r requirements.txt

cp .env.example .env   # edite com suas chaves
```

### Variáveis do `.env`

- `YOUTUBE_API_KEY` — **obrigatória** para spy/radar/metadata.
- `MOONSHOT_API_KEY` — para o gerador de metadados (sem ela, `POST /api/metadata` retorna 503).
- `SMTP_*` + `ALERT_EMAIL_TO` — para alertas por e-mail (sem elas, o polling apenas registra os vídeos novos).

### Como obter a YouTube Data API key

1. Acesse <https://console.cloud.google.com/> e crie um projeto.
2. Em **APIs e Serviços → Biblioteca**, ative a **YouTube Data API v3**.
3. Em **Credenciais**, crie uma **Chave de API** e cole no `.env`.

## Como rodar

```bash
.venv/Scripts/python.exe run.py
```

Dashboard em <http://127.0.0.1:8300> (docs da API em `/docs`). O scheduler sobe junto: coletor diário às 02:00, keywords às 03:00 e polling RSS a cada 30 min.

Testes:

```bash
.venv/Scripts/python.exe -m pytest -q
```

## Avisos importantes

- **Quota de 10.000 unidades/dia** da YouTube Data API: chamadas `list` custam 1 unidade; `search.list` custa **100**. O consumo do dia aparece no topo do dashboard (`GET /api/quota`). Limite-se a ~30 keywords ativas.
- **O radar precisa de tempo**: a API do YouTube não fornece histórico de crescimento — o Kimitube grava snapshots próprios 1x/dia. Crescimento, consistência e score ficam úteis após **dias/semanas** de coleta. Antes disso, os campos aparecem como `—`.
- O histórico de crescimento local só cobre o período desde a instalação.

## Roadmap (ideias futuras)

- Padrões de título/thumbnail dos vídeos outliers
- Melhor dia/horário de postagem agregado por nicho (hoje só por canal individual)
- Word cloud de tags/títulos do nicho aquecido

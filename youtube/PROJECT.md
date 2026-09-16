# SaveTube — Memória do Projeto

> Última atualização: 2026-09-16
> Local: `D:\kimicode\youtube`

## Visão geral

SaveTube é um SaaS para download de vídeos do YouTube. O modelo de monetização é baseado em **doações e créditos**: o usuário pode baixar vídeos gratuitos com limitações ou comprar créditos para downloads em alta resolução.

## Stack tecnológica

- **Frontend:** React 19 + TypeScript + Vite 8
- **Backend:** Express 5 + TypeScript (`tsx watch`)
- **Worker de download:** Python + `yt-dlp` + `ffmpeg`
- **Autenticação:** e-mail com código de 6 dígitos (sessão por token, `nodemailer` opcional)
- **Bot WhatsApp:** `@whiskeysockets/baileys` **6.7.24** (versão estável `legacy` — NÃO usar a 7.x rc14, causa quedas de conexão)
- **QR Code:** `qrcode` (página de pareamento do WhatsApp)
- **Armazenamento:** arquivos JSON em `data/` (vouchers, uso, configurações, carteiras, usuários, sessões)
- **Portas de desenvolvimento:**
  - Frontend: `http://127.0.0.1:5180`
  - Backend: `http://127.0.0.1:8787`
  - *(As portas 5173–5175 costumam ficar travadas por processos órfãos do Vite.)*

## Estrutura de pastas importantes

```
youtube/
├── src/
│   ├── App.tsx              # Interface principal (com login por e-mail)
│   ├── Admin.tsx            # Painel administrativo
│   ├── i18n/                # Internacionalização (PT/EN/ES)
│   ├── server/
│   │   ├── index.ts         # API Express (auth, créditos, admin, QR page)
│   │   ├── auth.ts          # Autenticação por e-mail (código + sessão)
│   │   ├── credits.ts       # Vouchers, uso, config e carteiras (wallets)
│   │   └── whatsapp.ts      # Bot WhatsApp (Baileys) + comandos admin
│   └── index.css            # Estilos
├── python/
│   ├── worker.py            # Worker yt-dlp (inspect/download, força MP4)
│   ├── requirements.txt     # Dependências Python
│   └── youtube_auth.py      # Automação de cookies do YouTube (opcional)
├── data/
│   ├── vouchers.json        # Vouchers gerados/resgatados
│   ├── usage.json           # Controle de downloads por IP
│   ├── config.json          # Configurações de doação/pagamento
│   ├── wallets.json         # Saldo de créditos por e-mail (servidor)
│   ├── users.json           # Usuários autenticados
│   ├── sessions.json        # Tokens de sessão de login
│   └── pending_codes.json   # Códigos de acesso por e-mail pendentes
├── storage/
│   ├── downloads/           # Arquivos baixados
│   └── whatsapp-auth/       # Sessão do bot WhatsApp (Baileys)
├── dist/                    # Build de produção
├── cookies.txt              # Cookies do YouTube (opcional)
└── .env                     # Variáveis de ambiente
```

## Funcionalidades implementadas

### Downloads
- **Análise de link:** extrai metadados e formatos disponíveis do YouTube.
- **Download grátis:** até `720p` e áudio MP3, limitado a **3 por dia por IP**.
- **Download pago/crédito:** resoluções acima de 720p consomem **1 crédito** por download (validado no servidor).
- **Formato padrão "Melhor qualidade" agora sai em MP4:** seletor `bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best` + `merge_output_format: 'mp4'` no worker.
- **Detecção de livestream:** bloqueia download de transmissões ao vivo.
- **Botão Cancelar:** visível no painel de progresso; encerra o EventSource, chama `DELETE /api/media/jobs/:id` (mata Python + ffmpeg via `taskkill /T /F`) e, em downloads pagos ainda não concluídos, **devolve o crédito** automaticamente.
- **Erros de rede amigáveis:** `Failed to fetch`/`NetworkError`/respostas HTML viram mensagens traduzidas (`errors.network`/`errors.serverUnavailable`) em pt/en/es.

### Autenticação por e-mail (com confirmação)
- Fluxo: usuário informa e-mail → recebe código de 6 dígitos → confirma → ganha token de sessão (30 dias).
- Sem SMTP configurado (modo dev), o código aparece **na própria tela** e no console do backend.
- Com SMTP configurado (`.env`), o código é enviado por e-mail via `nodemailer`.
- Rotas: `POST /api/auth/request-code`, `POST /api/auth/verify-code`, `GET /api/auth/me`, `POST /api/auth/logout`.
- O saldo de créditos agora é **por e-mail** no servidor (`data/wallets.json`), não mais `localStorage`.

### Créditos e vouchers
- Vouchers no formato `STB-XXXX-XXXX-XXXX` (gerados no admin ou pelo bot do WhatsApp).
- Resgate exige login: `POST /api/credits/redeem` (Bearer token) → adiciona créditos à carteira do e-mail.
- `GET /api/credits/balance` retorna o saldo do usuário autenticado.
- Download pago: `POST /api/media/jobs/server` (Bearer token) → debita 1 crédito; retorna `402` se saldo insuficiente.

### Bot do WhatsApp (Baileys)
- Ativado por `WHATSAPP_ENABLED=true` no `.env`.
- **Pareamento por QR Code** (recomendado): página **`http://127.0.0.1:8787/whatsapp-qr`** (senha admin `admin`). QR atualiza a cada 5s.
- Também suporta código de pareamento se `WHATSAPP_PAIRING_NUMBER` estiver preenchido.
- Comandos do admin (número `WHATSAPP_ADMIN_NUMBER`):
  - `!help` — lista de comandos
  - `!voucher <créditos> [quantidade]` — gera vouchers
  - `!aprovar <numero> <créditos>` — aprova comprovante e envia voucher ao cliente
  - `!status` — status do bot
- Cliente envia comprovante → bot responde automaticamente e encaminha a mensagem ao admin.
- Endpoints admin: `GET /api/admin/whatsapp/status`, `POST /api/admin/whatsapp/pair`, `GET /api/admin/whatsapp/qr`.

### Internacionalização (i18n)
- Idiomas: **Português (pt-BR)**, **Inglês (en)** e **Espanhol (es)**.
- Moeda e métodos de pagamento variam por região (Brasil: BRL/Pix/PayPal/crypto; global: USD/PayPal/crypto).

### Pagamentos / Doações
- **Pix:** QR Code e copia-e-cola (Brasil).
- **PayPal:** links `paypal.me` e NCP. **Não há recarga automática** — o fluxo é manual (comprovante → admin aprova → voucher).
- **Criptomoedas:** QR Code e endereços configurados.
- **WhatsApp:** usado para envio do comprovante e, agora, para o bot de aprovação.

### Painel administrativo
- Login com senha (`ADMIN_PASSWORD` no `.env`, padrão `admin`).
- Geração de vouchers, configuração de doações/preço, status dos cookies do YouTube e status do bot WhatsApp.

## Modelo comercial

- **Grátis:** até 720p/MP3, 3 downloads por dia.
- **Créditos:** R$ 1,30 por crédito no Brasil / US$ 0,23 global (configurável via admin).
- **Doações:** via Pix/PayPal/crypto para manter o serviço.
- **Vouchers:** gerados manualmente pelo admin (painel ou bot WhatsApp) após confirmação do pagamento.

## Configurações importantes (.env)

```env
PORT=8787
PYTHON_BIN=python
ADMIN_PASSWORD=admin
FREE_DAILY_LIMIT=3
YOUTUBE_EMAIL=           # opcional, para automação de cookies
YOUTUBE_PASSWORD=        # opcional, para automação de cookies

# WhatsApp bot (Baileys)
WHATSAPP_ENABLED=true
WHATSAPP_ADMIN_NUMBER=5585981157837
WHATSAPP_PAIRING_NUMBER=   # vazio = pareamento por QR Code (recomendado)

# E-mail (SMTP) — se vazio, o código é exibido no console/API em modo dev
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
```

## Como rodar

```bash
cd D:/kimicode/youtube
npm install
python -m pip install -r python/requirements.txt
npm run dev
```

Acesse:
- Aplicação: `http://127.0.0.1:5180/`
- Painel admin: `http://127.0.0.1:5180/admin` (senha padrão `admin`)
- QR Code do bot: `http://127.0.0.1:8787/whatsapp-qr` (senha `admin`)

### Limpando portas travadas (Windows)

Se as portas 5173–5175, 5180, 5181 ou 8787 estiverem ocupadas:

```powershell
Get-WmiObject Win32_Process | Where-Object { $_.CommandLine -like '*youtube*' -and $_.Name -eq 'node.exe' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

## Deploy na VPS (produção)

- **URL principal:** **`https://savetube.com.br`** (domínio próprio, HTTPS Let's Encrypt). `www.savetube.com.br` e `savetube.jamrange.com` fazem **301** para o domínio principal.
- **Pasta:** `/opt/savetube` (separada da aplicação existente `/opt/poker-mtt` — NÃO MEXER).
- **Serviço:** `systemd` (`savetube.service`, restart automático, inicia com o boot). Roda `tsx src/server/index.ts`.
- **Stack:** Node 22 LTS + ffmpeg 6 (apt) + Python 3.12 + yt-dlp (pip).
- **Admin:** senha gerada no deploy (ver `MEMORY.md` seção 9 ou `/opt/savetube/.env`).
- **Bot WhatsApp:** **conectado na VPS** (nº `5516920057006`); pareamento/QR: `https://savetube.com.br/whatsapp-qr` (senha admin).
- **Caddy (container `poker-mtt-caddy-1`):** blocos para `savetube.com.br` (`reverse_proxy 172.18.0.1:8787`) + `www`/`jamrange` (redirect 301). Backups em `/opt/poker-mtt/Caddyfile.bak-*`.
  - ⚠️ O Caddyfile é bind-mount de **arquivo único**; se o arquivo for recriado, é preciso **`docker restart poker-mtt-caddy-1`** (reload não basta).
- **SEO:** canonical/OG/JSON-LD, `sitemap.xml`, `robots.txt` e páginas PT/EN/ES apontando para `savetube.com.br`.
- **SSH:** `ssh -i ~/.ssh/savetube_vps_key root@144.91.118.214`
- **Logs:** `journalctl -u savetube -f`

Para atualizar o código na VPS, veja o passo a passo na `MEMORY.md` (seção 9).

## Decisões de design recentes

- **Créditos no servidor:** carteira por e-mail em `data/wallets.json`; o frontend usa token de sessão (`st_token`/`st_email` no `localStorage`).
- **MP4 por padrão:** o seletor "Melhor qualidade" prefere MP4/M4A (até 1080p; o YouTube só oferece 4K em WebM).
- **Bot WhatsApp:** conexão única por socket, reconexão automática, pareamento via QR (mais estável que código nesta rede).
- **Interface estilo YouTube** com progresso detalhado, scroll automático e erros amigáveis.
- **Cancelamento robusto:** mata o processo Python e filhos (incluindo ffmpeg).

## Limitações conhecidas

- Vídeos com **restrição de idade/logado**, **privados**, **removidos** ou **transmissões ao vivo** não são suportados. Os vídeos que apenas exigem login ("Sign in to confirm you're not a bot") **funcionam** graças aos cookies de uma **conta dedicada do YouTube** (`botsavetube@gmail.com`), atualizados automaticamente todos os dias (ver `MEMORY.md` seção 9). O **PO Token (BgUtils)** está instalado na VPS como complemento.
- Controle de limite grátis é por IP — fácil de contornar com VPN/4G (aceitável para MVP).
- Pagamento (Pix/PayPal/crypto) **não recarrega créditos automaticamente** — depende de confirmação manual e voucher.
- Sessão de login fica no `localStorage`; se o usuário limpar o navegador, perde o vínculo com a carteira (o saldo fica órfão no servidor).
- **Baileys:** usar versão `6.7.24`. A `7.0.0-rc14` derruba a conexão do WhatsApp a cada poucos segundos durante o pareamento.
- A rede/IP local já sofreu bloqueio temporário do WhatsApp por excesso de tentativas de pareamento; se o bot desconectar (loggedOut), limpe `storage/whatsapp-auth/` e pareie novamente pelo QR.

## Próximos passos sugeridos

- [x] Adicionar botão de "Cancelar download" visível no frontend.
- [x] Melhorar tratamento de erros de rede no frontend (`Failed to fetch`).
- [x] Deploy em VPS/cloud (subpasta `/opt/savetube`, systemd, porta 8787).
- [x] **Solução dos cookies do YouTube**: conta dedicada + atualização automática diária (backup → upload → validação → rollback).
- [x] **Domínio próprio `savetube.com.br`** com HTTPS, redirects 301 e SEO migrado.
- [x] **PO Token (BgUtils)** instalado na VPS (complementar aos cookies).
- [ ] Criar propriedade `savetube.com.br` no Google Search Console e reenviar o sitemap.
- [ ] Integrar gateway de pagamento automatizado (Stripe, Mercado Pago, Asaas) com webhook para recarga automática.
- [ ] Login por link mágico/Google (hoje é código por e-mail).
- [ ] Migrar dados JSON para banco real (SQLite/Postgres) quando houver múltiplos usuários.
- [ ] Avaliar **proxy residencial** se o volume crescer (evita bloqueios de IP de datacenter a longo prazo).

## Contato / Suporte

O canal de suporte configurado é o WhatsApp no modal de pagamento, no painel admin e no bot (`data/config.json`).

# MEMORY.md — Memória da Sessão (para retomada)

> Criado em: 2026-09-13
> Última retomada: 2026-09-16
> Projeto: SaveTube — `D:\kimicode\youtube`
> Objetivo deste arquivo: permitir retomar a sessão de desenvolvimento exatamente de onde parou.

---

## 1. Estado atual (última verificação: 2026-09-16)

- **PRODUÇÃO:** **`https://savetube.com.br`** (domínio principal, HTTPS Let's Encrypt) — servido pela VPS `144.91.118.214` via Caddy → `172.18.0.1:8787`.
  - `www.savetube.com.br` → 301 para o apex; `savetube.jamrange.com` → 301 para `savetube.com.br` (ambos no Caddy).
  - Downloads funcionando (MP3/MP4), inclusive vídeos com "Sign in to confirm you're not a bot" (ver cookies na seção 9).
- **Servidor dev local (parcial):** frontend Vite rodando em `http://127.0.0.1:5180/` (200; PID `41860`). **O backend local (8787) está PARADO** — para retomar, ver seção 2.
- **Bot WhatsApp:** **CONECTADO na VPS** (`WHATSAPP_ENABLED=true`), não no local. Painel: `https://savetube.com.br/whatsapp-qr` (senha `e509cf97ac72`). Local `.env` com `WHATSAPP_ENABLED=false` para não duplicar respostas.
- **Aplicação:** login por e-mail, carteira de créditos, vouchers — funcionando em produção.
- **Últimas tarefas concluídas (2026-09-15/16):**
  1. **Solução definitiva dos cookies do YouTube** (conta dedicada + automação diária com backup/validação/rollback — seção 9).
  2. **PO Token (BgUtils)** instalado na VPS como complemento (seção 9).
  3. **Domínio próprio `savetube.com.br`** no ar + redirecionamentos 301 + SEO migrado.
  4. `worker.py` passou a usar cópia temporária dos cookies (evita corromper o `cookies.txt`).
  5. Caixa de cancelar download + tratamento de erros de rede (frontend).

### Processo em segundo plano
- Servidor dev local: PID `41860` (Vite em 5180). O backend (8787) caiu — **reiniciar com `npm run dev`**.
- Background anterior (memória): `bash-cd0decde-6a01-47f6-abae-eeb9fd1260d5` (PID 42036) — já morto.

---

## 2. Como reiniciar tudo (passo a passo)

```bash
# 1. Matar processos antigos (se houver)
cmd.exe /c "taskkill /PID <pid-raiz> /T /F"   # ou:
netstat -ano | findstr "5180 5181 8787"       # achar PIDs e matar com taskkill //PID x //T //F

# 2. Limpar sessão do WhatsApp (SÓ se o bot estiver desconectado/loggedOut)
rm -rf storage/whatsapp-auth

# 3. Subir o projeto
cd /d/kimicode/youtube
npm run dev
```

Depois:
- App: `http://127.0.0.1:5180/`
- Admin: `http://127.0.0.1:5180/admin` (senha `admin`)
- QR do bot: `http://127.0.0.1:8787/whatsapp-qr` (senha `admin`)

---

## 3. Credenciais e configuração

- **Admin:** senha `admin` (`.env` → `ADMIN_PASSWORD=admin`).
- **WhatsApp admin:** `5585981157837` (`.env` → `WHATSAPP_ADMIN_NUMBER`).
- **Modo dev de e-mail:** sem SMTP no `.env`, o código de acesso aparece na tela e no console (`[auth] código de acesso para ...`).
- **`.env` atual (resumo):**
  - `PORT=8787`, `PYTHON_BIN=python`, `ADMIN_PASSWORD=admin`, `FREE_DAILY_LIMIT=3`
  - `WHATSAPP_ENABLED=false` (bot local desabilitado — o bot de produção roda na VPS), `WHATSAPP_ADMIN_NUMBER=5585981157837`, `WHATSAPP_PAIRING_NUMBER=` (vazio → modo QR)
  - `SMTP_HOST/PORT/USER/PASS/FROM` vazios.

---

## 4. O que foi implementado nesta sessão

1. **Correção do download para MP4**
   - `python/worker.py`: `merge_output_format: 'mp4'`, seletor padrão `bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best`, e `find_final_file()` para retornar o caminho final correto.
   - `src/App.tsx`: opção "Melhor qualidade" usa `BEST_MP4`; `isFormatPaid` usa a altura real do formato (não o ID).

2. **Créditos no servidor (opção 3)**
   - `src/server/credits.ts`: carteiras em `data/wallets.json` (`getBalance`, `addCredits`, `consumeCredit`, `incrementPaidDownloads`).
   - `redeemVoucher` adiciona créditos à carteira e retorna saldo.

3. **Autenticação por e-mail com confirmação**
   - `src/server/auth.ts`: código de 6 dígitos (TTL 10 min, 5 tentativas), sessão por token (30 dias), `nodemailer` opcional.
   - Rotas: `/api/auth/request-code`, `/api/auth/verify-code`, `/api/auth/me`, `/api/auth/logout`.
   - Rotas de crédito e download pago agora exigem `Authorization: Bearer <token>` e usam o e-mail como chave da carteira.
   - Frontend: `AuthModal` (e-mail → código → token), header com login/logout, `st_token`/`st_email` no `localStorage`.

4. **Bot WhatsApp (Baileys)**
   - `src/server/whatsapp.ts`: conexão, reconexão automática, QR/pairing code, comandos de admin, auto-resposta e encaminhamento de comprovantes.
   - Comandos admin: `!help`, `!voucher <créditos> [qtd]`, `!aprovar <numero> <créditos>`, `!status`.
   - Página de QR: `/whatsapp-qr` + endpoints `/api/admin/whatsapp/status`, `/api/admin/whatsapp/pair`, `/api/admin/whatsapp/qr`.

5. **Documentação atualizada:** `PROJECT.md`, `README.md`, `MEMORY.md`.

6. **Cancelar download + erros de rede (2026-09-14)**
   - `src/App.tsx`: botão **Cancelar** no painel de progresso (fecha o EventSource e chama `DELETE /api/media/jobs/:id`); `friendlyError` mapeia `Failed to fetch`/`NetworkError`/HTML para mensagens traduzidas (`errors.network`/`errors.serverUnavailable`).
   - `src/server/index.ts`: cancelamento agora usa `taskkill /PID <pid> /T /F` (mata Python + ffmpeg); jobs guardam `mode`/`email`; **download pago cancelado devolve 1 crédito** (`addCredits`) se ainda não concluído.
   - `src/i18n/translations.ts`: novas chaves `controls.cancel/cancelling/statusCancelled` e `errors.network` (pt/en/es).
   - `src/index.css`: estilos `.progress-actions`/`.cancel-btn`.
   - Testado via API: job cancelado com sucesso; saldo 0 → 1 após cancelar download pago.

---

## 5. Decisões importantes e armadilhas (NÃO ESQUECER)

- **Baileys:** usar **`@whiskeysockets/baileys@6.7.24`** (dist-tag `legacy`). A versão `7.0.0-rc14` derruba a conexão a cada ~4s durante pareamento ("Connection Failure", status 401).
- **Pareamento:** o **QR Code** funcionou; os códigos de pareamento não funcionaram nesta rede. Se precisar parear de novo: `rm -rf storage/whatsapp-auth` e usar `/whatsapp-qr`.
- **A rede/IP local já foi bloqueada temporariamente pelo WhatsApp** por excesso de tentativas. Evite gerar códigos em loop. O bot agora gera **apenas um** código automático por inicialização.
- **Portas:** processos órfãos do Vite/node seguram 5180/5181/8787. Sempre verificar com `netstat -ano` antes de subir.
- **`tsx watch`** reinicia o backend quando arquivos em `src/server/*.ts` mudam; mudanças no `.env` exigem reiniciar o `npm run dev` manualmente.
- **Modo dev do e-mail:** sem SMTP, o código vem no JSON da API (`devCode`) e aparece no modal do frontend.
- **Créditos:** chave da carteira é o **e-mail normalizado (lowercase)**. Limpar `localStorage` do navegador desvincula o usuário da carteira.
- **Download pago:** o backend debita 1 crédito da carteira do e-mail autenticado antes de criar o job.

---

## 6. Comandos úteis

```bash
# Validar TypeScript
cd /d/kimicode/youtube && npm run lint

# Health
curl -s http://127.0.0.1:8787/api/health

# Status do bot
curl -s http://127.0.0.1:8787/api/admin/whatsapp/status -H "authorization: Bearer admin"

# Gerar novo código de pareamento (se estiver em modo código)
curl -s -X POST http://127.0.0.1:8787/api/admin/whatsapp/pair -H "authorization: Bearer admin"

# Achar processos nas portas
netstat -ano | rg "5180|5181|8787" | rg "LISTEN"
taskkill //PID <pid> //T //F
```

---

## 7. Pendências / próximos passos

- Usuário vai decidir próximos passos do bot (testar envio de comprovante, etc.).
- Pagamento **ainda não recarrega créditos automaticamente** (PayPal/Pix/crypto são manuais). Próximo passo natural: webhook de pagamento.
- Ativar bot WhatsApp na VPS (hoje `WHATSAPP_ENABLED=false` no `/opt/savetube/.env`) e parear via `/whatsapp-qr`.
- Melhorias: login por Google/magic link, banco de dados real, HTTPS/domínio próprio para o SaveTube (hoje roda em `http://IP:8787`).

---

## 8. Contato/contexto do usuário

- Usuário fala português (Brasil).
- Suporte/WhatsApp: `5585981157837` (admin).
- O usuário testa no navegador local (127.0.0.1).

---

## 9. Deploy na VPS (produção)

### Acesso
- **SSH (recomendado):** `ssh -i ~/.ssh/savetube_vps_key root@144.91.118.214` (chave privada em `C:\Users\welli\.ssh\savetube_vps_key`).
- **Console VNC:** `169.58.149.110:63227` senha `aiel0712` (tela TTY; o login da console não aceitou as senhas — usar SSH com chave).
- **VPS:** Ubuntu 24.04, hostname `vmi3558676`. Cuidado: a senha `XT8gs789Nijx` NÃO funciona — o acesso é só por chave SSH.

### Aplicação existente (NÃO MEXER)
- `/opt/poker-mtt` — app do usuário (jamrange.com), Docker Compose com Caddy (80/443) + frontend + backend.
- Containers: `poker-mtt-caddy-1`, `poker-mtt-frontend-1`, `poker-mtt-backend-1`.

### SaveTube (nosso)
- Pasta: `/opt/savetube` (subpasta separada, não interfere no poker-mtt).
- Serviço: `systemd` → `savetube.service` (habilita na inicialização, restart automático).
- URL: `http://144.91.118.214:8787/` (frontend buildado servido pelo próprio backend Express).
- Backend escuta `0.0.0.0:8787` (`HOST=0.0.0.0` no `.env`).
- **Admin (painel):** senha `e509cf97ac72` (gerada no deploy; alterar em `/opt/savetube/.env` → `ADMIN_PASSWORD`).
- Stack instalada na VPS: Node 22 LTS (NodeSource), npm, ffmpeg 6 (apt), Python 3.12 + pip + yt-dlp.
- WhatsApp bot: **CONECTADO na VPS** (`WHATSAPP_ENABLED=true`). Número do bot: `5516920057006` ("Pronto Rede Telemedicina"). Sessão em `/opt/savetube/storage/whatsapp-auth/`. Parear novamente: `https://savetube.jamrange.com/whatsapp-qr` (senha `e509cf97ac72`).
- Firewall: `ufw allow 8787/tcp` já liberado.
- **Domínio PRINCIPAL (produção): `https://savetube.com.br`** — registrado na **HostGator** (nameservers `ns1/ns2.disfocado.com.br`, DNS editado via cPanel → **Zone Editor**). Registros: `savetube.com.br.` A → `144.91.118.214` e `www` (wildcard/CNAME) → `144.91.118.214`. Certificado Let's Encrypt emitido em 2026-09-16.
- **Redirecionamentos (Caddy, 301):** `www.savetube.com.br` → `savetube.com.br` e `savetube.jamrange.com` → `savetube.com.br` (preserva o caminho). `jamrange.com` (app do usuário) **intocado**.
- ⚠️ **Atenção no Caddy/`poker-mtt`:** o `Caddyfile` é um bind-mount de **arquivo único** (`/opt/poker-mtt/Caddyfile` → `/etc/caddy/Caddyfile`). Se o arquivo for recriado (inode novo), o container continua vendo a versão antiga — nesse caso **`docker restart poker-mtt-caddy-1`** para reler (um `caddy reload` sozinho NÃO basta). Foi exatamente o que travou a ativação do `savetube.com.br` em 2026-09-16.
- **SEO:** já migrado para `savetube.com.br` (canonical, OG, JSON-LD, `sitemap.xml`, `robots.txt`, hreflang PT/EN/ES). **PENDENTE:** criar propriedade `savetube.com.br` no Google Search Console e reenviar o sitemap.
- **Painel admin / QR WhatsApp:** agora em `https://savetube.com.br/whatsapp-qr` (senha `e509cf97ac72`).

### Comandos úteis na VPS
```bash
ssh -i ~/.ssh/savetube_vps_key root@144.91.118.214

systemctl status savetube          # status do serviço
systemctl restart savetube         # reiniciar após mudar .env ou código
journalctl -u savetube -f          # logs em tempo real
tail -f /opt/savetube/.env         # conferir configurações
```

### Atualizar o código na VPS (deploy de mudanças)
```bash
# local: empacotar (sem node_modules/ffmpeg/storage) e enviar
cd /d/kimicode/youtube
tar -czf /tmp/savetube-src.tar.gz --exclude='node_modules' --exclude='dist' --exclude='ffmpeg' --exclude='storage' --exclude='.env' --exclude='*.tsbuildinfo' --exclude='vnc_screen*.png' .
scp -i ~/.ssh/savetube_vps_key /tmp/savetube-src.tar.gz root@144.91.118.214:/tmp/

# na VPS
cd /opt/savetube && tar -xzf /tmp/savetube-src.tar.gz -C /opt/savetube
npm ci --no-audit --no-fund && npm run build
systemctl restart savetube
```

### Ajuste no worker.py (importante para a VPS)
- `ffmpeg_location` agora é dinâmico: usa `ffmpeg/ffmpeg-build/bin` se existir; senão usa o ffmpeg do sistema no PATH.
- `js_runtimes` aponta para o Node do PATH (`{'node': {'path': node_path}}`) — o yt-dlp **exige Node ≥ 22**.
- `remote_components` habilita `ejs:github` — **necessário** para o YouTube resolver os desafios JS (sem isso, todos os vídeos caem no erro de "restrição/login").
- **Cookies do YouTube na VPS (SOLUÇÃO DEFINITIVA):** `/opt/savetube/cookies.txt` (Netscape). Necessários para vídeos que dão *"Sign in to confirm you're not a bot"* (IP de datacenter).
  - **Conta dedicada:** `botsavetube@gmail.com`, logada **apenas** no perfil do Firefox `votr557y.savetube-bot` (criado em 2026-09-15). Como essa conta **não é usada em nenhum outro navegador**, os cookies **não rotacionam** por uso — isso é o que torna a solução estável.
  - **Automação:** todos os dias às **09:00** (tarefa `SaveTubeAtualizarCookies`, `StartWhenAvailable`), o script `D:\kimicode\youtube\atualizar_cookies_vps.bat`:
    1. Exporta os cookies do perfil `savetube-bot`;
    2. Confere `LOGIN_INFO`;
    3. Faz **backup** do `cookies.txt` atual na VPS;
    4. Envia os novos via `scp`;
    5. Roda `/opt/savetube/validate_cookies.py` na VPS (extrai um vídeo de teste com as opções do worker);
    6. Se a validação falhar, **restaura o backup** automaticamente (nunca deixa a VPS sem cookies funcionais).
  - Log: `D:\kimicode\youtube\atualizar_cookies.log`. Atalho manual na área de trabalho: **"Atualizar Cookies SaveTube"**.
  - ⚠️ **NUNCA abrir o perfil `savetube-bot` para assistir YouTube** — usá-lo rotaciona os cookies do bot. Ele serve só para o login/manutenção.
  - ⚠️ A tarefa roda **no PC do usuário** — o computador precisa estar ligado em algum momento do dia.
  - ⚠️ **Po Token (bgutil):** servidor Docker `bgutil-provider` (imagem `brainicism/bgutil-ytdlp-pot-provider`, porta 127.0.0.1:4416) + plugin pip `bgutil-ytdlp-pot-provider` instalados na VPS. Ficam ativos para quando o yt-dlp precisar de PO Token (política `fetch_pot=auto`). **Descoberta importante:** PO Token **não substitui cookies** — vídeos com `LOGIN_REQUIRED` exigem login; PO Token é complementar. NÃO reinstalar `yt-dlp-get-pot` (framework antigo) junto com `bgutil-ytdlp-pot-provider` (novo) — eles conflitam.
  - ⚠️ O `worker.py` copia os cookies para um arquivo temporário por job (o yt-dlp reescreve o cookie jar e corrompia o original, perdendo o `LOGIN_INFO`). **Não reverter isso.**

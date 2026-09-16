# SaveTube (Local Media Lab)

Interface web local para baixar vídeos do YouTube, com créditos, vouchers, autenticação por e-mail e bot de WhatsApp.

## Instalação

```powershell
npm install
python -m pip install -r python/requirements.txt
```

FFmpeg é necessário para combinar formatos separados e converter áudio (já incluído em `ffmpeg/ffmpeg-build/bin`).

## Execução

```powershell
npm run dev
```

Acesse:
- **Aplicação:** http://127.0.0.1:5180/
- **Painel admin:** http://127.0.0.1:5180/admin (senha padrão: `admin`)
- **QR Code do bot WhatsApp:** http://127.0.0.1:8787/whatsapp-qr (senha: `admin`)

O backend escuta apenas em `127.0.0.1:8787`. A UI envia inspeções para o backend, que cria um processo Python por tarefa e retransmite progresso por SSE.

## Funcionalidades principais

- Download grátis até 720p/MP3 (3 por dia por IP) e pago acima de 720p (1 crédito).
- Formato "Melhor qualidade" sai em **MP4**.
- **Login por e-mail** com código de confirmação (sem SMTP configurado, o código aparece na tela em modo dev).
- Créditos salvos **no servidor** (`data/wallets.json`) vinculados ao e-mail.
- **Bot WhatsApp** (Baileys) para receber comprovantes e aprovar/enviar vouchers.

Veja `PROJECT.md` e `MEMORY.md` para documentação completa e estado da sessão.

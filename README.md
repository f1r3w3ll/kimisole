# kimiSole — Console para Kimi Code

Ambiente configurado conforme o quickstart oficial:
https://platform.kimi.ai/docs/guide/kimi-k2-7-code-quickstart

## O que ja foi instalado

- Ambiente virtual Python em `.venv/` (Python 3.14)
- SDK `openai` (>= 1.0, instalado: 2.48.0) — a API do Kimi e compativel com o SDK OpenAI
- `python-dotenv` para carregar o `.env`

## Passo unico pendente: sua API key

1. Acesse https://platform.kimi.ai/console/api-keys e gere uma chave.
2. Copie `.env.example` para `.env`:
   ```powershell
   copy .env.example .env
   ```
3. Edite `.env` e cole sua chave em `MOONSHOT_API_KEY=`.

## Como usar

Ative o ambiente virtual:

```powershell
# PowerShell
.venv\Scripts\Activate.ps1

# CMD
.venv\Scripts\activate.bat
```

Teste basico de chat:

```powershell
python quickstart.py "Escreva um endpoint FastAPI de healthcheck"
```

Agent loop com tool calling (o modelo pode ler arquivos, listar diretorios e executar Python):

```powershell
python agent_loop.py "Analise o quickstart.py e sugira melhorias"
```

Servidor Web UI:

```powershell
.venv\Scripts\python.exe app.py
# ou
iniciar.bat
```

Acesse `http://127.0.0.1:8765` no navegador.

## Configuracao (via .env)

| Variavel            | Padrao                          | Descricao                        |
|---------------------|---------------------------------|----------------------------------|
| `MOONSHOT_API_KEY`  | (obrigatoria)                   | Chave da plataforma Kimi         |
| `MOONSHOT_BASE_URL` | `https://api.moonshot.ai/v1`    | Endpoint oficial da API          |
| `KIMI_MODEL`        | `kimi-k2.7-code`                | Modelo (ver alternativas abaixo) |

Modelos disponiveis: `kimi-k2.7-code`, `kimi-k2.7-code-highspeed`, `kimi-k2.6`, `kimi-k2.5`.

Parametros recomendados pelo quickstart (ja aplicados nos scripts):
`thinking: enabled`, `temperature: 1.0`, `top_p: 0.95`, `max_tokens: 32768`.

## Observacoes

- O exemplo oficial da documentacao inclui uma tool de video (`watch_video_clip`)
  que exige `ffmpeg`/`ffprobe`. Eles **nao** estao instalados nesta maquina e so
  sao necessarios para esse exemplo especifico de video — os scripts deste
  projeto nao dependem deles. Se quiser: `winget install Gyan.FFmpeg`.
- O arquivo `.env` esta no `.gitignore` — sua chave nao vai para o git.

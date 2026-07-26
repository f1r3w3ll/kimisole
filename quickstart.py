"""
Kimi Code — Quickstart basico (kimi-k2.7-code)
Docs: https://platform.kimi.ai/docs/guide/kimi-k2-7-code-quickstart

Teste minimo de conectividade e chat com o modelo kimi-k2.7-code.
Requer MOONSHOT_API_KEY definida no .env ou no ambiente.
"""

import os
import sys

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

API_KEY = os.environ.get("MOONSHOT_API_KEY")
BASE_URL = os.environ.get("MOONSHOT_BASE_URL", "https://api.moonshot.ai/v1")
MODEL = os.environ.get("KIMI_MODEL", "kimi-k2.7-code")

if not API_KEY or API_KEY == "sua_chave_aqui":
    sys.exit(
        "ERRO: defina MOONSHOT_API_KEY no arquivo .env\n"
        "Obtenha sua chave em: https://platform.kimi.ai/console/api-keys"
    )

client = OpenAI(api_key=API_KEY, base_url=BASE_URL)


def main() -> None:
    prompt = (
        sys.argv[1]
        if len(sys.argv) > 1
        else "Escreva uma funcao Python que valide um CPF brasileiro."
    )

    print(f"Modelo: {MODEL}")
    print(f"Prompt: {prompt}\n" + "-" * 60)

    # Parametros recomendados pelo quickstart oficial:
    # thinking habilitado por padrao, temperature=1.0, top_p=0.95
    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": "Voce e um assistente de programacao senior."},
            {"role": "user", "content": prompt},
        ],
        temperature=1.0,
        top_p=0.95,
        max_tokens=32768,
        extra_body={"thinking": {"type": "enabled"}},
    )

    print(response.choices[0].message.content)


if __name__ == "__main__":
    main()

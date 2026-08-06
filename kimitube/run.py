"""Entrypoint do Kimitube — uvicorn + scheduler (scheduler sobe no lifespan)."""

import uvicorn

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="127.0.0.1", port=8300, reload=False)

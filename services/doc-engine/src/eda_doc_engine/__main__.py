"""`python -m eda_doc_engine`: env'i doğrular ve uvicorn'u fabrikayla başlatır (002 §5.7)."""

import uvicorn

from eda_doc_engine.config import load_settings


def main() -> None:
    settings = load_settings()
    uvicorn.run(
        "eda_doc_engine.main:create_app",
        factory=True,
        host="0.0.0.0",  # noqa: S104 - konteynır içi; ağ yalıtımı docproc ile (002 §2)
        port=settings.port,
        workers=1,
        proxy_headers=False,
        server_header=False,
        access_log=False,
    )


if __name__ == "__main__":
    main()

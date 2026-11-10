"""KK-P00 / KK-013-14: doc-engine sağlık uç noktası (@tk TK-28)."""

from conftest import TOKEN, settings
from fastapi.testclient import TestClient

from eda_doc_engine.main import create_app


def test_kk_013_14_health_returns_ok() -> None:
    with TestClient(create_app(settings(), token=TOKEN)) as client:
        response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": "0.0.0"}

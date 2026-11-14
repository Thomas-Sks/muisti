"""Settings, from the environment (or .env) with defaults that match docker-compose.yml."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv() -> None:
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


_load_dotenv()

DB_HOST = os.environ.get("DB_HOST", "127.0.0.1")
DB_PORT = int(os.environ.get("DB_PORT", "3309"))
DB_USER = os.environ.get("DB_USER", "muisti")
DB_PASSWORD = os.environ.get("DB_PASSWORD", "muisti")
DB_NAME = os.environ.get("DB_NAME", "muisti")

MODEL_NAME = os.environ.get("EMBED_MODEL", "BAAI/bge-m3")   # same model as dataset S vectors
MODEL_TAG = "bge-m3"
EMBED_DIM = 1024
EF_SEARCH = 80            # mhnsw_ef_search, value given by MariaDB (starter RAG repo)
QUERY_TIMEOUT_MS = 3000   # MAX_EXECUTION_TIME hint on every user-triggered query

DATA_RAW = ROOT / "data" / "raw"

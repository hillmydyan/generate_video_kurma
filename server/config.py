import os
import json
from pathlib import Path
from typing import Dict, Any, List
from dotenv import load_dotenv

# Root directory of the project
ROOT_DIR = Path(__file__).resolve().parent.parent

# Load .env file
load_dotenv(ROOT_DIR / ".env")

DATA_DIR = ROOT_DIR / "data"
LOGS_DIR = ROOT_DIR / "logs"
CONFIG_DIR = ROOT_DIR / "config"

DATA_DIR.mkdir(parents=True, exist_ok=True)
LOGS_DIR.mkdir(parents=True, exist_ok=True)
(DATA_DIR / "videos").mkdir(parents=True, exist_ok=True)
(DATA_DIR / "images").mkdir(parents=True, exist_ok=True)
(DATA_DIR / "uploads").mkdir(parents=True, exist_ok=True)

# Default non-secret configurations
DEFAULT_SETTINGS: Dict[str, Any] = {
    "DEFAULT_VIDEO_MODEL": "veo",
    "DEFAULT_IMAGE_MODEL": "grok_image",
    "CREDIT_BALANCE_FLOOR": 300,
    "HISTORY_RETENTION_DAYS": 3,
    "DEAD_TASK_TTL_DAYS": 2,
    "TASK_STUCK_SEC": 1500,
    "TASK_HARD_TIMEOUT_SEC": 5400,
    "TASK_REQUEUE_MAX": 2,
    "POLL_INTERVAL_SEC": 10,
    "SUBMIT_GAP_SEC": 2,
    "MAX_INFLIGHT_PER_ACCOUNT": 2,
    "MAX_PARALLEL_PER_KANTOR": 2,
    "TASK_TIMEOUT_SEC": 600,
    "MAX_BATCH_SIZE": 4,
    "USER_QUOTA_OUTPUTS": 35,
    "USER_QUOTA_WINDOW_DAYS": 1,
    "USER_QUOTA_CREDITS": 0,
    "ROTATION_EVERY_OUTPUTS": 0,
    "REQUIRE_SECONDARY_ACCOUNT": False,
    "UPLOAD_MAX_MB": 10,
    "FACTORY_MAX_TASKS": 50,
    "FACTORY_MAX_CONCURRENT": 2,
    "FACTORY_CSV_MAX_ROWS": 50,
    "GENERATE_INTAKE_PER_MIN": 20,
    "FACTORY_INTAKE_PER_MIN": 5,
    "TOPIC_DONE_DAYS": 7,
    "DUP_WINDOW_SEC": 60,
    "CREDITS_TTL_SEC": 300,
    "ACCOUNT_BREAKER_MAX_SEC": 1800,
    "MIN_VIDEO_SEC": 2.0,
    "BLACKDETECT": True,
    "DISK_FLOOR_GB": 5,
    "FAILURE_RATE_THRESHOLD": 0.3
}

def load_app_config() -> Dict[str, Any]:
    cfg = DEFAULT_SETTINGS.copy()
    cfg_file = ROOT_DIR / "config.json"
    if cfg_file.exists():
        try:
            with open(cfg_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                # Ignore secret keys if present in config.json as per PRD line 742
                for k, v in data.items():
                    if not k.endswith("_SECRET") and not k.endswith("_KEY") and not k.endswith("_URL"):
                        cfg[k] = v
        except Exception as e:
            print(f"Warning loading config.json: {e}")
    return cfg

app_config = load_app_config()

def get_setting(key: str, default: Any = None) -> Any:
    return app_config.get(key, default)

# Secrets & environment
AUTH_SECRET = os.getenv("AUTH_SECRET", "super_secret_auth_key_snapgen_default_32chars_min!")
ACCOUNT_KEY_SECRET = os.getenv("ACCOUNT_KEY_SECRET", "super_secret_account_key_32chars_min_snapgen!")
POSTGRES_URL = os.getenv("POSTGRES_URL", "postgresql+asyncpg://postgres:postgres@localhost:5432/snapgen")
SNAPGEN_API_BASE = os.getenv("SNAPGEN_API_BASE", "https://api.snapgen.ai").rstrip("/")
LLM_API_BASE = os.getenv("LLM_API_BASE", "")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4o-mini")
ALERT_WEBHOOK_URL = os.getenv("ALERT_WEBHOOK_URL", "")
ALLOWED_ORIGINS = [x.strip() for x in os.getenv("ALLOWED_ORIGINS", "http://localhost:3001,http://127.0.0.1:3001").split(",") if x.strip()]

def load_models_catalog() -> List[Dict[str, Any]]:
    models_file = CONFIG_DIR / "models.json"
    if models_file.exists():
        try:
            with open(models_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"Error loading models.json: {e}")
    return []

def save_models_catalog(models: List[Dict[str, Any]]) -> None:
    models_file = CONFIG_DIR / "models.json"
    with open(models_file, "w", encoding="utf-8") as f:
        json.dump(models, f, indent=2)


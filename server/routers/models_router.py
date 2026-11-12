import json
from fastapi import APIRouter, Depends
from sqlalchemy import select
from server.db import AsyncSessionLocal, Division
from server.dependencies import get_current_user
from server.state import app_state
from server.config import get_setting

router = APIRouter(prefix="/api/models", tags=["models"])

@router.get("")
async def get_models(current_user: dict = Depends(get_current_user)):
    """Return active models allowed for user's division (PRD §3.4, §11)."""
    division_id = current_user.get("division_id", "kantor_a")
    is_super = current_user.get("role") == "SUPER_ADMIN"

    allowed_models = []
    default_video = get_setting("DEFAULT_VIDEO_MODEL", "veo")
    default_image = get_setting("DEFAULT_IMAGE_MODEL", "grok_image")

    async with AsyncSessionLocal() as session:
        div = await session.get(Division, division_id)
        if div:
            if div.allowed_models_json:
                try:
                    allowed_models = json.loads(div.allowed_models_json)
                except Exception:
                    allowed_models = []
            if div.default_video_model:
                default_video = div.default_video_model
            if div.default_image_model:
                default_image = div.default_image_model

    models = app_state.get_models_for_division(allowed_models, is_super_admin=is_super)

    return {
        "models": models,
        "default_video_model": default_video,
        "default_image_model": default_image,
        "division_id": division_id,
    }


import logging
import httpx
from typing import Dict, Any, Optional
from server.config import SNAPGEN_API_BASE

logger = logging.getLogger("snapgen.client")

class SnapgenAPIError(Exception):
    def __init__(self, message: str, status_code: int = 400, raw_response: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.raw_response = raw_response

def _format_error(prefix: str, resp: httpx.Response) -> str:
    if resp.status_code == 503 or "Site Maintenance" in resp.text:
        return f"{prefix}: Server provider SnapGen sedang maintenance (HTTP 503). Silakan coba lagi beberapa saat lagi."
    try:
        data = resp.json()
        if isinstance(data, dict):
            msg = data.get("message") or data.get("error") or data.get("detail")
            if msg:
                return f"{prefix}: {msg}"
    except Exception:
        pass
    text = resp.text[:120].strip()
    return f"{prefix}: HTTP {resp.status_code} - {text}"

class SnapgenClient:
    def __init__(self, base_url: str = SNAPGEN_API_BASE, timeout: float = 60.0):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def _headers(self, api_key: str) -> Dict[str, str]:
        return {
            "x-api-key": api_key,
            "User-Agent": "SnapGen-Studio/1.6",
        }

    async def get_account(self, api_key: str) -> Dict[str, Any]:
        """GET /uapi/v1/account - Check balance and account validity."""
        url = f"{self.base_url}/uapi/v1/account"
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.get(url, headers=self._headers(api_key))
            if resp.status_code != 200:
                raise SnapgenAPIError(
                    _format_error("Akun SnapGen", resp),
                    status_code=resp.status_code,
                    raw_response=resp.text
                )
            return resp.json()

    async def submit_task(
        self,
        endpoint: str,
        body_type: str,
        params: Dict[str, Any],
        files: Optional[Dict[str, Any]],
        api_key: str
    ) -> Dict[str, Any]:
        """
        Submit generation task to model endpoint.
        body_type: 'multipart' or 'form'
        """
        clean_endpoint = endpoint if endpoint.startswith("/") else f"/{endpoint}"
        url = f"{self.base_url}{clean_endpoint}"

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            if body_type == "multipart":
                # multipart/form-data
                resp = await client.post(
                    url,
                    data=params,
                    files=files,
                    headers=self._headers(api_key)
                )
            else:
                # form-urlencoded
                resp = await client.post(
                    url,
                    data=params,
                    headers=self._headers(api_key)
                )

            if resp.status_code not in (200, 201):
                raise SnapgenAPIError(
                    _format_error("Submit generate gagal", resp),
                    status_code=resp.status_code,
                    raw_response=resp.text
                )
            return resp.json()

    async def poll_history(self, uuid: str, api_key: str) -> Dict[str, Any]:
        """GET /uapi/v1/history/{uuid} - Poll task progress and output."""
        url = f"{self.base_url}/uapi/v1/history/{uuid}"
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.get(url, headers=self._headers(api_key))
            if resp.status_code != 200:
                raise SnapgenAPIError(
                    _format_error("Status polling gagal", resp),
                    status_code=resp.status_code,
                    raw_response=resp.text
                )
            return resp.json()

    async def download_file(self, file_url: str, dest_path: str) -> int:
        """Download remote asset to local destination. Returns bytes downloaded."""
        async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
            async with client.stream("GET", file_url) as resp:
                if resp.status_code != 200:
                    raise SnapgenAPIError(f"Download failed: HTTP {resp.status_code}", status_code=resp.status_code)
                total = 0
                with open(dest_path, "wb") as f:
                    async for chunk in resp.aiter_bytes(chunk_size=65536):
                        f.write(chunk)
                        total += len(chunk)
                return total


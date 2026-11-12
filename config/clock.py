import os
import time
from datetime import datetime, date
import pytz

APP_TIMEZONE = pytz.timezone("Asia/Jakarta")

# Ensure process environment TZ is Asia/Jakarta where supported
os.environ["TZ"] = "Asia/Jakarta"
if hasattr(time, "tzset"):
    time.tzset()

def now() -> datetime:
    """Return current naive datetime in WIB (Asia/Jakarta)."""
    return datetime.now(APP_TIMEZONE).replace(tzinfo=None)

def now_aware() -> datetime:
    """Return current timezone-aware datetime in WIB."""
    return datetime.now(APP_TIMEZONE)

def today() -> date:
    """Return current date in WIB."""
    return now().date()

def today_str() -> str:
    """Return current date string YYYY-MM-DD in WIB."""
    return now().strftime("%Y-%m-%d")

def format_wib(dt: datetime, fmt: str = "%Y-%m-%d %H:%M:%S") -> str:
    """Format datetime to string in WIB."""
    if dt is None:
        return ""
    if dt.tzinfo is None:
        dt = APP_TIMEZONE.localize(dt)
    else:
        dt = dt.astimezone(APP_TIMEZONE)
    return dt.strftime(fmt)


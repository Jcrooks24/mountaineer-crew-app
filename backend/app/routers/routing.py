"""
Return-trip routing.

GET /api/routing/return-trip?lat=..&lng=..&destination=(optional)

Computes drive time from the crew's current location back to dispatch (or an
optional override destination) via the Google Directions API. The frontend adds
its own 20% buffer for display, so this endpoint returns the raw duration and
the buffer stays transparent.

Degrades gracefully: when MAPS_API_KEY is unset (or the request fails) it
returns {"ok": false, "reason": ...} with a 200 so the UI can fall back to a
plain "Navigate" deep link instead of erroring.
"""
import os

import requests
from fastapi import APIRouter, Depends, Query

from app.core.deps import get_current_user
from app.db.models.user import User

router = APIRouter(prefix="/api/routing", tags=["routing"])

# Company dispatch. Env-overridable so a different yard can be set without a
# code change; defaults to the Bozeman dispatch address.
DISPATCH_ADDRESS = os.getenv("DISPATCH_ADDRESS", "172 Timberline Dr, Bozeman, MT")


@router.get("/return-trip")
def return_trip(
    lat: float = Query(..., description="Current latitude"),
    lng: float = Query(..., description="Current longitude"),
    destination: str | None = Query(None, description="Optional override destination address"),
    _: User = Depends(get_current_user),
):
    dest = (destination or "").strip() or DISPATCH_ADDRESS
    # Reuse the existing GOOGLE_MAPS_API_KEY (already set for the RODS miles /
    # Distance Matrix feature) so no second key is needed - it just also needs
    # the Directions API enabled on the same GCP project. MAPS_API_KEY is an
    # accepted fallback name.
    api_key = os.getenv("GOOGLE_MAPS_API_KEY", "").strip() or os.getenv("MAPS_API_KEY", "").strip()
    if not api_key:
        # No key configured yet - let the client fall back to a navigate link.
        return {"ok": False, "reason": "no_api_key", "destination_address": dest}

    try:
        resp = requests.get(
            "https://maps.googleapis.com/maps/api/directions/json",
            params={
                "origin": f"{lat},{lng}",
                "destination": dest,
                "mode": "driving",
                "departure_time": "now",  # enables duration_in_traffic
                "key": api_key,
            },
            timeout=10,
        )
        data = resp.json()
    except Exception as e:  # network / parse failure - degrade, don't 500
        return {"ok": False, "reason": "request_failed", "detail": str(e), "destination_address": dest}

    status = data.get("status")
    if status != "OK" or not data.get("routes"):
        return {
            "ok": False,
            "reason": "no_route",
            "detail": data.get("error_message") or status,
            "destination_address": dest,
        }

    leg = data["routes"][0]["legs"][0]
    duration = leg.get("duration") or {}
    traffic = leg.get("duration_in_traffic") or {}
    distance = leg.get("distance") or {}
    return {
        "ok": True,
        "duration_sec": duration.get("value"),
        "duration_traffic_sec": traffic.get("value"),
        "distance_m": distance.get("value"),
        "destination_address": leg.get("end_address") or dest,
        "origin_address": leg.get("start_address"),
    }

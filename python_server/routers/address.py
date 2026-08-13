import os
import urllib.parse

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter()

LOQATE_API_KEY = os.getenv("LOQATE_API_KEY")
LOQATE_FIND_URL = "https://api.addressy.com/Capture/Interactive/Find/v1.00/json3.ws"
LOQATE_RETRIEVE_URL = "https://api.addressy.com/Capture/Interactive/Retrieve/v1.00/json3.ws"


@router.get("/search")
async def search_address(request: Request):
    if not LOQATE_API_KEY:
        return JSONResponse(
            status_code=503,
            content={"success": False, "error": "Loqate API key not configured"},
        )

    text = request.query_params.get("text")
    country = request.query_params.get("country", "ZA")
    limit = request.query_params.get("limit", "10")

    if not text:
        return JSONResponse(
            status_code=400,
            content={"success": False, "error": "Address text is required"},
        )

    params = urllib.parse.urlencode({
        "Key": LOQATE_API_KEY,
        "Text": text,
        "Countries": country,
        "Limit": limit,
    })

    async with httpx.AsyncClient() as client:
        response = await client.get(f"{LOQATE_FIND_URL}?{params}")
        data = response.json()

    return {"success": True, "data": data}


@router.get("/retrieve")
async def retrieve_address(request: Request):
    if not LOQATE_API_KEY:
        return JSONResponse(
            status_code=503,
            content={"success": False, "error": "Loqate API key not configured"},
        )

    id = request.query_params.get("id")
    if not id:
        return JSONResponse(
            status_code=400,
            content={"success": False, "error": "Suggestion id is required"},
        )

    params = urllib.parse.urlencode({"Key": LOQATE_API_KEY, "Id": id})

    async with httpx.AsyncClient() as client:
        response = await client.get(f"{LOQATE_RETRIEVE_URL}?{params}")
        data = response.json()

    return {"success": True, "data": data}


@router.get("/geocode")
async def geocode_address(request: Request):
    q = request.query_params.get("q")
    if not q:
        return JSONResponse(
            status_code=400,
            content={"success": False, "error": "Address query is required"},
        )

    params = urllib.parse.urlencode({
        "format": "json",
        "q": q,
        "limit": "1",
        "addressdetails": "1",
    })

    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"https://nominatim.openstreetmap.org/search?{params}",
            headers={"User-Agent": "LegitifyConveyHub/1.0 (dev)"},
        )
        data = response.json()

    return {"success": True, "data": data}

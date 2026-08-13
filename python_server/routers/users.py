from fastapi import APIRouter
from fastapi.responses import JSONResponse

from db import query
from utils.validate import is_non_empty_string

router = APIRouter()


def map_user_row(row):
    return {
        "id": row["id"],
        "email": row["email"],
        "name": row["name"],
        "firstName": row["first_name"],
        "lastName": row["last_name"],
        "phone": row["phone"],
        "avatarUrl": row["avatar_url"],
        "role": row["role"],
        "status": row["status"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


@router.get("/me")
async def get_me():
    result = await query(
        "SELECT * FROM users WHERE status = 'active' ORDER BY created_at ASC, id ASC LIMIT 1"
    )
    if not result.rows:
        return JSONResponse(
            status_code=404,
            content={"success": False, "error": "No user found"},
        )
    return {"success": True, "data": map_user_row(result.rows[0])}


@router.put("/me")
async def update_me(body: dict):
    get_result = await query(
        "SELECT * FROM users WHERE status = 'active' ORDER BY created_at ASC, id ASC LIMIT 1"
    )
    if not get_result.rows:
        return JSONResponse(
            status_code=404,
            content={"success": False, "error": "No user found"},
        )

    user = get_result.rows[0]
    first_name = body.get("firstName", user["first_name"] or "") if isinstance(body.get("firstName"), str) else (user["first_name"] or "")
    last_name = body.get("lastName", user["last_name"] or "") if isinstance(body.get("lastName"), str) else (user["last_name"] or "")
    email = body.get("email", user["email"]) if isinstance(body.get("email"), str) else user["email"]
    phone = body.get("phone", user["phone"] or "") if isinstance(body.get("phone"), str) else (user["phone"] or "")
    name = f"{first_name} {last_name}".strip() or user["name"]

    if not email:
        return JSONResponse(
            status_code=400,
            content={"success": False, "error": "Email is required"},
        )

    existing_email = await query(
        "SELECT id FROM users WHERE email = $1 AND id != $2 LIMIT 1",
        [email, user["id"]],
    )
    if existing_email.rows:
        return JSONResponse(
            status_code=409,
            content={"success": False, "error": "Email already in use"},
        )

    result = await query(
        """UPDATE users
           SET first_name = $1, last_name = $2, email = $3, phone = $4, name = $5, updated_at = CURRENT_TIMESTAMP
           WHERE id = $6
           RETURNING *""",
        [first_name, last_name, email, phone, name, user["id"]],
    )

    return {"success": True, "data": map_user_row(result.rows[0]), "message": "Profile updated"}

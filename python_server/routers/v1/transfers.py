from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from auth.current_user import CurrentUser
from auth.dependencies import require_jwt
from auth.policy import is_cross_tenant
from db import query

router = APIRouter()

DEFAULT_SORT_COLUMNS = ["created_at", "updated_at", "property_address", "status", "purchase_price"]


def _map_transfer(row: dict) -> dict:
    return {
        "id": row["id"],
        "transferId": row["transfer_id"],
        "propertyAddress": row["property_address"],
        "purchasePrice": float(row["purchase_price"]) if row["purchase_price"] is not None else None,
        "status": row["status"],
        "currentStep": row["current_step"],
        "totalSteps": row["total_steps"],
        "progress": int(row["progress"]) if row["progress"] is not None else None,
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "parties": [],
    }


def _parse_pagination_params(request: Request):
    try:
        page = max(1, int(request.query_params.get("page", "1")))
    except (TypeError, ValueError):
        page = 1
    try:
        limit = min(100, max(1, int(request.query_params.get("limit", "10"))))
    except (TypeError, ValueError):
        limit = 10
    sort_by = request.query_params.get("sortBy", "created_at")
    if sort_by not in DEFAULT_SORT_COLUMNS:
        sort_by = "created_at"
    sort_order = "asc" if request.query_params.get("sortOrder", "").lower() == "asc" else "desc"
    return {"page": page, "limit": limit, "sort_by": sort_by, "sort_order": sort_order}


@router.get("/")
async def list_transfers(
    request: Request,
    user: CurrentUser = Depends(require_jwt),
):
    """List transfers scoped to the authenticated user's tenant."""

    # Clients (role 4) must prove Golden Record party membership before seeing any transfer.
    # transfer_parties is currently empty, so the safe default is an empty list.
    if user.is_client:
        return {
            "message": "OK",
            "data": {
                "transfers": [],
                "pagination": {"page": 1, "limit": 10, "total": 0, "totalPages": 0},
            },
        }

    # Staff must hold the documented transfers:read ability (handover §4.5).
    if not user.has_ability("transfers:read"):
        return JSONResponse(status_code=403, content={"success": False, "error": "Forbidden"})

    filters = _parse_pagination_params(request)
    offset = (filters["page"] - 1) * filters["limit"]
    cross_tenant = is_cross_tenant(user)

    if cross_tenant:
        count_sql = "SELECT COUNT(*) AS total FROM transfers t"
        count_params = []
        data_sql = f"""
            SELECT t.id, t.transfer_id, t.property_address, t.purchase_price, t.status,
                   t.current_step, t.total_steps, t.progress, t.created_at, t.updated_at
            FROM transfers t
            ORDER BY t.{filters['sort_by']} {filters['sort_order'].upper()}
            LIMIT $1 OFFSET $2
        """
        data_params = [filters["limit"], offset]
    else:
        count_sql = "SELECT COUNT(*) AS total FROM transfers t WHERE t.accountable_institution_id = $1"
        count_params = [user.accountable_institution_id]
        data_sql = f"""
            SELECT t.id, t.transfer_id, t.property_address, t.purchase_price, t.status,
                   t.current_step, t.total_steps, t.progress, t.created_at, t.updated_at
            FROM transfers t
            WHERE t.accountable_institution_id = $1
            ORDER BY t.{filters['sort_by']} {filters['sort_order'].upper()}
            LIMIT $2 OFFSET $3
        """
        data_params = [user.accountable_institution_id, filters["limit"], offset]

    count_result = await query(count_sql, count_params)
    total = int(count_result.rows[0]["total"])

    data_result = await query(data_sql, data_params)
    transfers = [_map_transfer(row) for row in data_result.rows]

    return {
        "message": "OK",
        "data": {
            "transfers": transfers,
            "pagination": {
                "page": filters["page"],
                "limit": filters["limit"],
                "total": total,
                "totalPages": (total + filters["limit"] - 1) // filters["limit"] or 1,
            },
        },
    }

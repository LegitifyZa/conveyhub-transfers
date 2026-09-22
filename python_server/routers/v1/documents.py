"""Document download endpoint — issued-token retrieval with caller re-auth.

Every retrieval re-authorizes the signed-in caller: a valid staff JWT with
`transfers:read` whose verified institution matches the token's tenant scope.
The opaque token still scopes the grant — document id, institution, expiry,
jti — but it is not sufficient on its own: a forwarded link does not release
bytes to an unauthorized or cross-tenant caller.

The document's clean/uploaded state is re-checked at retrieval, so a token
cannot resurrect a file that has since become unavailable. 'download_link_
issued' and 'download_retrieved' are distinct op-log events — issuing a link
is never treated as evidence the file was viewed.
"""

from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response

from auth.current_user import CurrentUser
from auth.dependencies import require_jwt
from services.document_storage import build_storage
from services.matter_document_service import (
    DocumentNotAvailableError,
    DocumentNotFoundError,
    get_document_for_download,
    record_operation,
    verify_download_token,
)

router = APIRouter()


@router.get("/download/{token}")
async def download_document(token: str, request: Request, user: CurrentUser = Depends(require_jwt)):
    # Re-authorize on every retrieval: same staff bar as link issuance —
    # clients are excluded and transfers:read is required.
    if user.is_client or not user.has_ability("transfers:read"):
        raise HTTPException(status_code=403, detail="Forbidden")

    settings = request.app.state.settings
    secret = getattr(settings, "document_token_secret", None) or settings.secret_key

    payload = verify_download_token(token, secret)
    if payload is None:
        # Denied without revealing which check failed.
        raise HTTPException(status_code=403, detail="Forbidden")

    # Tenant binding: the caller's verified institution must match the
    # institution the token was issued for. A token leaked across tenants
    # releases nothing.
    if payload["ai"] != user.accountable_institution_id:
        raise HTTPException(status_code=404, detail="Not found")

    try:
        document = await get_document_for_download(payload["doc"], payload["ai"])
    except (DocumentNotFoundError, DocumentNotAvailableError):
        await record_operation(
            "download_denied",
            "failure",
            accountable_institution_id=payload["ai"],
            actor_user_id=user.user_id,
            transfer_id=None,
            document_id=payload["doc"],
            detail={"reason": "unavailable"},
        )
        raise HTTPException(status_code=404, detail="Not found") from None

    try:
        data = build_storage().get(document["storage_key"])
    except Exception:
        await record_operation(
            "download_denied",
            "failure",
            accountable_institution_id=payload["ai"],
            actor_user_id=user.user_id,
            transfer_id=str(document["transfer_id"]),
            document_id=str(document["id"]),
            detail={"reason": "storage_error"},
        )
        raise HTTPException(status_code=503, detail="Storage temporarily unavailable") from None

    await record_operation(
        "download_retrieved",
        "success",
        accountable_institution_id=document["accountable_institution_id"],
        actor_user_id=user.user_id,
        transfer_id=str(document["transfer_id"]),
        document_id=str(document["id"]),
        detail={"jti": payload.get("jti")},
    )

    filename = document.get("original_file_name") or "document"
    return Response(
        content=data,
        media_type=document.get("file_type") or "application/octet-stream",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}",
            "Cache-Control": "no-store",
        },
    )

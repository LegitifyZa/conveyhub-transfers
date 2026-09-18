"""Document download endpoint — bearer-token retrieval.

This route intentionally has NO JWT dependency: the short-lived opaque token
issued by POST /api/v1/transfers/{id}/documents/{doc}/download-link is itself
the credential (pre-signed-URL semantics). Whoever holds the token can
retrieve the file until expiry — that reuse behavior and the absence of
individual revocation are documented limitations, bounded by the TTL.

The document's clean/uploaded state is re-checked at retrieval, so a token
cannot resurrect a file that has since become unavailable. 'download_link_
issued' and 'download_retrieved' are distinct audit events — issuing a link
is never treated as evidence the file was viewed.
"""

from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response

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
async def download_document(token: str, request: Request):
    settings = request.app.state.settings
    secret = getattr(settings, "document_token_secret", None) or settings.secret_key

    payload = verify_download_token(token, secret)
    if payload is None:
        # Denied without revealing which check failed.
        raise HTTPException(status_code=403, detail="Forbidden")

    try:
        document = await get_document_for_download(payload["doc"], payload["ai"])
    except (DocumentNotFoundError, DocumentNotAvailableError):
        await record_operation(
            "download_denied",
            "failure",
            accountable_institution_id=payload["ai"],
            actor_user_id=None,
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
            actor_user_id=None,
            transfer_id=str(document["transfer_id"]),
            document_id=str(document["id"]),
            detail={"reason": "storage_error"},
        )
        raise HTTPException(status_code=503, detail="Storage temporarily unavailable") from None

    await record_operation(
        "download_retrieved",
        "success",
        accountable_institution_id=document["accountable_institution_id"],
        actor_user_id=None,
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

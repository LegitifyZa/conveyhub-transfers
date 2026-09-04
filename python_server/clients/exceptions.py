from fastapi import HTTPException

# Same public wording as services.golden_record_visibility.UPSTREAM_UNAVAILABLE_MESSAGE,
# duplicated here to keep the clients package free of a dependency on services.
GOLDEN_RECORD_SERVICE_UNAVAILABLE = HTTPException(
    status_code=503, detail="Golden Record service unavailable"
)

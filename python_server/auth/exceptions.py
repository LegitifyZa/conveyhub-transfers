from fastapi import HTTPException

UNAUTHORIZED = HTTPException(status_code=401, detail="Authentication required")
FORBIDDEN = HTTPException(status_code=403, detail="Forbidden")

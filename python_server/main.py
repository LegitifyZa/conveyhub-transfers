import os

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from db import close_pool, get_pool
from routers import address, clauses, document_catalogue, documents, generated_documents, health, milestones, template_data_fields, transfers, users

app = FastAPI(title="Legitify ConveyHub API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api/health")
app.include_router(transfers.router, prefix="/api/transfers")
app.include_router(milestones.router, prefix="/api")
app.include_router(document_catalogue.router, prefix="/api/catalogue")
app.include_router(address.router, prefix="/api/address")
app.include_router(template_data_fields.router, prefix="/api/data-fields")
app.include_router(clauses.router, prefix="/api/clauses")
app.include_router(generated_documents.router, prefix="/api/generated-documents")
app.include_router(documents.router, prefix="/api/documents")
app.include_router(users.router, prefix="/api/users")


@app.get("/api")
async def root():
    return {
        "name": "Legitify ConveyHub API",
        "version": "1.0.0",
        "endpoints": [
            "GET /api/health",
            "GET /api/transfers",
            "POST /api/transfers",
            "GET /api/transfers/:id",
            "PUT /api/transfers/:id",
            "DELETE /api/transfers/:id",
            "GET /api/transfers/:id/parties",
            "GET /api/transfers/:id/documents",
            "GET /api/transfers/:transferId/milestones",
            "PUT /api/transfers/:transferId/milestones",
            "PATCH /api/transfers/:transferId/milestones/:milestoneId",
            "GET /api/transfers/:transferId/milestones/:milestoneId/audit",
            "GET /api/transfers/:transferId/activity",
            "GET /api/catalogue",
            "POST /api/catalogue",
            "GET /api/catalogue/:id",
            "GET /api/data-fields",
            "GET /api/clauses",
            "POST /api/clauses",
            "GET /api/clauses/:id",
            "GET /api/clauses/:id/versions",
            "PUT /api/clauses/:id",
            "DELETE /api/clauses/:id",
            "GET /api/generated-documents",
            "POST /api/generated-documents",
            "GET /api/generated-documents/:id",
            "GET /api/documents",
            "GET /api/users/me",
            "PUT /api/users/me",
        ],
    }


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    if exc.status_code == 404:
        return JSONResponse(status_code=404, content={"success": False, "error": "Not found"})
    return JSONResponse(
        status_code=exc.status_code,
        content={"success": False, "error": exc.detail},
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={"success": False, "error": str(exc)},
    )


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    import traceback
    print("Unhandled error:", exc)
    traceback.print_exc()
    status_code = getattr(exc, "status_code", 500)
    message = "Internal server error" if os.getenv("NODE_ENV") == "production" else str(exc)
    return JSONResponse(
        status_code=status_code,
        content={"success": False, "error": message},
    )


@app.on_event("startup")
async def startup():
    await get_pool()


@app.on_event("shutdown")
async def shutdown():
    await close_pool()


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "3000"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)

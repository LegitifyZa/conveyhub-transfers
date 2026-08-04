import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import healthRouter from './routes/health'
import transfersRouter from './routes/transfers'
import milestonesRouter from './routes/milestones'
import documentCatalogueRouter from './routes/documentCatalogue'
import addressRouter from './routes/address'
import templateDataFieldsRouter from './routes/templateDataFields'
import clausesRouter from './routes/clauses'
import generatedDocumentsRouter from './routes/generatedDocuments'
import documentsRouter from './routes/documents'
import usersRouter from './routes/users'
import { pool } from './db'

dotenv.config()

const app = express()
const PORT = parseInt(process.env.PORT || '3000', 10)

app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

app.use('/api/health', healthRouter)
app.use('/api/transfers', transfersRouter)
app.use('/api', milestonesRouter)
app.use('/api/catalogue', documentCatalogueRouter)
app.use('/api/address', addressRouter)
app.use('/api/data-fields', templateDataFieldsRouter)
app.use('/api/clauses', clausesRouter)
app.use('/api/generated-documents', generatedDocumentsRouter)
app.use('/api/documents', documentsRouter)
app.use('/api/users', usersRouter)

app.get('/api', (_req: Request, res: Response) => {
  res.json({
    name: 'Legitify ConveyHub API',
    version: '1.0.0',
    endpoints: [
      'GET /api/health',
      'GET /api/transfers',
      'POST /api/transfers',
      'GET /api/transfers/:id',
      'PUT /api/transfers/:id',
      'DELETE /api/transfers/:id',
      'GET /api/transfers/:id/parties',
      'GET /api/transfers/:id/documents',
      'GET /api/transfers/:transferId/milestones',
      'PUT /api/transfers/:transferId/milestones',
      'PATCH /api/transfers/:transferId/milestones/:milestoneId',
      'GET /api/transfers/:transferId/milestones/:milestoneId/audit',
      'GET /api/transfers/:transferId/activity',
      'GET /api/catalogue',
      'POST /api/catalogue',
      'GET /api/catalogue/:id',
      'GET /api/data-fields',
      'GET /api/clauses',
      'POST /api/clauses',
      'GET /api/clauses/:id',
      'GET /api/clauses/:id/versions',
      'PUT /api/clauses/:id',
      'DELETE /api/clauses/:id',
      'GET /api/generated-documents',
      'POST /api/generated-documents',
      'GET /api/generated-documents/:id',
      'GET /api/documents',
      'GET /api/users/me',
      'PUT /api/users/me',
    ],
  })
})

app.use((_req: Request, res: Response) => {
  res.status(404).json({ success: false, error: 'Not found' })
})

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err)
  const statusCode = (err as any).statusCode || 500
  res.status(statusCode).json({
    success: false,
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  })
})

if (!process.env.VERCEL) {
  const server = app.listen(PORT, () => {
    console.log(`Legitify ConveyHub API listening on port ${PORT}`)
  })

  const gracefulShutdown = async (signal: string) => {
    console.log(`Received ${signal}. Shutting down gracefully...`)
    server.close(async () => {
      await pool.end()
      process.exit(0)
    })
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
  process.on('SIGINT', () => gracefulShutdown('SIGINT'))
}

export default app

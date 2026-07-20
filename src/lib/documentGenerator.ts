import { Document, Packer, Paragraph, TextRun } from 'docx'
import { jsPDF } from 'jspdf'
import { LegalClause } from './clauseLibrary'
import { MatterTemplateData, resolveTemplate, TemplateResolution } from './templateEngine'

export const GENERATOR_VERSION = '1.0.0'

export interface GenerationAuditEntry {
  id: string
  action: 'Generated'
  actor: string
  timestamp: string
  format: 'DOCX' | 'PDF'
}

export interface DocumentVersionMetadata {
  documentId: string
  templateVersion: string
  clauseVersions: string[]
  generatedDate: string
  matterId: string
  generatorVersion: string
  auditHistory: GenerationAuditEntry[]
}

export interface GenerationRequest {
  template: string
  templateVersion: string
  matterData: MatterTemplateData
  clauses: LegalClause[]
  fileName: string
  format: 'DOCX' | 'PDF'
  generatedBy?: string
}

export interface GeneratedDocument {
  fileName: string
  resolution: TemplateResolution
  metadata: DocumentVersionMetadata
}

const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

const getResolvedDocument = ({ template, templateVersion, matterData, clauses, fileName, format, generatedBy = 'John Doe' }: GenerationRequest): GeneratedDocument => {
  const resolution = resolveTemplate(template, matterData, clauses)
  if (resolution.unresolvedFields.length || resolution.undefinedFields.length || resolution.unresolvedClauses.length) {
    throw new Error('Resolve all template fields and clauses before generating a document.')
  }

  const generatedDate = new Date().toISOString()
  const matterId = matterData.Matter?.ReferenceNumber
  if (!matterId) throw new Error('A Matter ID is required before generating a document.')

  const auditEntry: GenerationAuditEntry = {
    id: crypto.randomUUID(),
    action: 'Generated',
    actor: generatedBy,
    timestamp: generatedDate,
    format
  }

  return {
    fileName,
    resolution,
    metadata: {
      documentId: crypto.randomUUID(),
      templateVersion,
      clauseVersions: resolution.resolvedClauses,
      generatedDate,
      matterId,
      generatorVersion: GENERATOR_VERSION,
      auditHistory: [auditEntry]
    }
  }
}

const metadataDescription = (metadata: DocumentVersionMetadata) => JSON.stringify(metadata)

export const generateDocxDocument = async (request: Omit<GenerationRequest, 'format'>): Promise<GeneratedDocument> => {
  const generatedDocument = getResolvedDocument({ ...request, format: 'DOCX' })
  const document = new Document({
    title: generatedDocument.fileName,
    subject: `Matter ${generatedDocument.metadata.matterId} | Template ${generatedDocument.metadata.templateVersion}`,
    creator: `Legitify ConveyHub Generator v${generatedDocument.metadata.generatorVersion}`,
    lastModifiedBy: generatedDocument.metadata.auditHistory[0].actor,
    keywords: generatedDocument.metadata.clauseVersions.join(', '),
    description: metadataDescription(generatedDocument.metadata),
    sections: [{
      children: generatedDocument.resolution.content.split('\n').map(line => new Paragraph({
        children: [new TextRun(line || ' ')]
      }))
    }]
  })
  const blob = await Packer.toBlob(document)
  downloadBlob(blob, `${generatedDocument.fileName}.docx`)
  return generatedDocument
}

export const generatePdfDocument = (request: Omit<GenerationRequest, 'format'>): GeneratedDocument => {
  const generatedDocument = getResolvedDocument({ ...request, format: 'PDF' })
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
  const margin = 54
  const lineHeight = 18
  const pageHeight = pdf.internal.pageSize.getHeight()
  const lines = pdf.splitTextToSize(generatedDocument.resolution.content, pdf.internal.pageSize.getWidth() - margin * 2) as string[]
  let y = margin

  lines.forEach(line => {
    if (y > pageHeight - margin) {
      pdf.addPage()
      y = margin
    }
    pdf.text(line, margin, y)
    y += lineHeight
  })

  pdf.setProperties({
    title: generatedDocument.fileName,
    subject: metadataDescription(generatedDocument.metadata),
    author: `Legitify ConveyHub Generator v${generatedDocument.metadata.generatorVersion}`,
    keywords: generatedDocument.metadata.clauseVersions.join(', '),
    creator: 'Legitify ConveyHub'
  })
  pdf.save(`${generatedDocument.fileName}.pdf`)
  return generatedDocument
}

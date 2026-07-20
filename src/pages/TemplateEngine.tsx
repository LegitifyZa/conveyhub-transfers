import React, { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Braces, CheckCircle2, Code2, FileText } from 'lucide-react'
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@/components/ui'
import { INITIAL_CLAUSES, LegalClause } from '@/lib/clauseLibrary'
import { MatterTemplateData, resolveTemplate } from '@/lib/templateEngine'
import { apiRequest } from '@/lib/api/http'

const DEFAULT_TEMPLATE = `Dear {{Purchaser.FullName}},

This letter relates to matter {{Matter.ReferenceNumber}} for the transfer of {{Property.Address}} (ERF {{Property.ERF}}).

{{Clause:transfer-purchase-price}}
{{Clause:occupation}}

Kind regards,
{{Firm.Name}}`

const DEFAULT_MATTER_DATA: MatterTemplateData = {
  Purchaser: { FullName: 'John Smith', IDNumber: '8501015009087' },
  Seller: { FullName: 'Jane Doe', IDNumber: '7902025009088' },
  Property: { Address: '123 Main Street, Cape Town', ERF: '1234', Description: 'Erf 1234 Cape Town', Municipality: 'City of Cape Town' },
  Transfer: { PurchasePrice: 2500000, OccupationDate: '2026-08-01', TransactionDate: '2026-07-16' },
  Firm: { Name: 'Legitify Conveyancing' },
  Matter: { ReferenceNumber: 'TRF-001' }
}

const TemplateEngine: React.FC = () => {
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE)
  const [matterDataInput, setMatterDataInput] = useState(JSON.stringify(DEFAULT_MATTER_DATA, null, 2))
  const [clauses, setClauses] = useState<LegalClause[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [dataError, setDataError] = useState('')

  useEffect(() => {
    let cancelled = false
    const loadClauses = async () => {
      setIsLoading(true)
      setError('')
      try {
        const data = await apiRequest<LegalClause[]>('/api/clauses')
        if (!cancelled) {
          setClauses(data.length > 0 ? data : INITIAL_CLAUSES)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load clause library')
          setClauses(INITIAL_CLAUSES)
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }
    loadClauses()
    return () => { cancelled = true }
  }, [])

  const matterData = useMemo(() => {
    try {
      return JSON.parse(matterDataInput) as MatterTemplateData
    } catch {
      return null
    }
  }, [matterDataInput])

  const resolution = useMemo(() => matterData ? resolveTemplate(template, matterData, clauses) : null, [clauses, matterData, template])

  const updateMatterData = (value: string) => {
    setMatterDataInput(value)
    try {
      JSON.parse(value)
      setDataError('')
    } catch {
      setDataError('Matter data must be valid JSON before placeholders can be resolved.')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Template Engine</h1>
        <p className="text-gray-600 dark:text-gray-400">Resolve Data Dictionary placeholders against a matter’s data model.</p>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </p>
      )}

      {isLoading ? (
        <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">Loading clauses…</p>
      ) : (
        <>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-start gap-3 text-sm text-gray-600 dark:text-gray-400">
                <Braces className="mt-0.5 h-5 w-5 shrink-0 text-teal-600 dark:text-teal-400" />
                <p>Use placeholders such as <code className="rounded bg-gray-100 px-1 py-0.5 text-teal-700 dark:bg-navy-700 dark:text-teal-300">{'{{Property.Address}}'}</code>. Only fields defined in the Data Dictionary can be resolved.</p>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5 text-teal-600 dark:text-teal-400" />Template</CardTitle></CardHeader>
              <CardContent>
                <textarea value={template} onChange={event => setTemplate(event.target.value)} rows={16} className="w-full rounded-lg border border-gray-300 bg-white p-3 font-mono text-sm text-gray-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500 dark:border-navy-600 dark:bg-navy-700 dark:text-gray-100" aria-label="Template content" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Code2 className="h-5 w-5 text-teal-600 dark:text-teal-400" />Matter Data Model</CardTitle></CardHeader>
              <CardContent>
                <textarea value={matterDataInput} onChange={event => updateMatterData(event.target.value)} rows={16} className="w-full rounded-lg border border-gray-300 bg-white p-3 font-mono text-sm text-gray-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500 dark:border-navy-600 dark:bg-navy-700 dark:text-gray-100" aria-label="Matter data model" />
                {dataError && <p className="mt-2 flex items-center gap-1 text-sm text-red-600 dark:text-red-400"><AlertCircle className="h-4 w-4" />{dataError}</p>}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle>Resolved Template Preview</CardTitle></CardHeader>
            <CardContent>
              {resolution ? <pre className="whitespace-pre-wrap rounded-lg bg-gray-50 p-4 font-sans text-sm leading-6 text-gray-900 dark:bg-navy-900 dark:text-gray-100">{resolution.content}</pre> : <p className="text-sm text-gray-500 dark:text-gray-400">Enter valid matter data to preview the resolved template.</p>}
            </CardContent>
          </Card>

          {resolution && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <Card><CardContent className="p-4"><p className="flex items-center gap-2 text-sm font-medium text-green-700 dark:text-green-300"><CheckCircle2 className="h-4 w-4" />Resolved ({resolution.resolvedFields.length})</p><div className="mt-3 flex flex-wrap gap-2">{resolution.resolvedFields.length > 0 ? resolution.resolvedFields.map(field => <Badge key={field} variant="success" size="sm">{field}</Badge>) : <span className="text-sm text-gray-500">None</span>}</div></CardContent></Card>
              <Card><CardContent className="p-4"><p className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-300"><AlertCircle className="h-4 w-4" />Missing matter data ({resolution.unresolvedFields.length})</p><div className="mt-3 flex flex-wrap gap-2">{resolution.unresolvedFields.length > 0 ? resolution.unresolvedFields.map(field => <Badge key={field} variant="warning" size="sm">{field}</Badge>) : <span className="text-sm text-gray-500">None</span>}</div></CardContent></Card>
              <Card><CardContent className="p-4"><p className="flex items-center gap-2 text-sm font-medium text-red-700 dark:text-red-300"><AlertCircle className="h-4 w-4" />Undefined dictionary fields ({resolution.undefinedFields.length})</p><div className="mt-3 flex flex-wrap gap-2">{resolution.undefinedFields.length > 0 ? resolution.undefinedFields.map(field => <Badge key={field} variant="error" size="sm">{field}</Badge>) : <span className="text-sm text-gray-500">None</span>}</div></CardContent></Card>
              <Card><CardContent className="p-4"><p className="flex items-center gap-2 text-sm font-medium text-green-700 dark:text-green-300"><CheckCircle2 className="h-4 w-4" />Assembled clauses ({resolution.resolvedClauses.length})</p><div className="mt-3 flex flex-wrap gap-2">{resolution.resolvedClauses.length > 0 ? resolution.resolvedClauses.map(clause => <Badge key={clause} variant="success" size="sm">{clause}</Badge>) : <span className="text-sm text-gray-500">None</span>}</div></CardContent></Card>
              <Card><CardContent className="p-4"><p className="flex items-center gap-2 text-sm font-medium text-red-700 dark:text-red-300"><AlertCircle className="h-4 w-4" />Unavailable clauses ({resolution.unresolvedClauses.length})</p><div className="mt-3 flex flex-wrap gap-2">{resolution.unresolvedClauses.length > 0 ? resolution.unresolvedClauses.map(clause => <Badge key={clause} variant="error" size="sm">{clause}</Badge>) : <span className="text-sm text-gray-500">None</span>}</div></CardContent></Card>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export { TemplateEngine }

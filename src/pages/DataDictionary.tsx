import React, { useEffect, useMemo, useState } from 'react'
import { Braces, Search } from 'lucide-react'
import { Badge, Card, CardContent, CardHeader, CardTitle, Input } from '@/components/ui'
import { TemplateDataField, TEMPLATE_DATA_DICTIONARY } from '@/lib/templateDataDictionary'
import { apiRequest } from '@/lib/api/http'

const DataDictionary: React.FC = () => {
  const [fields, setFields] = useState<TemplateDataField[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [entityFilter, setEntityFilter] = useState('All entities')

  useEffect(() => {
    let cancelled = false
    const loadFields = async () => {
      setIsLoading(true)
      setError('')
      try {
        const data = await apiRequest<TemplateDataField[]>('/api/data-fields')
        if (!cancelled) {
          setFields(data.length > 0 ? data : TEMPLATE_DATA_DICTIONARY)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load data dictionary')
          setFields(TEMPLATE_DATA_DICTIONARY)
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }
    loadFields()
    return () => { cancelled = true }
  }, [])

  const entities = useMemo(() => [...new Set(fields.map(field => field.entity))], [fields])
  const filteredFields = useMemo(() => {
    const term = searchTerm.toLowerCase()
    return fields.filter(field => {
      const matchesSearch = [field.key, field.label, field.description].some(value => value.toLowerCase().includes(term))
      return matchesSearch && (entityFilter === 'All entities' || field.entity === entityFilter)
    })
  }, [entityFilter, fields, searchTerm])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Data Dictionary</h1>
        <p className="text-gray-600 dark:text-gray-400">Central metadata fields available to every document template.</p>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </p>
      )}

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 md:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input value={searchTerm} onChange={event => setSearchTerm(event.target.value)} placeholder="Search fields, entities, or descriptions..." className="pl-10" />
            </div>
            <select value={entityFilter} onChange={event => setEntityFilter(event.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-navy-600 dark:bg-navy-700 dark:text-gray-100">
              <option>All entities</option>
              {entities.map(entity => <option key={entity}>{entity}</option>)}
            </select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Braces className="h-5 w-5 text-teal-600 dark:text-teal-400" />Template Fields ({filteredFields.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">Loading data dictionary…</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500 dark:border-navy-700 dark:text-gray-400">
                    <tr><th className="pb-3 pr-4 font-medium">Field</th><th className="pb-3 pr-4 font-medium">Label</th><th className="pb-3 pr-4 font-medium">Entity</th><th className="pb-3 pr-4 font-medium">Type</th><th className="pb-3 font-medium">Description</th></tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-navy-700">
                    {filteredFields.map(field => (
                      <tr key={field.key}>
                        <td className="py-4 pr-4 font-mono text-teal-700 dark:text-teal-300">{field.key}</td>
                        <td className="py-4 pr-4 font-medium text-gray-900 dark:text-gray-100">{field.label}</td>
                        <td className="py-4 pr-4"><Badge variant="primary" size="sm">{field.entity}</Badge></td>
                        <td className="py-4 pr-4 text-gray-600 dark:text-gray-400">{field.dataType}</td>
                        <td className="py-4 text-gray-600 dark:text-gray-400">{field.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filteredFields.length === 0 && <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">No data fields match the current filters.</p>}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export { DataDictionary }

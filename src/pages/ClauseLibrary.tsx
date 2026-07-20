import React, { FormEvent, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, FilePlus2, Library, Search } from 'lucide-react'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input } from '@/components/ui'
import { ClauseStatus, INITIAL_CLAUSES, LegalClause } from '@/lib/clauseLibrary'
import { apiRequest } from '@/lib/api/http'

const EMPTY_CLAUSE: Omit<LegalClause, 'id'> = {
  identifier: '',
  name: '',
  category: 'General',
  version: '1.0',
  status: 'Draft',
  legalAuthority: '',
  effectiveDate: new Date().toISOString().split('T')[0],
  content: ''
}

const ClauseLibrary: React.FC = () => {
  const [clauses, setClauses] = useState<LegalClause[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('All statuses')
  const [expandedClause, setExpandedClause] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [newClause, setNewClause] = useState(EMPTY_CLAUSE)

  const loadClauses = async () => {
    setIsLoading(true)
    setError('')
    try {
      const data = await apiRequest<LegalClause[]>('/api/clauses')
      setClauses(data.length > 0 ? data : INITIAL_CLAUSES)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load clause library')
      setClauses(INITIAL_CLAUSES)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadClauses()
  }, [])

  const filteredClauses = useMemo(() => {
    const search = searchTerm.toLowerCase()
    return clauses.filter(clause => {
      const matchesSearch = [clause.identifier, clause.name, clause.category, clause.legalAuthority].some(value => value.toLowerCase().includes(search))
      return matchesSearch && (statusFilter === 'All statuses' || clause.status === statusFilter)
    })
  }, [clauses, searchTerm, statusFilter])

  const addClause = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const clause: LegalClause = {
      ...newClause,
      id: `CLA-${String(Date.now()).slice(-6)}`
    }
    try {
      await apiRequest<LegalClause>('/api/clauses', { method: 'POST', body: clause })
      await loadClauses()
      setNewClause(EMPTY_CLAUSE)
      setShowForm(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save clause')
    }
  }

  const statusVariant = (status: ClauseStatus): 'success' | 'warning' | 'default' => {
    if (status === 'Active') return 'success'
    if (status === 'Draft') return 'warning'
    return 'default'
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div><h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Clause Library</h1><p className="text-gray-600 dark:text-gray-400">Versioned, reusable legal clauses assembled dynamically into templates.</p></div>
        <Button onClick={() => setShowForm(current => !current)}><FilePlus2 className="mr-2 h-4 w-4" />{showForm ? 'Close Form' : 'Add Clause Version'}</Button>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </p>
      )}

      {showForm && (
        <Card>
          <CardHeader><CardTitle>Add Clause Version</CardTitle></CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={addClause}>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Clause Identifier<Input required value={newClause.identifier} onChange={event => setNewClause(current => ({ ...current, identifier: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') }))} placeholder="transfer-purchase-price" className="mt-1" /></label>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Clause Name<Input required value={newClause.name} onChange={event => setNewClause(current => ({ ...current, name: event.target.value }))} className="mt-1" /></label>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Category<Input required value={newClause.category} onChange={event => setNewClause(current => ({ ...current, category: event.target.value }))} className="mt-1" /></label>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Version<Input required value={newClause.version} onChange={event => setNewClause(current => ({ ...current, version: event.target.value }))} className="mt-1" /></label>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Status<select value={newClause.status} onChange={event => setNewClause(current => ({ ...current, status: event.target.value as ClauseStatus }))} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-navy-600 dark:bg-navy-700 dark:text-gray-100"><option>Draft</option><option>Active</option><option>Retired</option></select></label>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Effective Date<Input required type="date" value={newClause.effectiveDate} onChange={event => setNewClause(current => ({ ...current, effectiveDate: event.target.value }))} className="mt-1" /></label>
              </div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Legal Authority<Input required value={newClause.legalAuthority} onChange={event => setNewClause(current => ({ ...current, legalAuthority: event.target.value }))} className="mt-1" /></label>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Clause Content<textarea required value={newClause.content} onChange={event => setNewClause(current => ({ ...current, content: event.target.value }))} placeholder="Use Data Dictionary placeholders such as {{Property.Address}}" rows={5} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-navy-600 dark:bg-navy-700 dark:text-gray-100" /></label>
              <div className="flex justify-end"><Button type="submit">Save Clause Version</Button></div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card><CardContent className="p-4"><div className="flex flex-col gap-3 md:flex-row"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /><Input value={searchTerm} onChange={event => setSearchTerm(event.target.value)} placeholder="Search clauses..." className="pl-10" /></div><select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-navy-600 dark:bg-navy-700 dark:text-gray-100"><option>All statuses</option><option>Active</option><option>Draft</option><option>Retired</option></select></div></CardContent></Card>

      {isLoading ? (
        <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">Loading clauses…</p>
      ) : (
        <div className="space-y-4">
          {filteredClauses.map(clause => (
            <Card key={clause.id}><CardContent className="p-5">
              <button type="button" onClick={() => setExpandedClause(current => current === clause.id ? null : clause.id)} className="flex w-full items-start justify-between gap-4 text-left"><div className="flex gap-3"><div className="rounded-lg bg-teal-50 p-2 dark:bg-teal-900/20"><Library className="h-5 w-5 text-teal-600 dark:text-teal-400" /></div><div><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold text-gray-900 dark:text-gray-100">{clause.name}</h2><Badge variant={statusVariant(clause.status)} size="sm">{clause.status}</Badge></div><p className="mt-1 font-mono text-sm text-teal-700 dark:text-teal-300">{'{{Clause:'}{clause.identifier}{'}}'}</p><p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{clause.category} · Version {clause.version} · Effective {clause.effectiveDate}</p></div></div>{expandedClause === clause.id ? <ChevronUp className="h-5 w-5 shrink-0 text-gray-400" /> : <ChevronDown className="h-5 w-5 shrink-0 text-gray-400" />}</button>
              {expandedClause === clause.id && <div className="mt-5 space-y-4 border-t border-gray-200 pt-5 dark:border-navy-700"><div><p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Legal Authority</p><p className="mt-1 text-sm text-gray-900 dark:text-gray-100">{clause.legalAuthority}</p></div><div><p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Clause Content</p><pre className="mt-1 whitespace-pre-wrap rounded-lg bg-gray-50 p-3 font-sans text-sm text-gray-900 dark:bg-navy-900 dark:text-gray-100">{clause.content}</pre></div></div>}
            </CardContent></Card>
          ))}
          {filteredClauses.length === 0 && <Card><CardContent className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">No clauses match the current filters.</CardContent></Card>}
        </div>
      )}
    </div>
  )
}

export { ClauseLibrary }

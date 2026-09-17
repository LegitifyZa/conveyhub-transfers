import React, { useEffect, useRef, useState } from 'react'
import { Link2, Search } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent, Input, Button } from '@/components/ui'
import { TransferApi, type MatterPropertyLinkApi, type PropertyRecordApi } from '@/lib/api/transferApi'
import { serviceUnavailableMessage } from '@/lib/api/serviceStatus'

/**
 * Saved matter–property links plus attach-existing via discovery.
 *
 * The list always renders server readback — never optimistic local state —
 * so a failed attach leaves nothing displayed that was not persisted.
 * Existing links remain readable regardless of the property's current
 * status; only active properties are offered as new link targets. Manual
 * captures are labelled unverified; no verification is inferred from
 * external identifiers.
 */
const MatterPropertiesPanel: React.FC<{ transferId: string }> = ({ transferId }) => {
  const [links, setLinks] = useState<MatterPropertyLinkApi[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [isAttaching, setIsAttaching] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [results, setResults] = useState<PropertyRecordApi[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [attachError, setAttachError] = useState<string | null>(null)
  const [pendingPropertyId, setPendingPropertyId] = useState<string | null>(null)
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = async () => {
    setLoadError(null)
    try {
      const response = await TransferApi.getMatterProperties(transferId)
      setLinks(response.data ?? [])
    } catch (err) {
      setLoadError(serviceUnavailableMessage('Linked properties', err))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    setIsLoading(true)
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transferId])

  useEffect(() => {
    if (searchTimeout.current) {
      clearTimeout(searchTimeout.current)
    }
    setSearchError(null)
    if (!isAttaching || searchText.trim().length < 3) {
      setResults([])
      return
    }
    setIsSearching(true)
    searchTimeout.current = setTimeout(async () => {
      try {
        const response = await TransferApi.searchProperties(searchText.trim())
        setResults(response.data ?? [])
      } catch (err) {
        setResults([])
        setSearchError(serviceUnavailableMessage('Property search', err))
      } finally {
        setIsSearching(false)
      }
    }, 400)
    return () => {
      if (searchTimeout.current) {
        clearTimeout(searchTimeout.current)
      }
    }
  }, [searchText, isAttaching])

  const attach = async (property: PropertyRecordApi) => {
    if (property.status !== 'active' || pendingPropertyId) return
    setAttachError(null)
    setPendingPropertyId(property.id)
    try {
      // A fresh key per user-initiated attach; a retried click after a failed
      // request reuses pendingPropertyId's request only on resubmit of the
      // same action — the server deduplicates identical replays anyway.
      await TransferApi.attachMatterProperty(transferId, {
        client_request_id: crypto.randomUUID(),
        property_id: property.id
      })
      await load()
      setIsAttaching(false)
      setSearchText('')
      setResults([])
    } catch (err) {
      // Honest failure: the link list stays as last read back from the server.
      setAttachError(err instanceof Error ? err.message : 'The property could not be linked.')
    } finally {
      setPendingPropertyId(null)
    }
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center space-x-2">
            <Link2 className="h-5 w-5 text-teal-600 dark:text-teal-400" />
            <span>Linked Properties</span>
          </CardTitle>
          {!isAttaching && (
            <Button variant="outline" size="sm" onClick={() => setIsAttaching(true)}>
              Attach existing property
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading linked properties...</p>
        )}
        {loadError && (
          <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
        )}
        {!isLoading && !loadError && links.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No properties are linked to this matter yet.
          </p>
        )}
        {!isLoading && !loadError && links.length > 0 && (
          <ul className="divide-y divide-gray-200 dark:divide-navy-700">
            {links.map((link) => (
              <li key={link.id} className="py-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {link.property?.streetAddress || link.externalPropertyId || link.propertyId || 'Linked property'}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {[link.property?.city, link.property?.province, link.property?.postalCode].filter(Boolean).join(', ')}
                      {link.property?.propertyType ? ` · ${link.property.propertyType}` : ''}
                      {link.property?.erfNumber ? ` · Erf ${link.property.erfNumber}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center space-x-2">
                    {link.property?.manual && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                        Manually captured — unverified
                      </span>
                    )}
                    {link.property?.status && link.property.status !== 'active' && (
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600 dark:bg-navy-700 dark:text-gray-300">
                        {link.property.status}
                      </span>
                    )}
                    {link.propertyKind === 'output' && (
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600 dark:bg-navy-700 dark:text-gray-300">
                        output
                      </span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {isAttaching && (
          <div className="mt-4 border-t border-gray-200 pt-4 dark:border-navy-700">
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
              Search your institution's properties
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                variant="premium"
                placeholder="Address, city, erf or reference..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                className="pl-10"
              />
            </div>
            {isSearching && (
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Searching...</p>
            )}
            {searchError && (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400">{searchError}</p>
            )}
            {results.length > 0 && (
              <div className="mt-2 max-h-56 overflow-auto rounded-lg border border-gray-200 dark:border-navy-700">
                {results.map((property) => (
                  <button
                    key={property.id}
                    type="button"
                    disabled={property.status !== 'active' || pendingPropertyId !== null}
                    onClick={() => attach(property)}
                    className="w-full border-b border-gray-100 px-4 py-2 text-left last:border-0 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-navy-700 dark:hover:bg-navy-700"
                  >
                    <p className="text-sm text-gray-900 dark:text-gray-100">
                      {property.streetAddress || property.propertyId || property.id}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {[property.city, property.province].filter(Boolean).join(', ')}
                      {property.propertyType ? ` · ${property.propertyType}` : ''}
                      {property.status && property.status !== 'active' ? ` · ${property.status} (not linkable)` : ''}
                      {property.manual ? ' · manual — unverified' : ''}
                    </p>
                  </button>
                ))}
              </div>
            )}
            {attachError && (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400">{attachError}</p>
            )}
            <div className="mt-3 flex justify-end">
              <Button variant="outline" size="sm" onClick={() => { setIsAttaching(false); setSearchText(''); setResults([]); setAttachError(null) }}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export { MatterPropertiesPanel }

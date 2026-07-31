import React, { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Building, MapPin, Home, FileText, Map as MapIcon, Search } from 'lucide-react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui'
import { Input } from '@/components/ui'
import { apiRequest } from '@/lib/api/http'
import { useTransfer, PropertyDetails } from './TransferForm'

const StepProperty: React.FC = () => {
  const { state, dispatch } = useTransfer()
  const { propertyDetails } = state
  const location = useLocation()
  const goldenRecord = location.state?.goldenRecord

  // Auto-populate from golden record if available
  useEffect(() => {
    if (goldenRecord) {
      dispatch({
        type: 'UPDATE_PROPERTY_DETAILS',
        payload: {
          address: goldenRecord.propertyAddress || '',
          city: '',
          state: '',
          zipCode: '',
          propertyType: '',
          lotNumber: '',
          legalDescription: '',
          yearBuilt: '',
          squareFootage: ''
        }
      })
    }
  }, [goldenRecord, dispatch])

  const updatePropertyDetails = (field: keyof PropertyDetails, value: string) => {
    dispatch({
      type: 'UPDATE_PROPERTY_DETAILS',
      payload: { [field]: value }
    })
  }

  const [query, setQuery] = useState(propertyDetails.address)
  const [suggestions, setSuggestions] = useState<{ id: string; text: string; description?: string }[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [coordinates, setCoordinates] = useState<{ lat: number; lng: number } | null>(null)
  const selectedRef = useRef<string | null>(null)
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)

  useEffect(() => {
    setQuery(propertyDetails.address)
  }, [propertyDetails.address])

  useEffect(() => {
    if (searchTimeout.current) {
      clearTimeout(searchTimeout.current)
    }
    setSearchError('')

    if (!showSuggestions || !query.trim() || query === (selectedRef.current ?? '')) {
      setSuggestions([])
      return
    }

    if (query.trim().length < 3) {
      setSuggestions([])
      return
    }

    setIsSearching(true)
    searchTimeout.current = setTimeout(async () => {
      try {
        const response = await apiRequest<{ success: boolean; data: { Items?: Array<{ Id: string; Text: string; Description?: string }> } }>(
          `/api/address/search?text=${encodeURIComponent(query)}&country=ZA`
        )
        setSuggestions((response.data?.Items ?? []).map(item => ({
          id: item.Id,
          text: item.Text,
          description: item.Description
        })))
      } catch (err) {
        setSuggestions([])
        setSearchError(err instanceof Error ? err.message : 'Address search failed')
      } finally {
        setIsSearching(false)
      }
    }, 400)

    return () => {
      if (searchTimeout.current) {
        clearTimeout(searchTimeout.current)
      }
    }
  }, [query, showSuggestions])

  useEffect(() => {
    if (!mapContainerRef.current || !coordinates) return

    if (!mapRef.current) {
      mapRef.current = L.map(mapContainerRef.current).setView([coordinates.lat, coordinates.lng], 16)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }).addTo(mapRef.current)
    } else {
      mapRef.current.setView([coordinates.lat, coordinates.lng], 16)
    }

    if (markerRef.current) {
      markerRef.current.setLatLng([coordinates.lat, coordinates.lng])
    } else if (mapRef.current) {
      markerRef.current = L.marker([coordinates.lat, coordinates.lng]).addTo(mapRef.current)
    }

    return () => {
      mapRef.current?.remove()
      mapRef.current = null
      markerRef.current = null
    }
  }, [coordinates])

  const handleSelectSuggestion = async (item: { id: string; text: string }) => {
    selectedRef.current = item.text
    setQuery(item.text)
    setShowSuggestions(false)
    setSuggestions([])
    setIsSearching(false)

    try {
      const response = await apiRequest<{ success: boolean; data: { Items?: Array<Record<string, string>> } }>(
        `/api/address/retrieve?id=${encodeURIComponent(item.id)}`
      )
      const result = response.data?.Items?.[0]
      if (result) {
        updatePropertyDetails('address', [result.Line1, result.Line2, result.Line3, result.Line4, result.Line5].filter(Boolean).join(', '))
        updatePropertyDetails('city', result.City || '')
        updatePropertyDetails('state', result.Province || result.ProvinceName || '')
        updatePropertyDetails('zipCode', result.PostalCode || '')
        await geocodeAddress(result)
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Could not retrieve address')
    }
  }

  const geocodeAddress = async (address: Record<string, string>) => {
    const full = [address.Line1, address.City, address.Province || address.ProvinceName, address.PostalCode, 'South Africa']
      .filter(Boolean)
      .join(', ')
    if (!full) return
    try {
      const response = await apiRequest<{ success: boolean; data: Array<{ lat: string; lon: string; display_name: string }> }>(
        `/api/address/geocode?q=${encodeURIComponent(full)}`
      )
      const first = response.data?.[0]
      if (first) {
        setCoordinates({ lat: parseFloat(first.lat), lng: parseFloat(first.lon) })
      }
    } catch {
      setCoordinates(null)
    }
  }

  const handleAddressInputChange = (value: string) => {
    selectedRef.current = null
    setQuery(value)
    setShowSuggestions(true)
    updatePropertyDetails('address', value)
  }

  const propertyTypes = [
    'Freehold',
    'Sectional Title',
    'Share Block',
    'Life Rights',
    'Agricultural Holding',
    'Farm',
    'Commercial',
    'Mixed Use',
    'Vacant Land'
  ]

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-right-5 duration-500">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Property Details
        </h2>
        <p className="text-gray-600 dark:text-gray-400">
          Enter the property information for this transfer
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Address Information */}
        <Card variant="premium" className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <MapPin className="h-5 w-5 text-teal-600 dark:text-teal-400" />
              <span>Address Information</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Street Address *
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  variant="premium"
                  placeholder="Start typing the address..."
                  value={query}
                  onChange={(e) => handleAddressInputChange(e.target.value)}
                  onFocus={() => setShowSuggestions(true)}
                  className="pl-10 transition-all duration-200 focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                />
              </div>

              {isSearching && (
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Searching...</p>
              )}
              {searchError && (
                <p className="mt-2 text-xs text-red-600 dark:text-red-400">{searchError}</p>
              )}

              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute z-20 mt-1 w-full bg-white dark:bg-navy-800 border border-gray-200 dark:border-navy-700 rounded-lg shadow-lg max-h-60 overflow-auto">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion.id}
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); handleSelectSuggestion(suggestion) }}
                      className="w-full text-left px-4 py-2 hover:bg-gray-50 dark:hover:bg-navy-700 border-b border-gray-100 dark:border-navy-700 last:border-0"
                    >
                      <p className="text-sm text-gray-900 dark:text-gray-100">{suggestion.text}</p>
                      {suggestion.description && (
                        <p className="text-xs text-gray-500 dark:text-gray-400">{suggestion.description}</p>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {coordinates && (
                <div className="mt-4">
                  <div className="flex items-center space-x-2 mb-2">
                    <MapIcon className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Location</span>
                  </div>
                  <div ref={mapContainerRef} className="w-full h-64 rounded-lg border border-gray-200 dark:border-navy-700" />
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  City *
                </label>
                <Input
                  variant="premium"
                  placeholder="Santon"
                  value={propertyDetails.city}
                  onChange={(e) => updatePropertyDetails('city', e.target.value)}
                  className="transition-all duration-200 focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Province *
                </label>
                <Input
                  variant="premium"
                  placeholder="Gouteng"
                  value={propertyDetails.state}
                  onChange={(e) => updatePropertyDetails('state', e.target.value)}
                  className="transition-all duration-200 focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  ZIP Code *
                </label>
                <Input
                  variant="premium"
                  placeholder="2196"
                  value={propertyDetails.zipCode}
                  onChange={(e) => updatePropertyDetails('zipCode', e.target.value)}
                  className="transition-all duration-200 focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Property Information */}
        <Card variant="premium">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Building className="h-5 w-5 text-teal-600 dark:text-teal-400" />
              <span>Property Information</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Property Type
              </label>
              <select
                value={propertyDetails.propertyType}
                onChange={(e) => updatePropertyDetails('propertyType', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-navy-600 rounded-lg bg-white dark:bg-navy-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition-all duration-200"
              >
                <option value="">Select property type</option>
                {propertyTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Lot Number
              </label>
              <Input
                variant="premium"
                placeholder="Lot 12, Block 5"
                value={propertyDetails.lotNumber}
                onChange={(e) => updatePropertyDetails('lotNumber', e.target.value)}
                className="transition-all duration-200 focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Year Built
              </label>
              <Input
                variant="premium"
                placeholder="2020"
                value={propertyDetails.yearBuilt}
                onChange={(e) => updatePropertyDetails('yearBuilt', e.target.value)}
                className="transition-all duration-200 focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Square Meterage
              </label>
              <Input
                variant="premium"
                placeholder="2,500"
                value={propertyDetails.squareFootage}
                onChange={(e) => updatePropertyDetails('squareFootage', e.target.value)}
                className="transition-all duration-200 focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              />
            </div>
          </CardContent>
        </Card>

        {/* Legal Description */}
        <Card variant="premium">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <FileText className="h-5 w-5 text-teal-600 dark:text-teal-400" />
              <span>Legal Description</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Legal Description
              </label>
              <textarea
                value={propertyDetails.legalDescription}
                onChange={(e) => updatePropertyDetails('legalDescription', e.target.value)}
                placeholder="Enter the legal description as it appears on the deed..."
                rows={6}
                className="w-full px-3 py-2 border border-gray-300 dark:border-navy-600 rounded-lg bg-white dark:bg-navy-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition-all duration-200 resize-none"
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Validation Summary */}
      <Card variant="glass">
        <CardContent className="p-4">
          <div className="flex items-center space-x-2">
            <Home className="h-5 w-5 text-teal-600 dark:text-teal-400" />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Required fields marked with * must be completed
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export { StepProperty }

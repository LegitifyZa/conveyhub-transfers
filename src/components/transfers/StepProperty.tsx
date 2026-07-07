import React, { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { Building, MapPin, Home, FileText } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui'
import { Input } from '@/components/ui'
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
          propertyType: 'Single Family Home',
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

  const propertyTypes = [
    'Single Family Home',
    'Condominium',
    'Townhouse',
    'Multi-Family',
    'Commercial',
    'Land',
    'Other'
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
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Street Address *
              </label>
              <Input
                variant="premium"
                placeholder="123 Main Street"
                value={propertyDetails.address}
                onChange={(e) => updatePropertyDetails('address', e.target.value)}
                className="transition-all duration-200 focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              />
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
                  placeholder="10001"
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
                Square Footage
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

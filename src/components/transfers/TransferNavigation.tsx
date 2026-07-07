import React from 'react'
import { ChevronLeft, ChevronRight, Save } from 'lucide-react'
import { Button } from '@/components/ui'
import { useTransfer, validatePropertyDetails, validateParties, validateFinancials, validateDocuments, REQUIRED_DOCUMENT_TYPES } from './TransferForm'

interface TransferNavigationProps {
  currentStep: number
  totalSteps: number
  onPrevious: () => void
  onNext: () => void
  onSave?: () => void
  onSubmit?: () => void
}

const TransferNavigation: React.FC<TransferNavigationProps> = ({
  currentStep,
  totalSteps,
  onPrevious,
  onNext,
  onSave,
  onSubmit
}) => {
  const { state } = useTransfer()

  const validateCurrentStep = (): boolean => {
    switch (currentStep) {
      case 1:
        return validatePropertyDetails(state.propertyDetails)
      case 2:
        return validateParties(state.parties)
      case 3:
        return validateFinancials(state.financials)
      case 4:
        return validateDocuments(state.documents)
      case 5:
        return true // Review step doesn't need validation
      default:
        return false
    }
  }

  const canProceed = validateCurrentStep()
  const isLastStep = currentStep === totalSteps
  const isFirstStep = currentStep === 1

  const getStepErrors = (): string[] => {
    const errors: string[] = []
    
    switch (currentStep) {
      case 1:
        if (!state.propertyDetails.address) errors.push('Street address is required')
        if (!state.propertyDetails.city) errors.push('City is required')
        if (!state.propertyDetails.state) errors.push('State is required')
        if (!state.propertyDetails.zipCode) errors.push('ZIP code is required')
        break
      case 2:
        const hasBuyer = state.parties.some(p => p.type === 'buyer')
        const hasSeller = state.parties.some(p => p.type === 'seller')
        if (!hasBuyer) errors.push('At least one buyer is required')
        if (!hasSeller) errors.push('At least one seller is required')
        
        state.parties.forEach((party, index) => {
          if (!party.name) errors.push(`Party ${index + 1} name is required`)
          if (!party.email) errors.push(`Party ${index + 1} email is required`)
        })
        break
      case 3:
        if (!state.financials.purchasePrice) errors.push('Purchase price is required')
        if (!state.financials.depositAmount) errors.push('Deposit amount is required')
        break
      case 4:
        REQUIRED_DOCUMENT_TYPES.forEach(docType => {
          const hasDoc = state.documents.some(doc =>
            doc.type === docType && doc.status === 'uploaded'
          )
          if (!hasDoc) {
            const label = docType.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
            errors.push(`${label} is required`)
          }
        })
        break
    }
    
    return errors
  }

  const stepErrors = getStepErrors()

  return (
    <div className="space-y-4">
      {/* Validation Errors */}
      {!canProceed && stepErrors.length > 0 && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="flex items-start space-x-3">
            <div className="w-5 h-5 rounded-full bg-red-100 dark:bg-red-900/50 flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="text-red-600 dark:text-red-400 text-xs font-bold">!</span>
            </div>
            <div>
              <h4 className="text-sm font-medium text-red-800 dark:text-red-200 mb-2">
                Please complete the following required fields:
              </h4>
              <ul className="space-y-1">
                {stepErrors.map((error, index) => (
                  <li key={index} className="text-sm text-red-700 dark:text-red-300">
                    • {error}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Navigation Buttons */}
      <div className="flex items-center justify-between">
        <div className="flex space-x-3">
          {!isFirstStep && (
            <Button
              variant="premium-secondary"
              onClick={onPrevious}
              className="transition-all duration-200 hover:scale-105"
            >
              <ChevronLeft className="h-4 w-4 mr-2" />
              Previous
            </Button>
          )}
        </div>

        <div className="flex items-center space-x-3">
          {onSave && (
            <Button
              variant="secondary"
              onClick={onSave}
              className="transition-all duration-200"
            >
              <Save className="h-4 w-4 mr-2" />
              Save Draft
            </Button>
          )}

          {isLastStep ? (
            <Button
              variant="premium-primary"
              onClick={onSubmit}
              disabled={!canProceed}
              className="transition-all duration-200 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Submit Transfer
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          ) : (
            <Button
              variant="premium-primary"
              onClick={onNext}
              disabled={!canProceed}
              className="transition-all duration-200 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next Step
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          )}
        </div>
      </div>

      {/* Progress Indicator */}
      <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
        <span>Step {currentStep} of {totalSteps}</span>
        <span>{Math.round((currentStep / totalSteps) * 100)}% Complete</span>
      </div>
    </div>
  )
}

export { TransferNavigation }

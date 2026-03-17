import React from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui'
import { 
  TransferProvider, 
  useTransfer, 
  getProgressPercentage
} from '@/components/transfers/TransferForm'
import { StepProperty } from '@/components/transfers/StepProperty'
import { StepParties } from '@/components/transfers/StepParties'
import { StepFinancials } from '@/components/transfers/StepFinancials'
import { TransferNavigation } from '@/components/transfers/TransferNavigation'

const Transfers: React.FC = () => {
  return (
    <TransferProvider>
      <TransferWorkflow />
    </TransferProvider>
  )
}

const TransferWorkflow: React.FC = () => {
  const { state, dispatch } = useTransfer()
  const { currentStep } = state

  const handlePrevious = () => {
    dispatch({ type: 'SET_CURRENT_STEP', payload: Math.max(1, currentStep - 1) })
  }

  const handleNext = () => {
    dispatch({ type: 'SET_CURRENT_STEP', payload: Math.min(5, currentStep + 1) })
  }

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return <StepProperty />
      case 2:
        return <StepParties />
      case 3:
        return <StepFinancials />
      case 4:
        return <div className="text-center p-8">
          <h2 className="text-2xl font-bold mb-4">Documents</h2>
          <p className="text-gray-600">Document upload coming soon...</p>
        </div>
      case 5:
        return <div className="text-center p-8">
          <h2 className="text-2xl font-bold mb-4">Review</h2>
          <p className="text-gray-600">Review step coming soon...</p>
        </div>
      default:
        return <StepProperty />
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-navy-900">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
            Property Transfer
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Complete the transfer process step by step
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            {renderStep()}
            <TransferNavigation
              currentStep={currentStep}
              totalSteps={5}
              onPrevious={handlePrevious}
              onNext={handleNext}
            />
          </div>

          <div className="lg:col-span-1">
            <Card className="sticky top-8">
              <CardHeader>
                <CardTitle>Transfer Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                      Progress
                    </div>
                    <div className="text-2xl font-bold text-teal-600 dark:text-teal-400">
                      {getProgressPercentage(state)}%
                    </div>
                  </div>
                  
                  <div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                      Current Step
                    </div>
                    <div className="font-medium text-gray-900 dark:text-gray-100">
                      {currentStep === 1 && 'Property Details'}
                      {currentStep === 2 && 'Parties Information'}
                      {currentStep === 3 && 'Financial Information'}
                      {currentStep === 4 && 'Documents'}
                      {currentStep === 5 && 'Review & Submit'}
                    </div>
                  </div>

                  <div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                      Status
                    </div>
                    <div className="font-medium text-gray-900 dark:text-gray-100">
                      In Progress
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}

export { Transfers }

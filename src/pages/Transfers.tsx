import React, { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui'
import {
  TransferProvider,
  useTransfer,
  getProgressPercentage,
  TransferState
} from '@/components/transfers/TransferForm'
import { StepProperty } from '@/components/transfers/StepProperty'
import { StepParties } from '@/components/transfers/StepParties'
import { StepFinancials } from '@/components/transfers/StepFinancials'
import { StepDocuments } from '@/components/transfers/StepDocuments'
import { StepReview } from '@/components/transfers/StepReview'
import { TransferNavigation } from '@/components/transfers/TransferNavigation'
import { UnavailableNotice } from '@/components/ui'
import { useTransfers, TransferAggregate } from '@/hooks/useTransfers'
import { TransferApi } from '@/lib/api/transferApi'
import { isPersistenceDisabled, isPersistenceUnavailable, probeMatterPersistence, serviceUnavailableMessage } from '@/lib/api/serviceStatus'

const Transfers: React.FC = () => {
  return (
    <TransferProvider>
      <TransferWorkflow />
    </TransferProvider>
  )
}

const buildAggregate = (state: TransferState, status?: TransferState['status']): TransferAggregate => ({
  ...state,
  status: status ?? state.status,
  documents: state.documents.map(({ file: _file, ...metadata }) => metadata)
})

const TransferWorkflow: React.FC = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { state, dispatch } = useTransfer()
  const { currentStep } = state
  const transferId = (location.state as { transferId?: string } | null)?.transferId || new URLSearchParams(location.search).get('id') || undefined

  const { fetchTransfer, error, isLoading } = useTransfers()
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [persistenceError, setPersistenceError] = useState<Error | null>(null)
  const [persistenceChecked, setPersistenceChecked] = useState(false)

  // Probe the matter-persistence lane once so Save/Submit are disabled up front
  // while the legacy transfers API is unavailable, instead of failing on click.
  // A null result only means the lane is not known to be down — it does not
  // prove write permission; actual saves still surface their own failures.
  useEffect(() => {
    let cancelled = false
    probeMatterPersistence()
      .then((failure) => { if (!cancelled && failure) setPersistenceError(failure) })
      .finally(() => { if (!cancelled) setPersistenceChecked(true) })
    return () => { cancelled = true }
  }, [])

  // Load an existing transfer aggregate when the component is entered with a transfer id.
  useEffect(() => {
    if (!transferId) return

    let cancelled = false
    const load = async () => {
      const aggregate = await fetchTransfer(transferId)
      if (!cancelled && aggregate) {
        dispatch({ type: 'HYDRATE_TRANSFER', payload: aggregate })
      }
    }
    load()
    return () => { cancelled = true }
  }, [transferId, fetchTransfer, dispatch])

  const handlePrevious = () => {
    dispatch({ type: 'SET_CURRENT_STEP', payload: Math.max(1, currentStep - 1) })
  }

  const handleNext = () => {
    dispatch({ type: 'SET_CURRENT_STEP', payload: Math.min(5, currentStep + 1) })
  }

  // Returns the saved aggregate on success, or null when nothing was saved.
  // Callers must treat null strictly as "not saved" — no success messaging or
  // navigation may follow it. Entered form state is left untouched on failure.
  const persistAggregate = async (status?: TransferState['status']): Promise<TransferAggregate | null> => {
    setSaveError(null)
    if (isPersistenceDisabled(persistenceChecked, persistenceError)) return null
    setIsSaving(true)
    try {
      const aggregate = buildAggregate(state, status)
      const existingId = state.id || state.transfer_id || transferId
      const response = existingId
        ? await TransferApi.updateTransfer(existingId, aggregate)
        : await TransferApi.createTransfer(aggregate)
      if (response.success && response.data) {
        dispatch({
          type: 'SET_TRANSFER_ID',
          payload: { id: response.data.id, transfer_id: response.data.transfer_id }
        })
        return response.data
      }
      setSaveError(response.error || 'The transfer could not be saved. Your entries remain on this page.')
      return null
    } catch (err) {
      const failure = err instanceof Error ? err : new Error('The transfer could not be saved')
      setSaveError(`${serviceUnavailableMessage('Matter saving', failure)} Your entries remain on this page.`)
      if (isPersistenceUnavailable(failure)) {
        setPersistenceError(failure)
      }
      return null
    } finally {
      setIsSaving(false)
    }
  }

  const handleSaveDraft = async () => {
    const result = await persistAggregate('draft')
    if (!result) {
      setSaveError(current => current ?? 'The draft could not be saved. Your entries remain on this page.')
    }
  }

  const handleSubmit = async () => {
    const result = await persistAggregate('in_progress')
    if (!result) {
      setSaveError(current => current ?? 'The transfer could not be submitted. Your entries remain on this page.')
      return
    }
    const id = result.id || result.transfer_id
    if (id) {
      navigate(`/transfers/${id}/milestones`)
    }
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
        return <StepDocuments />
      case 5:
        return <StepReview />
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

        {persistenceError && (
          <div className="mb-6">
            <UnavailableNotice
              message={serviceUnavailableMessage('Matter saving', persistenceError)}
              detail="Entered details are kept on this page but cannot be saved to the server until authenticated matter persistence is restored."
            />
          </div>
        )}

        {(saveError || error) && (
          <div className="mb-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <p className="text-sm text-red-700 dark:text-red-300">
              {saveError || error}
            </p>
          </div>
        )}

        {isLoading && (
          <div className="mb-6 text-sm text-gray-600 dark:text-gray-400">
            Loading transfer...
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            {renderStep()}
            <TransferNavigation
              currentStep={currentStep}
              totalSteps={5}
              onPrevious={handlePrevious}
              onNext={handleNext}
              onSave={handleSaveDraft}
              onSubmit={handleSubmit}
              isSaving={isSaving}
              persistenceDisabled={isPersistenceDisabled(persistenceChecked, persistenceError)}
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
                    <div className="font-medium text-gray-900 dark:text-gray-100 capitalize">
                      {state.status.replace('_', ' ')}
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

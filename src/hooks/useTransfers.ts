import { useState, useCallback } from 'react'
import { TransferApi, TransferAggregate, Milestone, AuditEntry } from '../lib/api/transferApi'
import { TransferFilters } from '../lib/types'

export type { TransferAggregate, Milestone, AuditEntry }

export interface TransfersState {
  transfers: TransferAggregate[]
  currentTransfer: TransferAggregate | null
  currentMilestones: Milestone[]
  activity: AuditEntry[]
  isLoading: boolean
  error: string | null
}

export const useTransfers = () => {
  const [state, setState] = useState<TransfersState>({
    transfers: [],
    currentTransfer: null,
    currentMilestones: [],
    activity: [],
    isLoading: false,
    error: null
  })

  const setLoading = useCallback((loading: boolean) => {
    setState(prev => ({ ...prev, isLoading: loading, error: null }))
  }, [])

  const setError = useCallback((error: string) => {
    setState(prev => ({ ...prev, isLoading: false, error }))
  }, [])

  // Fetch list of transfers
  const fetchTransfers = useCallback(async (filters: TransferFilters = {}) => {
    setLoading(true)
    try {
      const response = await TransferApi.getTransfers(filters)
      if (response.success && response.data) {
        setState(prev => ({
          ...prev,
          transfers: response.data!,
          isLoading: false,
          error: null
        }))
      } else {
        setError(response.error || 'Failed to fetch transfers')
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'An unexpected error occurred')
    }
  }, [setLoading, setError])

  // Fetch a single transfer aggregate
  const fetchTransfer = useCallback(async (id: string) => {
    setLoading(true)
    try {
      const response = await TransferApi.getTransfer(id)
      if (response.success && response.data) {
        setState(prev => ({
          ...prev,
          currentTransfer: response.data || null,
          isLoading: false,
          error: null
        }))
        return response.data
      } else {
        setError(response.error || 'Transfer not found')
        return null
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'An unexpected error occurred')
      return null
    }
  }, [setLoading, setError])

  // Create a new transfer from an aggregate workflow state
  const createTransfer = useCallback(async (data: Partial<TransferAggregate> | { property_address: string; purchase_price: number }) => {
    setLoading(true)
    try {
      const response = await TransferApi.createTransfer(data as any)
      if (response.success && response.data) {
        setState(prev => ({
          ...prev,
          transfers: [response.data!, ...prev.transfers],
          currentTransfer: response.data!,
          isLoading: false,
          error: null
        }))
        return response.data
      } else {
        setError(response.error || 'Failed to create transfer')
        return null
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'An unexpected error occurred')
      return null
    }
  }, [setLoading, setError])

  // Update a transfer aggregate
  const updateTransfer = useCallback(async (id: string, data: Partial<TransferAggregate>) => {
    setLoading(true)
    try {
      const response = await TransferApi.updateTransfer(id, data)
      if (response.success && response.data) {
        setState(prev => ({
          ...prev,
          transfers: prev.transfers.map(t => t.id === id || t.transfer_id === id ? response.data! : t),
          currentTransfer: prev.currentTransfer && (prev.currentTransfer.id === id || prev.currentTransfer.transfer_id === id)
            ? response.data!
            : prev.currentTransfer,
          isLoading: false,
          error: null
        }))
        return response.data
      } else {
        setError(response.error || 'Failed to update transfer')
        return null
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'An unexpected error occurred')
      return null
    }
  }, [setLoading, setError])

  // Delete a transfer
  const deleteTransfer = useCallback(async (id: string) => {
    setLoading(true)
    try {
      const response = await TransferApi.deleteTransfer(id)
      if (response.success) {
        setState(prev => ({
          ...prev,
          transfers: prev.transfers.filter(t => t.id !== id && t.transfer_id !== id),
          currentTransfer: prev.currentTransfer && (prev.currentTransfer.id === id || prev.currentTransfer.transfer_id === id)
            ? null
            : prev.currentTransfer,
          isLoading: false,
          error: null
        }))
        return true
      } else {
        setError(response.error || 'Failed to delete transfer')
        return false
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'An unexpected error occurred')
      return false
    }
  }, [setLoading, setError])

  // Fetch milestones for a transfer
  const fetchMilestones = useCallback(async (id: string) => {
    try {
      const response = await TransferApi.getMilestones(id)
      if (response.success && response.data) {
        setState(prev => ({ ...prev, currentMilestones: response.data! }))
      }
    } catch (error) {
      console.error('Error fetching milestones:', error)
    }
  }, [])

  // Update milestones for a transfer
  const updateMilestones = useCallback(async (id: string, milestones: Milestone[]) => {
    try {
      const response = await TransferApi.updateMilestones(id, milestones)
      if (response.success && response.data) {
        setState(prev => ({ ...prev, currentMilestones: response.data! }))
        return response.data
      }
      return null
    } catch (error) {
      console.error('Error updating milestones:', error)
      return null
    }
  }, [])

  // Fetch activity/audit trail for a transfer
  const fetchActivity = useCallback(async (id: string) => {
    try {
      const response = await TransferApi.getActivity(id)
      if (response.success && response.data) {
        setState(prev => ({ ...prev, activity: response.data! }))
      }
    } catch (error) {
      console.error('Error fetching activity:', error)
    }
  }, [])

  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: null }))
  }, [])

  return {
    ...state,
    fetchTransfers,
    fetchTransfer,
    createTransfer,
    updateTransfer,
    deleteTransfer,
    fetchMilestones,
    updateMilestones,
    fetchActivity,
    clearError
  }
}

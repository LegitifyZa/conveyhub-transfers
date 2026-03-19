import { useState, useCallback } from 'react'
import { TransferApi } from '../lib/api/transferApi'
import { Transfer, Party, Document, TransferFilters } from '../lib/types'

export interface TransfersState {
  transfers: Transfer[]
  currentTransfer: Transfer | null
  parties: Party[]
  documents: Document[]
  stats: any
  isLoading: boolean
  error: string | null
}

export const useTransfers = () => {
  const [state, setState] = useState<TransfersState>({
    transfers: [],
    currentTransfer: null,
    parties: [],
    documents: [],
    stats: null,
    isLoading: false,
    error: null
  })

  // Fetch transfers with filters
  const fetchTransfers = useCallback(async (filters: TransferFilters = {}) => {
    setState(prev => ({ ...prev, isLoading: true, error: null }))
    
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
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: response.error || 'Failed to fetch transfers'
        }))
      }
    } catch (error) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: 'An unexpected error occurred'
      }))
    }
  }, [])

  // Fetch single transfer
  const fetchTransfer = useCallback(async (id: string) => {
    setState(prev => ({ ...prev, isLoading: true, error: null }))
    
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
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: response.error || 'Transfer not found'
        }))
        return null
      }
    } catch (error) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: 'An unexpected error occurred'
      }))
      return null
    }
  }, [])

  // Create transfer
  const createTransfer = useCallback(async (data: {
    property_address: string
    purchase_price: number
  }) => {
    setState(prev => ({ ...prev, isLoading: true, error: null }))
    
    try {
      const response = await TransferApi.createTransfer(data)
      if (response.success && response.data) {
        setState(prev => ({
          ...prev,
          transfers: [response.data!, ...prev.transfers],
          isLoading: false,
          error: null
        }))
        return response.data
      } else {
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: response.error || 'Failed to create transfer'
        }))
        return null
      }
    } catch (error) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: 'An unexpected error occurred'
      }))
      return null
    }
  }, [])

  // Update transfer
  const updateTransfer = useCallback(async (id: string, data: any) => {
    setState(prev => ({ ...prev, isLoading: true, error: null }))
    
    try {
      const response = await TransferApi.updateTransfer(id, data)
      if (response.success && response.data) {
        setState(prev => ({
          ...prev,
          transfers: prev.transfers.map(t => t.id === id ? response.data! : t),
          currentTransfer: prev.currentTransfer?.id === id ? response.data! : prev.currentTransfer,
          isLoading: false,
          error: null
        }))
        return response.data
      } else {
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: response.error || 'Failed to update transfer'
        }))
        return null
      }
    } catch (error) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: 'An unexpected error occurred'
      }))
      return null
    }
  }, [])

  // Delete transfer
  const deleteTransfer = useCallback(async (id: string) => {
    setState(prev => ({ ...prev, isLoading: true, error: null }))
    
    try {
      const response = await TransferApi.deleteTransfer(id)
      if (response.success) {
        setState(prev => ({
          ...prev,
          transfers: prev.transfers.filter(t => t.id !== id),
          currentTransfer: prev.currentTransfer?.id === id ? null : prev.currentTransfer,
          isLoading: false,
          error: null
        }))
        return true
      } else {
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: response.error || 'Failed to delete transfer'
        }))
        return false
      }
    } catch (error) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: 'An unexpected error occurred'
      }))
      return false
    }
  }, [])

  // Fetch transfer parties
  const fetchParties = useCallback(async (transferId: string) => {
    try {
      const response = await TransferApi.getTransferParties(transferId)
      if (response.success && response.data) {
        setState(prev => ({
          ...prev,
          parties: response.data!
        }))
      }
    } catch (error) {
      console.error('Error fetching parties:', error)
    }
  }, [])

  // Add party
  const addParty = useCallback(async (data: {
    transfer_id: string
    name: string
    type: 'buyer' | 'seller'
    id_number?: string
    registration_number?: string
    email?: string
    phone?: string
    address?: string
  }) => {
    try {
      const response = await TransferApi.addParty(data)
      if (response.success && response.data) {
        setState(prev => ({
          ...prev,
          parties: [...prev.parties, response.data!]
        }))
        return response.data
      }
      return null
    } catch (error) {
      console.error('Error adding party:', error)
      return null
    }
  }, [])

  // Update party
  const updateParty = useCallback(async (id: string, data: {
    name?: string
    email?: string
    phone?: string
    address?: string
  }) => {
    try {
      const response = await TransferApi.updateParty(id, data)
      if (response.success && response.data) {
        setState(prev => ({
          ...prev,
          parties: prev.parties.map(p => p.id === id ? response.data! : p)
        }))
        return response.data
      }
      return null
    } catch (error) {
      console.error('Error updating party:', error)
      return null
    }
  }, [])

  // Remove party
  const removeParty = useCallback(async (id: string) => {
    try {
      const response = await TransferApi.removeParty(id)
      if (response.success) {
        setState(prev => ({
          ...prev,
          parties: prev.parties.filter(p => p.id !== id)
        }))
        return true
      }
      return false
    } catch (error) {
      console.error('Error removing party:', error)
      return false
    }
  }, [])

  // Fetch transfer documents
  const fetchDocuments = useCallback(async (transferId: string) => {
    try {
      const response = await TransferApi.getTransferDocuments(transferId)
      if (response.success && response.data) {
        setState(prev => ({
          ...prev,
          documents: response.data!
        }))
      }
    } catch (error) {
      console.error('Error fetching documents:', error)
    }
  }, [])

  // Add document
  const addDocument = useCallback(async (data: {
    transfer_id: string
    name: string
    file_path?: string
    file_size?: number
    file_type?: string
    category?: string
  }) => {
    try {
      const response = await TransferApi.addDocument(data)
      if (response.success && response.data) {
        setState(prev => ({
          ...prev,
          documents: [...prev.documents, response.data!]
        }))
        return response.data
      }
      return null
    } catch (error) {
      console.error('Error adding document:', error)
      return null
    }
  }, [])

  // Update document status
  const updateDocumentStatus = useCallback(async (id: string, status: string) => {
    try {
      const response = await TransferApi.updateDocumentStatus(id, status)
      if (response.success && response.data) {
        setState(prev => ({
          ...prev,
          documents: prev.documents.map(d => d.id === id ? response.data! : d)
        }))
        return response.data
      }
      return null
    } catch (error) {
      console.error('Error updating document status:', error)
      return null
    }
  }, [])

  // Remove document
  const removeDocument = useCallback(async (id: string) => {
    try {
      const response = await TransferApi.removeDocument(id)
      if (response.success) {
        setState(prev => ({
          ...prev,
          documents: prev.documents.filter(d => d.id !== id)
        }))
        return true
      }
      return false
    } catch (error) {
      console.error('Error removing document:', error)
      return false
    }
  }, [])

  // Fetch statistics
  const fetchStats = useCallback(async () => {
    try {
      const response = await TransferApi.getTransferStats()
      if (response.success && response.data) {
        setState(prev => ({
          ...prev,
          stats: response.data
        }))
      }
    } catch (error) {
      console.error('Error fetching stats:', error)
    }
  }, [])

  // Search transfers
  const searchTransfers = useCallback(async (searchTerm: string) => {
    try {
      const response = await TransferApi.searchAll(searchTerm)
      if (response.success && response.data) {
        return response.data
      }
      return null
    } catch (error) {
      console.error('Error searching transfers:', error)
      return null
    }
  }, [])

  // Clear error
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
    fetchParties,
    addParty,
    updateParty,
    removeParty,
    fetchDocuments,
    addDocument,
    updateDocumentStatus,
    removeDocument,
    fetchStats,
    searchTransfers,
    clearError
  }
}

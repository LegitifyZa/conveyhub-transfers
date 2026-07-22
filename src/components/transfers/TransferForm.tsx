import React, { createContext, useContext, useReducer, ReactNode } from 'react'
import { calculateTotalTransferCosts, formatZAR } from '@/utils/transferCalculations'

// Types
export interface PropertyDetails {
  address: string
  city: string
  state: string
  zipCode: string
  propertyType: string
  lotNumber: string
  legalDescription: string
  yearBuilt: string
  squareFootage: string
}

export interface Party {
  id: string
  type: 'buyer' | 'seller'
  name: string
  idNumber: string // SA ID number or company registration number
  email: string
  phone: string
  address: string
  company?: string
  role?: string
  isPrimary?: boolean // For marking primary buyer/seller
}

export interface Financials {
  purchasePrice: string
  depositAmount: string
  loanAmount: string
  interestRate: string
  loanTerm: string
  // SA-specific fields
  transferDuty: string
  conveyancingFees: string
  deedsOfficeFees: string
  vat: string
  postPetty: string
  clearanceCertificate: string
  ratesClearance: string
}

export interface Document {
  id: string
  name: string
  type: string
  status: 'pending' | 'uploaded' | 'verified'
  uploadDate?: string
  file?: File
  description?: string
}

export interface TransferState {
  id?: string
  transfer_id?: string
  currentStep: number
  propertyDetails: PropertyDetails
  parties: Party[]
  financials: Financials
  documents: Document[]
  status: 'draft' | 'in_progress' | 'completed'
}

// Initial state
const initialState: TransferState = {
  currentStep: 1,
  propertyDetails: {
    address: '',
    city: '',
    state: '',
    zipCode: '',
    propertyType: '',
    lotNumber: '',
    legalDescription: '',
    yearBuilt: '',
    squareFootage: ''
  },
  parties: [],
  financials: {
    purchasePrice: '',
    depositAmount: '',
    loanAmount: '',
    interestRate: '',
    loanTerm: '',
    // SA-specific fields
    transferDuty: '',
    conveyancingFees: '',
    deedsOfficeFees: '',
    vat: '',
    postPetty: '',
    clearanceCertificate: '',
    ratesClearance: ''
  },
  documents: [],
  status: 'draft'
}

// Action types
type TransferAction =
  | { type: 'SET_CURRENT_STEP'; payload: number }
  | { type: 'UPDATE_PROPERTY_DETAILS'; payload: Partial<PropertyDetails> }
  | { type: 'ADD_PARTY'; payload: Party }
  | { type: 'UPDATE_PARTY'; payload: { id: string; updates: Partial<Party> } }
  | { type: 'REMOVE_PARTY'; payload: string }
  | { type: 'UPDATE_FINANCIALS'; payload: Partial<Financials> }
  | { type: 'ADD_DOCUMENT'; payload: Document }
  | { type: 'UPDATE_DOCUMENT'; payload: { id: string; updates: Partial<Document> } }
  | { type: 'REMOVE_DOCUMENT'; payload: string }
  | { type: 'SET_STATUS'; payload: 'draft' | 'in_progress' | 'completed' }
  | { type: 'SET_TRANSFER_ID'; payload: { id?: string; transfer_id?: string } }
  | { type: 'HYDRATE_TRANSFER'; payload: TransferState }
  | { type: 'RESET_FORM' }

// Reducer
const transferReducer = (state: TransferState, action: TransferAction): TransferState => {
  switch (action.type) {
    case 'SET_CURRENT_STEP':
      return { ...state, currentStep: action.payload }
    
    case 'UPDATE_PROPERTY_DETAILS':
      return {
        ...state,
        propertyDetails: { ...state.propertyDetails, ...action.payload }
      }
    
    case 'ADD_PARTY':
      return {
        ...state,
        parties: [...state.parties, action.payload]
      }
    
    case 'UPDATE_PARTY':
      return {
        ...state,
        parties: state.parties.map(party =>
          party.id === action.payload.id
            ? { ...party, ...action.payload.updates }
            : party
        )
      }
    
    case 'REMOVE_PARTY':
      return {
        ...state,
        parties: state.parties.filter(party => party.id !== action.payload)
      }
    
    case 'UPDATE_FINANCIALS':
      return {
        ...state,
        financials: { ...state.financials, ...action.payload }
      }
    
    case 'ADD_DOCUMENT':
      return {
        ...state,
        documents: [...state.documents, action.payload]
      }
    
    case 'UPDATE_DOCUMENT':
      return {
        ...state,
        documents: state.documents.map(doc =>
          doc.id === action.payload.id
            ? { ...doc, ...action.payload.updates }
            : doc
        )
      }
    
    case 'REMOVE_DOCUMENT':
      return {
        ...state,
        documents: state.documents.filter(doc => doc.id !== action.payload)
      }
    
    case 'SET_STATUS':
      return {
        ...state,
        status: action.payload
      }

    case 'SET_TRANSFER_ID':
      return {
        ...state,
        id: action.payload.id,
        transfer_id: action.payload.transfer_id
      }

    case 'HYDRATE_TRANSFER':
      return {
        ...initialState,
        ...action.payload
      }

    case 'RESET_FORM':
      return initialState
    
    default:
      return state
  }
}

// Context
const TransferContext = createContext<{
  state: TransferState
  dispatch: React.Dispatch<TransferAction>
} | null>(null)

// Provider
export const TransferProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(transferReducer, initialState)

  return (
    <TransferContext.Provider value={{ state, dispatch }}>
      {children}
    </TransferContext.Provider>
  )
}

// Hook
export const useTransfer = () => {
  const context = useContext(TransferContext)
  if (!context) {
    throw new Error('useTransfer must be used within a TransferProvider')
  }
  return context
}

// Validation functions
export const validatePropertyDetails = (details: PropertyDetails): boolean => {
  return !!(details.address && details.city && details.state && details.zipCode)
}

export const validateParties = (parties: Party[]): boolean => {
  return parties.length >= 2 && 
         parties.some(p => p.type === 'buyer') && 
         parties.some(p => p.type === 'seller') &&
         parties.every(p => p.name && p.email && p.idNumber && p.phone)
}

export const validateFinancials = (financials: Financials): boolean => {
  return !!(financials.purchasePrice && financials.depositAmount)
}

export const REQUIRED_DOCUMENT_TYPES = ['title_deed', 'sale_agreement', 'identification'] as const

export const validateDocuments = (documents: Document[]): boolean => {
  const hasRequiredTypes = REQUIRED_DOCUMENT_TYPES.every(type =>
    documents.some(doc => doc.type === type && doc.status === 'uploaded')
  )
  return documents.length >= 3 && documents.every(doc => doc.status === 'uploaded') && hasRequiredTypes
}

export const calculateTransferCosts = (financials: Financials): {
  totalCosts: number
  netProceeds: number
  transferTaxRate: number
} => {
  const purchasePrice = parseFloat(financials.purchasePrice) || 0
  const transferDuty = parseFloat(financials.transferDuty) || 0
  const conveyancingFees = parseFloat(financials.conveyancingFees) || 0
  const deedsOfficeFees = parseFloat(financials.deedsOfficeFees) || 0
  const vat = parseFloat(financials.vat) || 0
  const postPetty = parseFloat(financials.postPetty) || 0
  const clearanceCertificate = parseFloat(financials.clearanceCertificate) || 0
  const ratesClearance = parseFloat(financials.ratesClearance) || 0

  const totalCosts = transferDuty + conveyancingFees + deedsOfficeFees + vat + postPetty + clearanceCertificate + ratesClearance
  const netProceeds = purchasePrice - totalCosts
  const transferTaxRate = purchasePrice > 0 ? (transferDuty / purchasePrice) * 100 : 0

  return {
    totalCosts,
    netProceeds,
    transferTaxRate
  }
}

export const getProgressPercentage = (state: TransferState): number => {
  const steps = 5
  const completedSteps = [
    validatePropertyDetails(state.propertyDetails),
    validateParties(state.parties),
    validateFinancials(state.financials),
    validateDocuments(state.documents),
    state.currentStep === 5
  ].filter(Boolean).length

  return (completedSteps / steps) * 100
}

// SA-specific calculation functions
export const calculateSATransferCosts = (purchasePrice: string): {
  transferDuty: number
  conveyancingFees: number
  deedsOfficeFees: number
  vat: number
  postPetty: number
  clearanceCertificate: number
  ratesClearance: number
  totalCosts: number
  effectiveRate: number
} => {
  const price = parseFloat(purchasePrice) || 0
  const costs = calculateTotalTransferCosts(price)
  
  return {
    transferDuty: costs.transferCosts.transferDuty,
    conveyancingFees: costs.transferCosts.conveyancingFees,
    deedsOfficeFees: costs.transferCosts.deedsOfficeFees,
    vat: costs.additionalCosts.vat,
    postPetty: costs.additionalCosts.postPetty,
    clearanceCertificate: costs.additionalCosts.clearanceCertificate,
    ratesClearance: costs.additionalCosts.ratesClearance,
    totalCosts: costs.grandTotal,
    effectiveRate: costs.effectiveRate
  }
}

export const formatCurrency = (amount: string | number): string => {
  const num = typeof amount === 'string' ? parseFloat(amount) || 0 : amount
  return formatZAR(num)
}

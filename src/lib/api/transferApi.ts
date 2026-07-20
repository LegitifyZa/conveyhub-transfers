import { apiRequest } from './http'
import type { ApiResponse, PaginatedResponse, TransferFilters } from '../types'
import type { TransferState } from '../../components/transfers/TransferForm'

export interface TransferAggregate extends TransferState {
  id?: string
  transfer_id?: string
  created_at?: string
  updated_at?: string
}

export interface Milestone {
  id: string
  name: string
  statusLabel: string
  status: 'not_started' | 'in_progress' | 'completed' | 'overdue' | 'not_required'
  completedDate?: string
  dueDate?: string
  notes?: string
}

export interface AuditEntry {
  id: string
  user: string
  action: string
  timestamp: string
}

interface ServerAggregate {
  id?: string
  transferId?: string
  transfer_id?: string
  propertyAddress?: string
  purchasePrice?: number
  status?: string
  currentStep?: number
  totalSteps?: number
  progress?: number
  property?: Record<string, unknown>
  parties?: Record<string, unknown>[]
  financials?: Record<string, unknown>
  documents?: Record<string, unknown>[]
  createdAt?: string
  updatedAt?: string
}

function buildQueryString(filters: TransferFilters): string {
  const params = new URLSearchParams()
  if (filters.status) params.set('status', filters.status)
  if (filters.search) params.set('search', filters.search)
  if (filters.page) params.set('page', String(filters.page))
  if (filters.limit) params.set('limit', String(filters.limit))
  if (filters.sortBy) params.set('sortBy', filters.sortBy)
  if (filters.sortOrder) params.set('sortOrder', filters.sortOrder)
  return params.toString()
}

function isLegacyCreatePayload(data: unknown): data is { property_address: string; purchase_price: number } {
  return Boolean(data && typeof data === 'object' && typeof (data as Record<string, unknown>).property_address === 'string' && typeof (data as Record<string, unknown>).purchase_price === 'number')
}

function legacyToAggregate(data: { property_address: string; purchase_price: number }): TransferAggregate {
  return {
    currentStep: 1,
    status: 'draft',
    propertyDetails: { address: data.property_address, city: '', state: '', zipCode: '', propertyType: '', lotNumber: '', legalDescription: '', yearBuilt: '', squareFootage: '' },
    parties: [],
    financials: { purchasePrice: String(data.purchase_price), depositAmount: '', loanAmount: '', interestRate: '', loanTerm: '', transferDuty: '', conveyancingFees: '', deedsOfficeFees: '', vat: '', postPetty: '', clearanceCertificate: '', ratesClearance: '' },
    documents: []
  }
}

function toServerAggregate(state: TransferAggregate) {
  const property = state.propertyDetails
  const financials = state.financials
  return {
    id: state.id,
    transferId: state.transfer_id,
    currentStep: state.currentStep,
    totalSteps: 5,
    progress: Math.round((state.currentStep / 5) * 100),
    status: state.status,
    property: {
      address: property.address,
      city: property.city,
      province: property.state,
      postalCode: property.zipCode,
      propertyType: property.propertyType,
      erfNumber: property.lotNumber,
      lotNumber: property.lotNumber,
      legalDescription: property.legalDescription,
      description: property.legalDescription,
      yearBuilt: property.yearBuilt,
      squareFootage: property.squareFootage
    },
    parties: state.parties,
    financials: {
      ...financials,
      postAndPetties: financials.postPetty,
      clearanceCertificateFee: financials.clearanceCertificate,
      ratesClearanceAmount: financials.ratesClearance
    },
    documents: state.documents.map(({ file: _file, ...document }) => ({
      ...document,
      category: document.type,
      uploadedAt: document.uploadDate
    }))
  }
}

const value = (input: unknown) => input === null || input === undefined ? '' : String(input)

function fromServerAggregate(server: ServerAggregate): TransferAggregate {
  const property = server.property || {}
  const financials = server.financials || {}
  const status = server.status === 'completed' ? 'completed' : server.status === 'in_progress' ? 'in_progress' : 'draft'
  return {
    id: server.id,
    transfer_id: server.transferId || server.transfer_id,
    created_at: server.createdAt,
    updated_at: server.updatedAt,
    currentStep: server.currentStep || 1,
    status,
    propertyDetails: {
      address: value(property.streetAddress ?? property.address ?? server.propertyAddress),
      city: value(property.city),
      state: value(property.province),
      zipCode: value(property.postalCode),
      propertyType: value(property.propertyType),
      lotNumber: value(property.lotNumber ?? property.erfNumber),
      legalDescription: value(property.legalDescription ?? property.description),
      yearBuilt: value(property.yearBuilt),
      squareFootage: value(property.squareFootage ?? property.extentSqm)
    },
    parties: (server.parties || []).map(party => ({
      id: value(party.id),
      type: party.type === 'seller' ? 'seller' : 'buyer',
      name: value(party.name),
      idNumber: value(party.idNumber),
      email: value(party.email),
      phone: value(party.phone),
      address: value(party.address),
      company: value(party.company ?? party.companyName),
      role: value(party.role ?? party.roleTitle),
      isPrimary: Boolean(party.isPrimary)
    })),
    financials: {
      purchasePrice: value(financials.purchasePrice ?? server.purchasePrice),
      depositAmount: value(financials.depositAmount),
      loanAmount: value(financials.loanAmount),
      interestRate: value(financials.interestRate),
      loanTerm: value(financials.loanTerm),
      transferDuty: value(financials.transferDuty),
      conveyancingFees: value(financials.conveyancingFees),
      deedsOfficeFees: value(financials.deedsOfficeFees),
      vat: value(financials.vat),
      postPetty: value(financials.postAndPetties ?? financials.postPetty),
      clearanceCertificate: value(financials.clearanceCertificateFee ?? financials.clearanceCertificate),
      ratesClearance: value(financials.ratesClearanceAmount ?? financials.ratesClearance)
    },
    documents: (server.documents || []).map(document => ({
      id: value(document.id),
      name: value(document.name),
      type: value(document.category ?? document.type),
      status: document.status === 'verified' ? 'verified' : document.status === 'pending' ? 'pending' : 'uploaded',
      uploadDate: value(document.uploadedAt ?? document.uploadDate),
      description: value(document.description)
    }))
  }
}

export class TransferApi {
  static async getTransfers(filters: TransferFilters = {}): Promise<PaginatedResponse<TransferAggregate>> {
    const qs = buildQueryString(filters)
    const response = await apiRequest<PaginatedResponse<ServerAggregate>>(`/api/transfers${qs ? `?${qs}` : ''}`)
    return { ...response, data: (response.data || []).map(fromServerAggregate) }
  }

  static async getTransfer(id: string): Promise<ApiResponse<TransferAggregate>> {
    const response = await apiRequest<ApiResponse<ServerAggregate>>(`/api/transfers/${id}`)
    return { ...response, data: response.data ? fromServerAggregate(response.data) : undefined }
  }

  static async createTransfer(data: Partial<TransferAggregate> | { property_address: string; purchase_price: number }): Promise<ApiResponse<TransferAggregate>> {
    const aggregate = isLegacyCreatePayload(data) ? legacyToAggregate(data) : data as TransferAggregate
    const response = await apiRequest<ApiResponse<ServerAggregate>>('/api/transfers', { method: 'POST', body: toServerAggregate(aggregate) })
    return { ...response, data: response.data ? fromServerAggregate(response.data) : undefined }
  }

  static async updateTransfer(id: string, data: Partial<TransferAggregate>): Promise<ApiResponse<TransferAggregate>> {
    const response = await apiRequest<ApiResponse<ServerAggregate>>(`/api/transfers/${id}`, { method: 'PUT', body: toServerAggregate(data as TransferAggregate) })
    return { ...response, data: response.data ? fromServerAggregate(response.data) : undefined }
  }

  static async deleteTransfer(id: string): Promise<ApiResponse<boolean>> {
    return apiRequest(`/api/transfers/${id}`, { method: 'DELETE' })
  }

  static async getMilestones(id: string): Promise<ApiResponse<Milestone[]>> {
    return apiRequest(`/api/transfers/${id}/milestones`)
  }

  static async updateMilestones(id: string, milestones: Milestone[]): Promise<ApiResponse<Milestone[]>> {
    return apiRequest(`/api/transfers/${id}/milestones`, { method: 'PUT', body: milestones })
  }

  static async getActivity(id: string): Promise<ApiResponse<AuditEntry[]>> {
    return apiRequest(`/api/transfers/${id}/activity`)
  }
}

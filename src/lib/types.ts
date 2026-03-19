// Database entity types

export interface Transfer {
  id: string
  transfer_id: string
  property_address: string
  purchase_price: number
  transfer_duty?: number
  conveyancing_fees?: number
  deeds_office_fees?: number
  vat?: number
  total_costs?: number
  status: 'draft' | 'in_progress' | 'completed' | 'cancelled'
  current_step: number
  total_steps: number
  progress: number
  created_at: Date
  updated_at: Date
}

export interface Party {
  id: string
  transfer_id: string
  name: string
  type: 'buyer' | 'seller'
  id_number?: string
  registration_number?: string
  email?: string
  phone?: string
  address?: string
  created_at: Date
  updated_at: Date
}

export interface Document {
  id: string
  transfer_id: string
  name: string
  file_path?: string
  file_size?: number
  file_type?: string
  category?: string
  status: 'pending' | 'uploaded' | 'verified' | 'rejected'
  uploaded_at: Date
  updated_at: Date
}

export interface User {
  id: string
  email: string
  name: string
  role: 'admin' | 'user' | 'conveyancer'
  created_at: Date
  updated_at: Date
}

// API Response types
export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

// Database query parameters
export interface TransferFilters {
  status?: string
  search?: string
  page?: number
  limit?: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

export interface CreateTransferData {
  transfer_id: string
  property_address: string
  purchase_price: number
}

export interface UpdateTransferData {
  property_address?: string
  purchase_price?: number
  status?: string
  current_step?: number
  progress?: number
}

export interface CreatePartyData {
  transfer_id: string
  name: string
  type: 'buyer' | 'seller'
  id_number?: string
  registration_number?: string
  email?: string
  phone?: string
  address?: string
}

export interface UpdatePartyData {
  name?: string
  email?: string
  phone?: string
  address?: string
}

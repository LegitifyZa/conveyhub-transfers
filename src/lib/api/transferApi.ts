import { TransferService } from '../services/transferService'
import { DatabaseUtils } from '../utils/databaseUtils'
import { 
  Transfer, 
  Party, 
  Document, 
  TransferFilters, 
  CreateTransferData, 
  UpdateTransferData,
  ApiResponse,
  PaginatedResponse
} from '../types'

// API layer for transfer operations
export class TransferApi {
  // Get all transfers with filtering
  static async getTransfers(filters: TransferFilters = {}): Promise<PaginatedResponse<Transfer>> {
    try {
      return await TransferService.getTransfers(filters)
    } catch (error) {
      console.error('Error fetching transfers:', error)
      return {
        success: false,
        error: 'Failed to fetch transfers',
        data: [],
        pagination: { page: 1, limit: 10, total: 0, totalPages: 0 }
      }
    }
  }

  // Get single transfer
  static async getTransfer(id: string): Promise<ApiResponse<Transfer>> {
    try {
      const transfer = await TransferService.getTransferById(id)
      if (!transfer) {
        return {
          success: false,
          error: 'Transfer not found'
        }
      }
      return {
        success: true,
        data: transfer
      }
    } catch (error) {
      console.error('Error fetching transfer:', error)
      return {
        success: false,
        error: 'Failed to fetch transfer'
      }
    }
  }

  // Create new transfer
  static async createTransfer(data: Omit<CreateTransferData, 'transfer_id'>): Promise<ApiResponse<Transfer>> {
    try {
      // Generate unique transfer ID
      const transferId = await DatabaseUtils.generateUniqueTransferId()
      
      const transferData = {
        transfer_id: transferId,
        ...data
      }

      const transfer = await TransferService.createTransfer(transferData)
      return {
        success: true,
        data: transfer,
        message: 'Transfer created successfully'
      }
    } catch (error) {
      console.error('Error creating transfer:', error)
      return {
        success: false,
        error: 'Failed to create transfer'
      }
    }
  }

  // Update transfer
  static async updateTransfer(id: string, data: UpdateTransferData): Promise<ApiResponse<Transfer>> {
    try {
      const transfer = await TransferService.updateTransfer(id, data)
      if (!transfer) {
        return {
          success: false,
          error: 'Transfer not found'
        }
      }
      return {
        success: true,
        data: transfer,
        message: 'Transfer updated successfully'
      }
    } catch (error) {
      console.error('Error updating transfer:', error)
      return {
        success: false,
        error: 'Failed to update transfer'
      }
    }
  }

  // Delete transfer
  static async deleteTransfer(id: string): Promise<ApiResponse<boolean>> {
    try {
      const success = await TransferService.deleteTransfer(id)
      return {
        success,
        data: success,
        message: success ? 'Transfer deleted successfully' : 'Transfer not found'
      }
    } catch (error) {
      console.error('Error deleting transfer:', error)
      return {
        success: false,
        error: 'Failed to delete transfer'
      }
    }
  }

  // Get transfer statistics
  static async getTransferStats(): Promise<ApiResponse<any>> {
    try {
      const stats = await TransferService.getTransferStats()
      return {
        success: true,
        data: stats
      }
    } catch (error) {
      console.error('Error fetching transfer stats:', error)
      return {
        success: false,
        error: 'Failed to fetch transfer statistics'
      }
    }
  }

  // Get transfer parties
  static async getTransferParties(transferId: string): Promise<ApiResponse<Party[]>> {
    try {
      const parties = await TransferService.getTransferParties(transferId)
      return {
        success: true,
        data: parties
      }
    } catch (error) {
      console.error('Error fetching transfer parties:', error)
      return {
        success: false,
        error: 'Failed to fetch transfer parties'
      }
    }
  }

  // Add party to transfer
  static async addParty(data: {
    transfer_id: string
    name: string
    type: 'buyer' | 'seller'
    id_number?: string
    registration_number?: string
    email?: string
    phone?: string
    address?: string
  }): Promise<ApiResponse<Party>> {
    try {
      const party = await TransferService.createParty(data)
      return {
        success: true,
        data: party,
        message: 'Party added successfully'
      }
    } catch (error) {
      console.error('Error adding party:', error)
      return {
        success: false,
        error: 'Failed to add party'
      }
    }
  }

  // Update party
  static async updateParty(id: string, data: {
    name?: string
    email?: string
    phone?: string
    address?: string
  }): Promise<ApiResponse<Party>> {
    try {
      const party = await TransferService.updateParty(id, data)
      if (!party) {
        return {
          success: false,
          error: 'Party not found'
        }
      }
      return {
        success: true,
        data: party,
        message: 'Party updated successfully'
      }
    } catch (error) {
      console.error('Error updating party:', error)
      return {
        success: false,
        error: 'Failed to update party'
      }
    }
  }

  // Remove party
  static async removeParty(id: string): Promise<ApiResponse<boolean>> {
    try {
      const success = await TransferService.deleteParty(id)
      return {
        success,
        data: success,
        message: success ? 'Party removed successfully' : 'Party not found'
      }
    } catch (error) {
      console.error('Error removing party:', error)
      return {
        success: false,
        error: 'Failed to remove party'
      }
    }
  }

  // Get transfer documents
  static async getTransferDocuments(transferId: string): Promise<ApiResponse<Document[]>> {
    try {
      const documents = await TransferService.getTransferDocuments(transferId)
      return {
        success: true,
        data: documents
      }
    } catch (error) {
      console.error('Error fetching transfer documents:', error)
      return {
        success: false,
        error: 'Failed to fetch transfer documents'
      }
    }
  }

  // Add document to transfer
  static async addDocument(data: {
    transfer_id: string
    name: string
    file_path?: string
    file_size?: number
    file_type?: string
    category?: string
  }): Promise<ApiResponse<Document>> {
    try {
      const document = await TransferService.createDocument(data)
      return {
        success: true,
        data: document,
        message: 'Document added successfully'
      }
    } catch (error) {
      console.error('Error adding document:', error)
      return {
        success: false,
        error: 'Failed to add document'
      }
    }
  }

  // Update document status
  static async updateDocumentStatus(id: string, status: string): Promise<ApiResponse<Document>> {
    try {
      const document = await TransferService.updateDocumentStatus(id, status)
      if (!document) {
        return {
          success: false,
          error: 'Document not found'
        }
      }
      return {
        success: true,
        data: document,
        message: 'Document status updated successfully'
      }
    } catch (error) {
      console.error('Error updating document status:', error)
      return {
        success: false,
        error: 'Failed to update document status'
      }
    }
  }

  // Remove document
  static async removeDocument(id: string): Promise<ApiResponse<boolean>> {
    try {
      const success = await TransferService.deleteDocument(id)
      return {
        success,
        data: success,
        message: success ? 'Document removed successfully' : 'Document not found'
      }
    } catch (error) {
      console.error('Error removing document:', error)
      return {
        success: false,
        error: 'Failed to remove document'
      }
    }
  }

  // Global search
  static async searchAll(searchTerm: string): Promise<ApiResponse<{
    transfers: Transfer[]
    parties: Party[]
    documents: Document[]
  }>> {
    try {
      const results = await DatabaseUtils.globalSearch(searchTerm)
      return {
        success: true,
        data: results
      }
    } catch (error) {
      console.error('Error performing search:', error)
      return {
        success: false,
        error: 'Failed to perform search'
      }
    }
  }
}

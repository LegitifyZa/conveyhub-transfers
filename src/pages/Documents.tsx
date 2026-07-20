import React, { useEffect, useState } from 'react'
import { 
  Search, 
  Filter, 
  Upload, 
  FileText,
  Download,
  Eye,
  Trash2,
  Calendar,
  User
} from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui'
import { Button } from '@/components/ui'
import { Input } from '@/components/ui'
import { apiRequest } from '@/lib/api/http'

interface DocumentEntry {
  id: string
  name: string
  category: string
  status: string
  fileSize: number | null
  uploadedBy: string | null
  uploadedAt: string | null
  transferReference: string | null
  buyerName: string | null
}

const Documents: React.FC = () => {
  const [documents, setDocuments] = useState<DocumentEntry[]>([])
  const [total, setTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')

  const loadDocuments = async (search = '') => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      const result = await apiRequest<{ success: boolean; data: DocumentEntry[]; total: number }>(`/api/documents${params.toString() ? `?${params}` : ''}`)
      setDocuments(result.data || [])
      setTotal(result.total || 0)
    } catch {
      setDocuments([])
      setTotal(0)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadDocuments(searchTerm)
  }, [searchTerm])

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return '—'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'verified':
        return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300'
      case 'uploaded':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300'
      case 'pending':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300'
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-300'
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Documents</h1>
          <p className="text-gray-600 dark:text-gray-400">Manage and organize all legal documents</p>
        </div>
        <Button>
          <Upload className="h-4 w-4 mr-2" />
          Upload Document
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search documents..."
                  className="pl-10"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm">
                <Filter className="h-4 w-4 mr-2" />
                Filter
              </Button>
              <Button variant="outline" size="sm">
                Category
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Documents Grid */}
      {isLoading ? (
        <p className="text-center text-gray-500 py-8">Loading documents...</p>
      ) : documents.length === 0 ? (
        <p className="text-center text-gray-500 py-8">No documents found.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {documents.map((doc) => (
            <Card key={doc.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center space-x-3">
                    <FileText className="h-5 w-5 text-gray-400" />
                    <div>
                      <h3 className="font-medium text-gray-900 dark:text-gray-100 text-sm line-clamp-1">
                        {doc.name}
                      </h3>
                      <p className="text-xs text-gray-500">{formatFileSize(doc.fileSize)}</p>
                    </div>
                  </div>
                  <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(doc.status)}`}>
                    {doc.status}
                  </span>
                </div>

                <div className="space-y-2 text-xs text-gray-500 dark:text-gray-400">
                  {doc.buyerName && (
                    <div className="flex items-center space-x-2">
                      <User className="h-3 w-3" />
                      <span>{doc.buyerName}</span>
                    </div>
                  )}
                  {doc.uploadedAt && (
                    <div className="flex items-center space-x-2">
                      <Calendar className="h-3 w-3" />
                      <span>{new Date(doc.uploadedAt).toISOString().split('T')[0]}</span>
                    </div>
                  )}
                  {doc.category && (
                    <div>
                      <span className="font-medium">Category:</span> {doc.category}
                    </div>
                  )}
                  {doc.transferReference && (
                    <div>
                      <span className="font-medium">Transfer:</span> {doc.transferReference}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100 dark:border-navy-800">
                  <div className="flex space-x-1">
                    <Button variant="ghost" size="sm">
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm">
                      <Download className="h-4 w-4" />
                    </Button>
                  </div>
                  <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Storage Stats */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Storage Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{total}</div>
              <div className="text-sm text-gray-500 dark:text-gray-400">Total Documents</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export { Documents }

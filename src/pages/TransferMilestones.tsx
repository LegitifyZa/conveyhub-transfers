import React, { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Clock, Circle, AlertCircle, Calendar, Building, User, ChevronDown, ChevronUp, History, FileText } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent, Modal } from '@/components/ui'
import { Button } from '@/components/ui'
import { Badge } from '@/components/ui'
import { useTransfers, TransferAggregate } from '@/hooks/useTransfers'
import type { Party } from '@/components/transfers/TransferForm'

export type MilestoneStatus = 'not_started' | 'in_progress' | 'completed' | 'overdue' | 'not_required'

export interface Milestone {
  id: string
  name: string
  statusLabel: string
  status: MilestoneStatus
  completedDate?: string
  dueDate?: string
  notes?: string
}

interface AuditEntry {
  id: string
  user: string
  action: string
  timestamp: string
}

const CURRENT_USER = 'John Doe'

const INITIAL_MILESTONES: Milestone[] = [
  { id: '1', name: 'Transferor', statusLabel: 'FICA Received', status: 'not_started' },
  { id: '2', name: 'Transferee', statusLabel: 'FICA Received', status: 'not_started' },
  { id: '3', name: 'Guarantees', statusLabel: 'Guarantee/s Due Date', status: 'not_started' },
  { id: '4', name: 'Transfer Duty', statusLabel: 'Applied', status: 'not_started' },
  { id: '5', name: 'Rates', statusLabel: 'Figures Requested', status: 'not_started' },
  { id: '6', name: 'Levies', statusLabel: 'Figures Requested', status: 'not_started' },
  { id: '7', name: 'Home Owners', statusLabel: 'Consent Requested', status: 'not_started' },
  { id: '8', name: 'Electrical', statusLabel: 'Certificate Requested', status: 'not_started' },
  { id: '9', name: 'Entomologist', statusLabel: 'Certificate Requested', status: 'not_started' },
  { id: '10', name: 'Electric Fence', statusLabel: 'Certificate Received', status: 'not_started' },
  { id: '11', name: 'Gas Conformity', statusLabel: 'Certificate Requested', status: 'not_started' },
  { id: '12', name: 'Plumbing', statusLabel: 'Certificate Requested', status: 'not_started' },
  { id: '13', name: 'Instruction', statusLabel: 'Instruction received', status: 'not_started' },
  { id: '14', name: 'Deposit', statusLabel: 'Deposit Due', status: 'not_started' },
  { id: '15', name: 'New Bond', statusLabel: 'Bond Grant Due', status: 'not_started' },
  { id: '16', name: 'Subject to Sale', statusLabel: 'Due Date', status: 'not_started' },
  { id: '17', name: "Suspensive Cond's", statusLabel: 'All Conditions met', status: 'not_started' },
  { id: '18', name: 'Bond Cancellation', statusLabel: 'Figures Requested', status: 'not_started' },
  { id: '19', name: 'Title Deed', statusLabel: 'Title Deed Requested', status: 'not_started' },
  { id: '20', name: 'Transfer Costs', statusLabel: 'Proforma Sent', status: 'not_started' },
  { id: '21', name: 'FICA', statusLabel: 'Certified', status: 'not_started' },
  { id: '22', name: 'Pool', statusLabel: 'Certificate Requested', status: 'not_started' },
  { id: '23', name: 'Transfer Registration Complete', statusLabel: '5 days after reg', status: 'not_started' }
]

interface PartyDetails {
  fullName: string
  idNumber: string
  email: string
  phone: string
  address: string
}

interface TransferDetails {
  id: string
  property: {
    address: string
    city: string
    province: string
    postalCode: string
    propertyType: string
    erfNumber: string
    legalDescription: string
  }
  buyer: PartyDetails
  seller: PartyDetails
  purchasePrice: number
  createdDate: string
}

const emptyDetails = (id: string): TransferDetails => ({
  id,
  property: { address: '', city: '', province: '', postalCode: '', propertyType: '', erfNumber: '', legalDescription: '' },
  buyer: { fullName: '', idNumber: '', email: '', phone: '', address: '' },
  seller: { fullName: '', idNumber: '', email: '', phone: '', address: '' },
  purchasePrice: 0,
  createdDate: '—'
})

function mapAggregateToDetails(aggregate: TransferAggregate | null): TransferDetails {
  if (!aggregate) return emptyDetails('—')
  const buyer = aggregate.parties?.find(p => p.type === 'buyer')
  const seller = aggregate.parties?.find(p => p.type === 'seller')
  return {
    id: aggregate.transfer_id || aggregate.id || '—',
    property: {
      address: aggregate.propertyDetails?.address || '',
      city: aggregate.propertyDetails?.city || '',
      province: aggregate.propertyDetails?.state || '',
      postalCode: aggregate.propertyDetails?.zipCode || '',
      propertyType: aggregate.propertyDetails?.propertyType || '',
      erfNumber: aggregate.propertyDetails?.lotNumber || '',
      legalDescription: aggregate.propertyDetails?.legalDescription || ''
    },
    buyer: {
      fullName: buyer?.name || '',
      idNumber: buyer?.idNumber || '',
      email: buyer?.email || '',
      phone: buyer?.phone || '',
      address: buyer?.address || ''
    },
    seller: {
      fullName: seller?.name || '',
      idNumber: seller?.idNumber || '',
      email: seller?.email || '',
      phone: seller?.phone || '',
      address: seller?.address || ''
    },
    purchasePrice: parseFloat(aggregate.financials?.purchasePrice || '0') || 0,
    createdDate: aggregate.created_at
      ? new Date(aggregate.created_at).toISOString().split('T')[0]
      : '—'
  }
}

function detailsToAggregate(base: TransferAggregate, details: TransferDetails): TransferAggregate {
  const updateParty = (type: 'buyer' | 'seller', detailsParty: PartyDetails): Party => {
    const existing = base.parties?.find(p => p.type === type)
    return {
      id: existing?.id || crypto.randomUUID(),
      type,
      name: detailsParty.fullName,
      idNumber: detailsParty.idNumber,
      email: detailsParty.email,
      phone: detailsParty.phone,
      address: detailsParty.address,
      company: existing?.company,
      role: existing?.role,
      isPrimary: existing?.isPrimary ?? (type === 'buyer' ? true : undefined)
    }
  }

  return {
    ...base,
    propertyDetails: {
      ...base.propertyDetails,
      address: details.property.address,
      city: details.property.city,
      state: details.property.province,
      zipCode: details.property.postalCode,
      propertyType: details.property.propertyType,
      lotNumber: details.property.erfNumber,
      legalDescription: details.property.legalDescription
    },
    parties: [
      updateParty('buyer', details.buyer),
      updateParty('seller', details.seller),
      ...(base.parties?.filter(p => p.type !== 'buyer' && p.type !== 'seller') || [])
    ],
    financials: {
      ...base.financials,
      purchasePrice: String(details.purchasePrice)
    }
  }
}

const TransferMilestones: React.FC = () => {
  const { transferId } = useParams<{ transferId: string }>()
  const navigate = useNavigate()
  const resolvedTransferId = transferId || ''

  const {
    currentTransfer,
    currentMilestones,
    activity,
    isLoading,
    error,
    fetchTransfer,
    fetchMilestones,
    updateMilestones,
    fetchActivity,
    updateTransfer
  } = useTransfers()

  const [milestones, setMilestones] = useState<Milestone[]>(INITIAL_MILESTONES)
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([])
  const [expandedMilestone, setExpandedMilestone] = useState<string | null>(null)
  const [isDetailsExpanded, setIsDetailsExpanded] = useState(false)
  const [transfer, setTransfer] = useState<TransferDetails>(() => emptyDetails(resolvedTransferId))
  const [isSaving, setIsSaving] = useState(false)
  const noteValuesAtFocus = useRef(new Map<string, string>())

  // Load transfer, milestones and activity from the backend.
  useEffect(() => {
    if (!resolvedTransferId) return
    let cancelled = false
    const load = async () => {
      await Promise.all([
        fetchTransfer(resolvedTransferId),
        fetchMilestones(resolvedTransferId),
        fetchActivity(resolvedTransferId)
      ])
      if (cancelled) return
    }
    load()
    return () => { cancelled = true }
  }, [resolvedTransferId, fetchTransfer, fetchMilestones, fetchActivity])

  // Keep local state in sync with hook state returned from the API.
  useEffect(() => {
    setTransfer(mapAggregateToDetails(currentTransfer))
  }, [currentTransfer])

  useEffect(() => {
    if (currentMilestones.length > 0) {
      setMilestones(currentMilestones)
    }
  }, [currentMilestones])

  useEffect(() => {
    if (activity.length > 0) {
      setAuditEntries(activity)
    }
  }, [activity])

  const completedCount = milestones.filter(m => m.status === 'completed').length
  const inProgressCount = milestones.filter(m => m.status === 'in_progress').length
  const notRequiredCount = milestones.filter(m => m.status === 'not_required').length
  const requiredMilestoneCount = milestones.length - notRequiredCount
  const remainingCount = requiredMilestoneCount - completedCount - inProgressCount
  const progress = requiredMilestoneCount > 0 ? Math.round((completedCount / requiredMilestoneCount) * 100) : 0

  const addAuditEntry = (action: string) => {
    setAuditEntries(prev => [
      {
        id: crypto.randomUUID(),
        user: CURRENT_USER,
        action,
        timestamp: new Date().toISOString()
      },
      ...prev
    ])
  }

  const persistMilestones = async (updatedMilestones: Milestone[]) => {
    if (!resolvedTransferId) return
    await updateMilestones(resolvedTransferId, updatedMilestones)
    await fetchActivity(resolvedTransferId)
  }

  const updatePropertyDetail = (field: keyof TransferDetails['property'], value: string) => {
    setTransfer(previous => ({ ...previous, property: { ...previous.property, [field]: value } }))
  }

  const updatePartyDetail = (party: 'buyer' | 'seller', field: keyof PartyDetails, value: string) => {
    setTransfer(previous => ({ ...previous, [party]: { ...previous[party], [field]: value } }))
  }

  const saveTransferDetails = async () => {
    if (!resolvedTransferId || !currentTransfer) {
      addAuditEntry('Updated transfer, property, buyer, or seller details.')
      setIsDetailsExpanded(false)
      return
    }
    setIsSaving(true)
    try {
      const updated = detailsToAggregate(currentTransfer, transfer)
      await updateTransfer(resolvedTransferId, updated)
      addAuditEntry('Updated transfer, property, buyer, or seller details.')
      setIsDetailsExpanded(false)
    } finally {
      setIsSaving(false)
    }
  }

  const updateMilestoneStatus = async (id: string, newStatus: MilestoneStatus) => {
    const milestone = milestones.find(item => item.id === id)
    if (!milestone || milestone.status === newStatus) return

    const updated = milestones.map(item =>
      item.id === id
        ? {
            ...item,
            status: newStatus,
            completedDate: newStatus === 'completed' ? new Date().toISOString().split('T')[0] : item.completedDate
          }
        : item
    )
    setMilestones(updated)
    addAuditEntry(`Changed ${milestone.name} status from ${getStatusText(milestone.status)} to ${getStatusText(newStatus)}.`)
    await persistMilestones(updated)
  }

  const updateMilestoneNotes = (id: string, notes: string) => {
    setMilestones(prev => prev.map(m =>
      m.id === id ? { ...m, notes } : m
    ))
  }

  const recordNotesUpdate = async (id: string, notes: string) => {
    const previousNotes = noteValuesAtFocus.current.get(id) || ''
    const milestone = milestones.find(item => item.id === id)
    if (milestone && previousNotes !== notes) {
      addAuditEntry(`${notes.trim() ? 'Updated' : 'Cleared'} notes for ${milestone.name}.`)
      await persistMilestones(milestones.map(m => m.id === id ? { ...m, notes } : m))
    }
    noteValuesAtFocus.current.delete(id)
  }

  const updateMilestoneDueDate = async (id: string, dueDate: string) => {
    const milestone = milestones.find(item => item.id === id)
    if (!milestone || (milestone.dueDate || '') === dueDate) return

    const updated = milestones.map(m =>
      m.id === id ? { ...m, dueDate } : m
    )
    setMilestones(updated)
    addAuditEntry(dueDate ? `Set the due date for ${milestone.name} to ${dueDate}.` : `Cleared the due date for ${milestone.name}.`)
    await persistMilestones(updated)
  }

  const getStatusIcon = (status: MilestoneStatus) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
      case 'in_progress':
        return <Clock className="h-5 w-5 text-blue-600 dark:text-blue-400" />
      case 'overdue':
        return <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
      case 'not_required':
        return <Circle className="h-5 w-5 text-violet-600 dark:text-violet-400" />
      default:
        return <Circle className="h-5 w-5 text-gray-400 dark:text-gray-500" />
    }
  }

  const getStatusBadgeVariant = (status: MilestoneStatus): 'success' | 'primary' | 'error' | 'default' => {
    switch (status) {
      case 'completed': return 'success'
      case 'in_progress': return 'primary'
      case 'overdue': return 'error'
      case 'not_required': return 'default'
      default: return 'default'
    }
  }

  const getStatusText = (status: MilestoneStatus) => {
    switch (status) {
      case 'completed': return 'Completed'
      case 'in_progress': return 'In Progress'
      case 'overdue': return 'Overdue'
      case 'not_required': return 'Not Required'
      default: return 'Not Started'
    }
  }

  const getRoadmapStatusColor = (status: MilestoneStatus) => {
    switch (status) {
      case 'completed': return { node: 'bg-green-500 text-white', stem: 'bg-green-500' }
      case 'in_progress': return { node: 'bg-blue-500 text-white', stem: 'bg-blue-500' }
      case 'overdue': return { node: 'bg-red-500 text-white', stem: 'bg-red-500' }
      case 'not_required': return { node: 'bg-violet-500 text-white', stem: 'bg-violet-500' }
      default: return { node: 'bg-gray-300 text-gray-700 dark:bg-gray-600 dark:text-gray-100', stem: 'bg-gray-300 dark:bg-gray-600' }
    }
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: 'ZAR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount)
  }

  const formatAuditTimestamp = (timestamp: string) => new Intl.DateTimeFormat('en-ZA', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(timestamp))

  const selectedMilestone = milestones.find(milestone => milestone.id === expandedMilestone)

  if (!resolvedTransferId) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-navy-900 flex items-center justify-center">
        <p className="text-gray-600 dark:text-gray-400">No transfer selected.</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-navy-900">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate('/transfers')}
            className="mb-4"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Transfers
          </Button>

          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
                Transfer Milestones
              </h1>
              <p className="text-gray-600 dark:text-gray-400">
                Track progress for {transfer.id}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => navigate('/documents')}>
              <FileText className="mr-2 h-4 w-4" />
              Documents
            </Button>
          </div>
        </div>

        {(error || isLoading) && (
          <div className={`mb-6 rounded-lg p-4 ${error ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800' : 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800'}`}>
            <p className={`text-sm ${error ? 'text-red-700 dark:text-red-300' : 'text-blue-700 dark:text-blue-300'}`}>
              {error ? error : 'Loading transfer milestones...'}
            </p>
          </div>
        )}

        {/* Transfer Summary */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="grid grid-cols-1 items-center gap-4 md:grid-cols-5">
              <div className="flex items-center space-x-2">
                <Building className="w-4 h-4 text-gray-400" />
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Property</p>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{transfer.property.address}, {transfer.property.city}</p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <User className="w-4 h-4 text-gray-400" />
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Buyer</p>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{transfer.buyer.fullName}</p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <User className="w-4 h-4 text-gray-400" />
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Seller</p>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{transfer.seller.fullName}</p>
                </div>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Purchase Price</p>
                <p className="text-sm font-bold text-gray-900 dark:text-gray-100">{formatCurrency(transfer.purchasePrice)}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setIsDetailsExpanded(current => !current)} disabled={isSaving}>
                {isDetailsExpanded ? <ChevronUp className="mr-2 h-4 w-4" /> : <ChevronDown className="mr-2 h-4 w-4" />}
                {isDetailsExpanded ? 'Hide Details' : 'View & Edit Details'}
              </Button>
            </div>

            {isDetailsExpanded && (
              <div className="mt-5 space-y-6 border-t border-gray-200 pt-5 dark:border-navy-700">
                <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
                  <div className="space-y-3">
                    <h2 className="font-semibold text-gray-900 dark:text-gray-100">Property Details</h2>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Street Address<input value={transfer.property.address} onChange={event => updatePropertyDetail('address', event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-navy-600 dark:bg-navy-700 dark:text-gray-100" /></label>
                    <div className="grid grid-cols-2 gap-3"><label className="block text-xs font-medium text-gray-700 dark:text-gray-300">City<input value={transfer.property.city} onChange={event => updatePropertyDetail('city', event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-navy-600 dark:bg-navy-700 dark:text-gray-100" /></label><label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Province<input value={transfer.property.province} onChange={event => updatePropertyDetail('province', event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-navy-600 dark:bg-navy-700 dark:text-gray-100" /></label></div>
                    <div className="grid grid-cols-2 gap-3"><label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Postal Code<input value={transfer.property.postalCode} onChange={event => updatePropertyDetail('postalCode', event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-navy-600 dark:bg-navy-700 dark:text-gray-100" /></label><label className="block text-xs font-medium text-gray-700 dark:text-gray-300">ERF Number<input value={transfer.property.erfNumber} onChange={event => updatePropertyDetail('erfNumber', event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-navy-600 dark:bg-navy-700 dark:text-gray-100" /></label></div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Property Type<input value={transfer.property.propertyType} onChange={event => updatePropertyDetail('propertyType', event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-navy-600 dark:bg-navy-700 dark:text-gray-100" /></label>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Purchase Price<input type="number" min="0" value={transfer.purchasePrice} onChange={event => setTransfer(previous => ({ ...previous, purchasePrice: Number(event.target.value) || 0 }))} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-navy-600 dark:bg-navy-700 dark:text-gray-100" /></label>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Legal Description<textarea value={transfer.property.legalDescription} onChange={event => updatePropertyDetail('legalDescription', event.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-navy-600 dark:bg-navy-700 dark:text-gray-100" /></label>
                  </div>
                  {(['buyer', 'seller'] as const).map(party => <div key={party} className="space-y-3"><h2 className="font-semibold capitalize text-gray-900 dark:text-gray-100">{party} Details</h2><label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Full Name<input value={transfer[party].fullName} onChange={event => updatePartyDetail(party, 'fullName', event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-navy-600 dark:bg-navy-700 dark:text-gray-100" /></label><label className="block text-xs font-medium text-gray-700 dark:text-gray-300">ID / Registration Number<input value={transfer[party].idNumber} onChange={event => updatePartyDetail(party, 'idNumber', event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-navy-600 dark:bg-navy-700 dark:text-gray-100" /></label><label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Email<input type="email" value={transfer[party].email} onChange={event => updatePartyDetail(party, 'email', event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-navy-600 dark:bg-navy-700 dark:text-gray-100" /></label><label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Phone<input value={transfer[party].phone} onChange={event => updatePartyDetail(party, 'phone', event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-navy-600 dark:bg-navy-700 dark:text-gray-100" /></label><label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Address<textarea value={transfer[party].address} onChange={event => updatePartyDetail(party, 'address', event.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-navy-600 dark:bg-navy-700 dark:text-gray-100" /></label></div>)}
                </div>
                <div className="flex justify-end"><Button onClick={saveTransferDetails} disabled={isSaving}>{isSaving ? 'Saving...' : 'Save Details'}</Button></div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Progress Overview */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-5 mb-6">
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-teal-600 dark:text-teal-400">{progress}%</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Overall Progress</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-green-600 dark:text-green-400">{completedCount}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Completed</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{inProgressCount}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">In Progress</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-gray-600 dark:text-gray-400">{remainingCount}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Remaining</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-violet-600 dark:text-violet-400">{notRequiredCount}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Not Required</p>
            </CardContent>
          </Card>
        </div>

        {/* Progress Bar */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Milestone Progress</span>
              <span className="text-sm text-gray-600 dark:text-gray-400">{completedCount} of {requiredMilestoneCount} required milestones completed</span>
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
              <div
                className="bg-teal-600 h-3 rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </CardContent>
        </Card>

        {/* Milestones List */}
        <Card className="mb-6 overflow-hidden">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Calendar className="h-5 w-5 text-teal-600 dark:text-teal-400" />
              <span>Milestone Roadmap</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative grid grid-cols-1 gap-y-5 md:grid-cols-2 xl:grid-cols-3 xl:gap-x-8 xl:gap-y-10">
              {milestones.map((milestone, index) => {
                const colors = getRoadmapStatusColor(milestone.status)
                return (
                  <div key={milestone.id} className="relative min-h-36">
                    {index < milestones.length - 1 && <div className="absolute left-7 right-0 top-7 hidden border-t-4 border-dotted border-gray-300 xl:block dark:border-navy-600" />}
                    <button type="button" onClick={() => setExpandedMilestone(milestone.id)} className="relative z-10 flex w-full items-start gap-4 text-left group">
                      <div className="flex w-14 shrink-0 flex-col items-center">
                        <span className={`flex h-14 w-14 items-center justify-center rounded-full text-lg font-semibold shadow-sm ring-4 ring-white transition-transform duration-200 group-hover:scale-110 dark:ring-navy-800 ${colors.node}`}>{index + 1}</span>
                        <span className={`mt-0.5 h-20 w-1 rounded-full ${colors.stem}`} />
                      </div>
                      <div className="min-w-0 rounded-xl bg-white px-3 py-2 transition-shadow duration-200 group-hover:shadow-md dark:bg-navy-800">
                        <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Milestone {index + 1}</p>
                        <p className="mt-1 font-semibold text-gray-900 dark:text-gray-100">{milestone.name}</p>
                        <div className="mt-1 flex items-center gap-2"><p className="text-sm text-gray-600 dark:text-gray-400">{milestone.statusLabel}</p>{getStatusIcon(milestone.status)}</div>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <Badge variant={getStatusBadgeVariant(milestone.status)} size="sm" className={milestone.status === 'not_required' ? 'bg-violet-100 text-violet-800 dark:bg-violet-900/20 dark:text-violet-300' : undefined}>{getStatusText(milestone.status)}</Badge>
                          <span className="text-xs text-gray-500 dark:text-gray-400">Due: {milestone.dueDate || 'Not set'}</span>
                        </div>
                      </div>
                    </button>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>

        {/* Expanded Content */}
        <Modal isOpen={!!selectedMilestone} onClose={() => setExpandedMilestone(null)} title={selectedMilestone ? `Edit ${selectedMilestone.name}` : ''} description={selectedMilestone?.statusLabel} size="md">
          {selectedMilestone && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">Status</label>
                  <select value={selectedMilestone.status} onChange={(event) => updateMilestoneStatus(selectedMilestone.id, event.target.value as MilestoneStatus)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 transition-all duration-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500 dark:border-navy-600 dark:bg-navy-700 dark:text-gray-100">
                    <option value="not_started">Not Started</option>
                    <option value="in_progress">In Progress</option>
                    <option value="completed">Completed</option>
                    <option value="overdue">Overdue</option>
                    <option value="not_required">Not Required</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">Due Date & Time</label>
                  <input type="datetime-local" value={selectedMilestone.dueDate || ''} onChange={(event) => updateMilestoneDueDate(selectedMilestone.id, event.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 transition-all duration-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500 dark:border-navy-600 dark:bg-navy-700 dark:text-gray-100" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">Description</label>
                <textarea value={selectedMilestone.notes || ''} onChange={(event) => updateMilestoneNotes(selectedMilestone.id, event.target.value)} onFocus={(event) => noteValuesAtFocus.current.set(selectedMilestone.id, event.currentTarget.value)} onBlur={(event) => recordNotesUpdate(selectedMilestone.id, event.currentTarget.value)} placeholder="Add notes for this milestone..." rows={4} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 transition-all duration-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500 dark:border-navy-600 dark:bg-navy-700 dark:text-gray-100" />
              </div>
              {selectedMilestone.completedDate && <p className="text-xs text-green-600 dark:text-green-400">Completed on {selectedMilestone.completedDate}</p>}
              <div className="flex justify-end"><Button onClick={() => setExpandedMilestone(null)}>Done</Button></div>
            </div>
          )}
        </Modal>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <History className="h-5 w-5 text-teal-600 dark:text-teal-400" />
              <span>Audit Trail</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {auditEntries.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">No milestone updates have been recorded yet.</p>
            ) : (
              <div className="space-y-4">
                {auditEntries.map((entry) => (
                  <div key={entry.id} className="flex items-start justify-between gap-4 border-b border-gray-100 pb-4 last:border-0 last:pb-0 dark:border-navy-700">
                    <div className="flex items-start space-x-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300">
                        <User className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{entry.user}</p>
                        <p className="text-sm text-gray-600 dark:text-gray-400">{entry.action}</p>
                      </div>
                    </div>
                    <time className="shrink-0 text-xs text-gray-500 dark:text-gray-400" dateTime={entry.timestamp}>
                      {formatAuditTimestamp(entry.timestamp)}
                    </time>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export { TransferMilestones }

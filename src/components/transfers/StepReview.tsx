import React from 'react'
import { useLocation } from 'react-router-dom'
import { Home, Users, DollarSign, FileText, CheckCircle, Edit3, Star } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui'
import { Button } from '@/components/ui'
import { Badge } from '@/components/ui'
import { useTransfer, formatCurrency, getProgressPercentage, Document } from './TransferForm'

interface ReviewSectionProps {
  title: string
  icon: React.ReactNode
  onEdit: () => void
  children: React.ReactNode
}

const ReviewSection: React.FC<ReviewSectionProps> = ({ title, icon, onEdit, children }) => (
  <Card variant="premium" className="hover:shadow-premium transition-all duration-200">
    <CardHeader>
      <div className="flex items-center justify-between">
        <CardTitle className="flex items-center space-x-2">
          {icon}
          <span>{title}</span>
        </CardTitle>
        <Button
          variant="secondary"
          size="sm"
          onClick={onEdit}
          className="text-teal-600 hover:text-teal-700 hover:bg-teal-50 dark:hover:bg-teal-900/20"
        >
          <Edit3 className="h-4 w-4 mr-1" />
          Edit
        </Button>
      </div>
    </CardHeader>
    <CardContent>
      {children}
    </CardContent>
  </Card>
)

const StepReview: React.FC = () => {
  const { state, dispatch } = useTransfer()
  const { propertyDetails, parties, financials, documents } = state
  const location = useLocation()
  const goldenRecord = location.state?.goldenRecord

  const goToStep = (step: number) => {
    dispatch({ type: 'SET_CURRENT_STEP', payload: step })
  }

  const buyers = parties.filter(p => p.type === 'buyer')
  const sellers = parties.filter(p => p.type === 'seller')
  const primaryBuyer = buyers.find(p => p.isPrimary)

  const costs = {
    purchasePrice: parseFloat(financials.purchasePrice) || 0,
    depositAmount: parseFloat(financials.depositAmount) || 0,
    loanAmount: parseFloat(financials.loanAmount) || 0,
    transferDuty: parseFloat(financials.transferDuty) || 0,
    conveyancingFees: parseFloat(financials.conveyancingFees) || 0,
    deedsOfficeFees: parseFloat(financials.deedsOfficeFees) || 0,
    vat: parseFloat(financials.vat) || 0,
    postPetty: parseFloat(financials.postPetty) || 0,
    clearanceCertificate: parseFloat(financials.clearanceCertificate) || 0,
    ratesClearance: parseFloat(financials.ratesClearance) || 0
  }

  const totalCosts = costs.transferDuty + costs.conveyancingFees + costs.deedsOfficeFees + costs.vat + costs.postPetty + costs.clearanceCertificate + costs.ratesClearance
  const ltvRatio = costs.purchasePrice > 0 ? ((costs.loanAmount / costs.purchasePrice) * 100).toFixed(1) : '0.0'

  const renderPropertyDetails = () => (
    <div className="space-y-4">
      {goldenRecord && (
        <div className="bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 rounded-lg p-3">
          <p className="text-sm text-teal-800 dark:text-teal-200">
            <span className="font-medium">Golden Record:</span> {goldenRecord.name}
          </p>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Street Address</p>
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{propertyDetails.address || '-'}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">City</p>
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{propertyDetails.city || '-'}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Province</p>
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{propertyDetails.state || '-'}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Postal Code</p>
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{propertyDetails.zipCode || '-'}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Property Type</p>
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{propertyDetails.propertyType || '-'}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Lot Number</p>
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{propertyDetails.lotNumber || '-'}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Year Built</p>
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{propertyDetails.yearBuilt || '-'}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Square Meterage</p>
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{propertyDetails.squareFootage || '-'}</p>
        </div>
      </div>
      {propertyDetails.legalDescription && (
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Legal Description</p>
          <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">{propertyDetails.legalDescription}</p>
        </div>
      )}
    </div>
  )

  const renderParty = (party: typeof parties[0]) => (
    <div key={party.id} className="border-b border-gray-200 dark:border-navy-700 last:border-0 pb-3 last:pb-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="font-medium text-gray-900 dark:text-gray-100">{party.name || 'Unnamed Party'}</span>
          {party.isPrimary && (
            <Badge variant="warning" size="sm">
              <Star className="h-3 w-3 mr-1 fill-current" />
              Primary
            </Badge>
          )}
        </div>
        <Badge variant={party.type === 'buyer' ? 'primary' : 'success'} size="sm">
          {party.type}
        </Badge>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2 text-sm">
        {party.idNumber && (
          <p className="text-gray-600 dark:text-gray-400"><span className="font-medium">ID/Reg:</span> {party.idNumber}</p>
        )}
        {party.email && (
          <p className="text-gray-600 dark:text-gray-400"><span className="font-medium">Email:</span> {party.email}</p>
        )}
        {party.phone && (
          <p className="text-gray-600 dark:text-gray-400"><span className="font-medium">Phone:</span> {party.phone}</p>
        )}
        {party.company && (
          <p className="text-gray-600 dark:text-gray-400"><span className="font-medium">Company:</span> {party.company}</p>
        )}
        {party.role && (
          <p className="text-gray-600 dark:text-gray-400"><span className="font-medium">Role:</span> {party.role}</p>
        )}
        {party.address && (
          <p className="text-gray-600 dark:text-gray-400 md:col-span-2"><span className="font-medium">Address:</span> {party.address}</p>
        )}
      </div>
    </div>
  )

  const renderParties = () => (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Buyers ({buyers.length})
        </p>
        {buyers.length > 0 ? (
          <div className="space-y-3">
            {buyers.map(renderParty)}
          </div>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400">No buyers added</p>
        )}
      </div>
      <div>
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Sellers ({sellers.length})
        </p>
        {sellers.length > 0 ? (
          <div className="space-y-3">
            {sellers.map(renderParty)}
          </div>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400">No sellers added</p>
        )}
      </div>
      {primaryBuyer && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
          <p className="text-sm text-blue-800 dark:text-blue-200">
            <span className="font-medium">Primary Buyer:</span> {primaryBuyer.name}
          </p>
        </div>
      )}
    </div>
  )

  const renderFinancials = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Purchase Price</p>
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{formatCurrency(financials.purchasePrice)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Deposit Amount</p>
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{formatCurrency(financials.depositAmount)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Loan Amount</p>
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{formatCurrency(financials.loanAmount)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Interest Rate</p>
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{financials.interestRate ? `${financials.interestRate}%` : '-'}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Loan Term</p>
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{financials.loanTerm ? `${financials.loanTerm} years` : '-'}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">LTV Ratio</p>
          <p className="text-sm font-medium text-teal-600 dark:text-teal-400">{ltvRatio}%</p>
        </div>
      </div>

      <div className="border-t border-gray-200 dark:border-navy-700 pt-4">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Transfer Costs</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-600 dark:text-gray-400">Transfer Duty</span>
            <span className="font-medium text-gray-900 dark:text-gray-100">{formatCurrency(financials.transferDuty)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600 dark:text-gray-400">Conveyancing Fees</span>
            <span className="font-medium text-gray-900 dark:text-gray-100">{formatCurrency(financials.conveyancingFees)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600 dark:text-gray-400">Deeds Office Fees</span>
            <span className="font-medium text-gray-900 dark:text-gray-100">{formatCurrency(financials.deedsOfficeFees)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600 dark:text-gray-400">VAT</span>
            <span className="font-medium text-gray-900 dark:text-gray-100">{formatCurrency(financials.vat)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600 dark:text-gray-400">Post & Petty</span>
            <span className="font-medium text-gray-900 dark:text-gray-100">{formatCurrency(financials.postPetty)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600 dark:text-gray-400">Clearance Certificate</span>
            <span className="font-medium text-gray-900 dark:text-gray-100">{formatCurrency(financials.clearanceCertificate)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600 dark:text-gray-400">Rates Clearance</span>
            <span className="font-medium text-gray-900 dark:text-gray-100">{formatCurrency(financials.ratesClearance)}</span>
          </div>
        </div>
        <div className="flex justify-between border-t border-gray-200 dark:border-navy-700 mt-2 pt-2">
          <span className="font-medium text-gray-900 dark:text-gray-100">Total Estimated Costs</span>
          <span className="font-bold text-teal-600 dark:text-teal-400">{formatCurrency(totalCosts)}</span>
        </div>
      </div>
    </div>
  )

  const renderDocuments = () => (
    <div className="space-y-4">
      {documents.length > 0 ? (
        <div className="space-y-3">
          {documents.map((doc: Document) => (
            <div key={doc.id} className="flex items-start justify-between border-b border-gray-200 dark:border-navy-700 last:border-0 pb-3 last:pb-0">
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <FileText className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                  <span className="font-medium text-gray-900 dark:text-gray-100">{doc.name}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Badge
                    variant={doc.status === 'verified' ? 'success' : doc.status === 'uploaded' ? 'warning' : 'default'}
                    size="sm"
                  >
                    {doc.status}
                  </Badge>
                </div>
                {doc.description && (
                  <p className="text-sm text-gray-600 dark:text-gray-400">{doc.description}</p>
                )}
                {doc.uploadDate && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Uploaded {new Date(doc.uploadDate).toLocaleDateString()}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-500 dark:text-gray-400">No documents uploaded</p>
      )}
    </div>
  )

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-right-5 duration-500">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Review & Submit
        </h2>
        <p className="text-gray-600 dark:text-gray-400">
          Review all the information before submitting the transfer
        </p>
      </div>

      <Card variant="glass">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <CheckCircle className="h-5 w-5 text-teal-600 dark:text-teal-400" />
              <span className="font-medium text-gray-900 dark:text-gray-100">Overall Progress</span>
            </div>
            <span className="font-bold text-teal-600 dark:text-teal-400">{getProgressPercentage(state)}%</span>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <ReviewSection
          title="Property Details"
          icon={<Home className="h-5 w-5 text-teal-600 dark:text-teal-400" />}
          onEdit={() => goToStep(1)}
        >
          {renderPropertyDetails()}
        </ReviewSection>

        <ReviewSection
          title="Parties Information"
          icon={<Users className="h-5 w-5 text-teal-600 dark:text-teal-400" />}
          onEdit={() => goToStep(2)}
        >
          {renderParties()}
        </ReviewSection>

        <ReviewSection
          title="Financial Information"
          icon={<DollarSign className="h-5 w-5 text-teal-600 dark:text-teal-400" />}
          onEdit={() => goToStep(3)}
        >
          {renderFinancials()}
        </ReviewSection>

        <ReviewSection
          title="Documents"
          icon={<FileText className="h-5 w-5 text-teal-600 dark:text-teal-400" />}
          onEdit={() => goToStep(4)}
        >
          {renderDocuments()}
        </ReviewSection>
      </div>
    </div>
  )
}

export { StepReview }

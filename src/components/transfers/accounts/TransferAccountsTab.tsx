import React, { useState, useEffect } from 'react'
import { 
  RefreshCw, 
  CheckCircle
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui'
import { 
  ProformaStatementData, 
  FirmAccountSettings, 
  DEFAULT_FIRM_SETTINGS,
  formatZAR 
} from '@/utils/conveyancingAccounts'
import { AccountsApi } from '@/lib/api/accountsApi'
import { ProformaStatementView } from '@/components/accounts/ProformaStatementView'

interface TransferAccountsTabProps {
  transferId: string
  propertyAddress: string
  erfNumber?: string
  purchasePrice: number
  depositAmount?: number
  loanAmount?: number
  buyerName?: string
  sellerName?: string
}

export const TransferAccountsTab: React.FC<TransferAccountsTabProps> = ({
  transferId,
  propertyAddress,
  erfNumber,
  purchasePrice,
  depositAmount = 0,
  loanAmount = 0,
  buyerName,
  sellerName
}) => {
  const [statement, setStatement] = useState<ProformaStatementData | null>(null)
  const [firmSettings, setFirmSettings] = useState<FirmAccountSettings>(DEFAULT_FIRM_SETTINGS)
  const [statementType, setStatementType] = useState<'buyer' | 'seller'>('buyer')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [savedSuccess, setSavedSuccess] = useState(false)

  useEffect(() => {
    loadAccounts()
  }, [transferId, purchasePrice, depositAmount, buyerName, sellerName])

  const loadAccounts = async () => {
    setIsLoading(true)
    try {
      const [settings, stmt] = await Promise.all([
        AccountsApi.getFirmSettings(),
        AccountsApi.getProformaStatementForTransfer(transferId, {
          propertyAddress: propertyAddress || '123 Ocean View Drive, Cape Town',
          purchasePrice: purchasePrice || 2500000,
          depositAmount: depositAmount || 0,
          loanAmount: loanAmount || 0,
          erfNumber: erfNumber || 'Erf 4521'
        })
      ])
      setFirmSettings(settings)
      setStatement(stmt)
    } catch (e) {
      console.error('Failed to load transfer accounts:', e)
    } finally {
      setIsLoading(false)
    }
  }

  const handleUpdateStatement = async (updated: ProformaStatementData) => {
    setStatement(updated)
    setIsSaving(true)
    try {
      await AccountsApi.saveProformaStatement(updated)
      setSavedSuccess(true)
      setTimeout(() => setSavedSuccess(false), 2500)
    } catch (e) {
      console.error('Failed to save statement:', e)
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading || !statement) {
    return (
      <div className="flex items-center justify-center p-16 text-gray-500">
        <RefreshCw className="h-6 w-6 animate-spin mr-3 text-teal-600" />
        <span>Loading transfer accounts & proforma statement...</span>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Financial Summary Top Tiles */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card variant="premium">
          <CardContent className="p-4">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Purchase Price
            </span>
            <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1 font-mono">
              {formatZAR(statement.purchasePrice)}
            </p>
            <span className="text-[11px] text-teal-600 dark:text-teal-400 font-medium">
              Sliding scale base
            </span>
          </CardContent>
        </Card>

        <Card variant="premium">
          <CardContent className="p-4">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              SARS Transfer Duty
            </span>
            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-1 font-mono">
              {formatZAR(statement.transferDuty)}
            </p>
            <span className="text-[11px] text-gray-500 dark:text-gray-400 truncate block">
              {statement.transferDutyDescription}
            </span>
          </CardContent>
        </Card>

        <Card variant="premium">
          <CardContent className="p-4">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Attorney & Deeds Fees
            </span>
            <p className="text-2xl font-bold text-teal-600 dark:text-teal-400 mt-1 font-mono">
              {formatZAR(statement.conveyancingFeeInclVat + statement.deedsOfficeTotal)}
            </p>
            <span className="text-[11px] text-gray-500 dark:text-gray-400">
              Fee + VAT + Item 1(a)&(b)
            </span>
          </CardContent>
        </Card>

        <Card variant="glass" className="bg-teal-900/10 border-teal-500/30">
          <CardContent className="p-4">
            <span className="text-xs font-bold text-teal-700 dark:text-teal-300 uppercase tracking-wider">
              Net Balance Due
            </span>
            <p className="text-2xl font-black text-teal-600 dark:text-teal-400 mt-1 font-mono">
              {formatZAR(statement.balanceDue)}
            </p>
            <span className="text-[11px] text-teal-600 dark:text-teal-400 font-medium">
              {savedSuccess ? '✓ Auto-saved' : 'Payable by Purchaser'}
            </span>
          </CardContent>
        </Card>
      </div>

      {/* Account Type Selector & Switcher */}
      <div className="flex items-center justify-between border-b border-gray-200 dark:border-navy-700 pb-3">
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => {
              setStatementType('buyer')
              handleUpdateStatement({ ...statement, statementType: 'buyer' })
            }}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
              statementType === 'buyer'
                ? 'bg-teal-600 text-white shadow-md'
                : 'bg-gray-100 dark:bg-navy-800 text-gray-600 dark:text-gray-400 hover:text-gray-900'
            }`}
          >
            Purchaser Statement of Account
          </button>
          <button
            type="button"
            onClick={() => {
              setStatementType('seller')
              handleUpdateStatement({ ...statement, statementType: 'seller' })
            }}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
              statementType === 'seller'
                ? 'bg-teal-600 text-white shadow-md'
                : 'bg-gray-100 dark:bg-navy-800 text-gray-600 dark:text-gray-400 hover:text-gray-900'
            }`}
          >
            Seller Settlement Account
          </button>
        </div>

        {isSaving ? (
          <div className="flex items-center text-xs font-semibold text-teal-600 dark:text-teal-400">
            <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" />
            Saving...
          </div>
        ) : savedSuccess ? (
          <div className="flex items-center text-xs font-semibold text-emerald-600 dark:text-emerald-400">
            <CheckCircle className="h-4 w-4 mr-1" />
            Statement Saved
          </div>
        ) : null}
      </div>

      {/* Proforma Statement Document View */}
      <ProformaStatementView
        statement={statement}
        firmSettings={firmSettings}
        onUpdateStatement={handleUpdateStatement}
      />
    </div>
  )
}

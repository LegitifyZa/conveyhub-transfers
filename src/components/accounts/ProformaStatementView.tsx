import React, { useState, useRef } from 'react'
import { 
  Printer, 
  Plus, 
  Trash2, 
  Edit3, 
  Coins, 
  FileText
} from 'lucide-react'
import { Button } from '@/components/ui'
import { Input } from '@/components/ui'
import { Badge } from '@/components/ui'
import { 
  ProformaStatementData, 
  formatZAR, 
  FirmAccountSettings, 
  DEFAULT_FIRM_SETTINGS,
  DisbursementItem,
  AccountCredit,
  ADHOC_DEEDS_OFFICE_FEES
} from '@/utils/conveyancingAccounts'

interface ProformaStatementViewProps {
  statement: ProformaStatementData
  firmSettings?: FirmAccountSettings
  onUpdateStatement?: (updated: ProformaStatementData) => void
  readOnly?: boolean
}

export const ProformaStatementView: React.FC<ProformaStatementViewProps> = ({
  statement,
  firmSettings = DEFAULT_FIRM_SETTINGS,
  onUpdateStatement,
  readOnly = false
}) => {
  const printRef = useRef<HTMLDivElement>(null)
  const [isEditing, setIsEditing] = useState(false)

  // Adhoc modal or inline add state
  const [showAddDisbursement, setShowAddDisbursement] = useState(false)
  const [newDisbName, setNewDisbName] = useState('')
  const [newDisbAmount, setNewDisbAmount] = useState('')
  const [newDisbVat, setNewDisbVat] = useState(true)

  // Credit add state
  const [showAddCredit, setShowAddCredit] = useState(false)
  const [newCreditName, setNewCreditName] = useState('Deposit received from purchaser')
  const [newCreditAmount, setNewCreditAmount] = useState('')

  // Adhoc deeds fee add state
  const [showAddDeedsFee, setShowAddDeedsFee] = useState(false)
  const [selectedAdhocDeedId, setSelectedAdhocDeedId] = useState('')

  const handlePrint = () => {
    window.print()
  }

  // Recalculate totals helper
  const recalculateAndSave = (partial: Partial<ProformaStatementData>) => {
    if (!onUpdateStatement) return

    const base = { ...statement, ...partial }
    const vatRate = firmSettings.isVatRegistered ? firmSettings.vatRate || 0.15 : 0

    // Conveyancing VAT
    const convFee = base.conveyancingFeeExclVat || 0
    const convVat = Math.round(convFee * vatRate)
    const convIncl = convFee + convVat

    // Deeds Total
    const deedsReg = base.deedsOfficeRegistrationFee || 0
    const deedsLodge = base.deedsOfficeLodgementFee || 0
    const adhocDeeds = base.deedsOfficeAdhocFees || []
    const deedsAdhocTotal = adhocDeeds.reduce((s, i) => s + (i.fee || 0), 0)
    const deedsTotal = deedsReg + deedsLodge + deedsAdhocTotal

    // Disbursements
    const disbs = base.disbursements || []
    let disbExcl = 0
    let disbVat = 0
    disbs.forEach(d => {
      disbExcl += d.amount || 0
      if (d.isVatApplicable && firmSettings.isVatRegistered) {
        disbVat += Math.round((d.amount || 0) * vatRate)
      }
    })
    const disbIncl = disbExcl + disbVat

    // Credits
    const creds = base.credits || []
    const totalCredits = creds.reduce((s, c) => s + (c.amount || 0), 0)

    const transferDuty = base.transferDuty || 0
    const subtotalExclVat = convFee + transferDuty + deedsTotal + disbExcl
    const totalVat = convVat + disbVat
    const totalCosts = convIncl + transferDuty + deedsTotal + disbIncl
    const balanceDue = totalCosts - totalCredits

    onUpdateStatement({
      ...base,
      conveyancingFeeExclVat: convFee,
      conveyancingFeeVat: convVat,
      conveyancingFeeInclVat: convIncl,
      deedsOfficeAdhocFees: adhocDeeds,
      deedsOfficeTotal: deedsTotal,
      disbursements: disbs,
      disbursementsExclVat: disbExcl,
      disbursementsVat: disbVat,
      disbursementsInclVat: disbIncl,
      credits: creds,
      totalCredits,
      subtotalExclVat,
      totalVat,
      totalCosts,
      balanceDue
    })
  }

  const handleAddDisbursement = () => {
    if (!newDisbName.trim()) return
    const amt = parseFloat(newDisbAmount.replace(/[^0-9.]/g, '')) || 0
    const newItem: DisbursementItem = {
      id: `disb-${Date.now()}`,
      name: newDisbName.trim(),
      amount: amt,
      isVatApplicable: newDisbVat,
      category: 'adhoc'
    }
    recalculateAndSave({
      disbursements: [...statement.disbursements, newItem]
    })
    setNewDisbName('')
    setNewDisbAmount('')
    setShowAddDisbursement(false)
  }

  const handleRemoveDisbursement = (id: string) => {
    recalculateAndSave({
      disbursements: statement.disbursements.filter(d => d.id !== id)
    })
  }

  const handleAddCredit = () => {
    if (!newCreditName.trim()) return
    const amt = parseFloat(newCreditAmount.replace(/[^0-9.]/g, '')) || 0
    const newCredit: AccountCredit = {
      id: `cred-${Date.now()}`,
      name: newCreditName.trim(),
      amount: amt,
      date: new Date().toISOString()
    }
    recalculateAndSave({
      credits: [...statement.credits, newCredit]
    })
    setNewCreditName('Deposit received from purchaser')
    setNewCreditAmount('')
    setShowAddCredit(false)
  }

  const handleRemoveCredit = (id: string) => {
    recalculateAndSave({
      credits: statement.credits.filter(c => c.id !== id)
    })
  }

  const handleAddAdhocDeedsFee = () => {
    const feeItem = ADHOC_DEEDS_OFFICE_FEES.find(f => f.id === selectedAdhocDeedId)
    if (!feeItem) return
    recalculateAndSave({
      deedsOfficeAdhocFees: [...(statement.deedsOfficeAdhocFees || []), feeItem]
    })
    setSelectedAdhocDeedId('')
    setShowAddDeedsFee(false)
  }

  const handleRemoveDeedsAdhocFee = (index: number) => {
    const updated = (statement.deedsOfficeAdhocFees || []).filter((_, i) => i !== index)
    recalculateAndSave({ deedsOfficeAdhocFees: updated })
  }

  const trust = firmSettings.trustAccount || DEFAULT_FIRM_SETTINGS.trustAccount

  return (
    <div className="space-y-6">
      {/* Top Action Toolbar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 bg-white dark:bg-navy-800 rounded-xl border border-gray-200 dark:border-navy-700 shadow-sm print:hidden">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-teal-500/10 text-teal-600 dark:text-teal-400 flex items-center justify-center font-bold">
            <FileText className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              Proforma Statement of Account
              <Badge variant={statement.status === 'settled' ? 'success' : statement.status === 'issued' ? 'secondary' : 'default'}>
                {statement.status.toUpperCase()}
              </Badge>
            </h3>
            <p className="text-xs text-gray-500">
              Ref: <span className="font-mono font-semibold">{statement.matterReference || statement.transferId || 'MAT-2026'}</span> • Date: {new Date(statement.date).toLocaleDateString('en-ZA', { dateStyle: 'medium' })}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!readOnly && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsEditing(!isEditing)}
              className="text-xs"
            >
              <Edit3 className="h-3.5 w-3.5 mr-1" />
              {isEditing ? 'Done Customizing' : 'Customize Statement'}
            </Button>
          )}
          <Button
            size="sm"
            onClick={handlePrint}
            className="bg-teal-600 hover:bg-teal-500 text-white text-xs shadow-md"
          >
            <Printer className="h-3.5 w-3.5 mr-1.5" />
            Print / Save as PDF
          </Button>
        </div>
      </div>

      {/* Main Printable Document Card */}
      <div 
        ref={printRef}
        className="bg-white dark:bg-navy-900 border border-gray-200 dark:border-navy-700 rounded-2xl shadow-xl p-8 sm:p-12 text-gray-900 dark:text-gray-100 space-y-8 font-sans print:border-none print:shadow-none print:p-0 print:m-0"
      >
        {/* Law Firm Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start gap-6 border-b border-gray-200 dark:border-navy-700 pb-8">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-teal-600 text-white font-bold flex items-center justify-center text-base">
                {firmSettings.firmName.charAt(0)}
              </div>
              <h1 className="text-2xl font-black tracking-tight text-gray-900 dark:text-gray-100">
                {firmSettings.firmName}
              </h1>
            </div>
            <p className="text-xs text-gray-500 uppercase tracking-widest font-semibold">
              Attorneys, Notaries & Conveyancers
            </p>
            {firmSettings.registrationNumber && (
              <p className="text-xs text-gray-500">
                Reg No: <span className="font-mono">{firmSettings.registrationNumber}</span>
              </p>
            )}
            {firmSettings.isVatRegistered && (
              <p className="text-xs text-teal-700 dark:text-teal-400 font-medium">
                VAT Registration No: <span className="font-mono font-bold">{firmSettings.vatNumber}</span>
              </p>
            )}
          </div>

          <div className="text-left sm:text-right space-y-1">
            <h2 className="text-xl font-bold uppercase tracking-wide text-gray-800 dark:text-gray-200">
              Proforma Statement of Account
            </h2>
            <p className="text-xs text-gray-500">
              Statement Ref: <span className="font-mono font-bold text-gray-900 dark:text-gray-100">{statement.id || statement.matterReference}</span>
            </p>
            <p className="text-xs text-gray-500">
              Date: <span className="font-medium text-gray-700 dark:text-gray-300">{new Date(statement.date).toLocaleDateString('en-ZA', { dateStyle: 'long' })}</span>
            </p>
            <Badge variant="secondary" className="mt-1">
              Account Type: {statement.statementType === 'seller' ? 'Seller Account' : 'Purchaser Account'}
            </Badge>
          </div>
        </div>

        {/* Matter & Transaction Details Box */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 p-5 rounded-xl bg-gray-50 dark:bg-navy-800/60 border border-gray-200 dark:border-navy-700 text-xs">
          <div>
            <span className="block text-gray-400 font-semibold uppercase tracking-wider mb-0.5">Matter Reference</span>
            <span className="font-bold text-gray-900 dark:text-gray-100 font-mono text-sm">{statement.matterReference || statement.transferId || '—'}</span>
          </div>

          <div>
            <span className="block text-gray-400 font-semibold uppercase tracking-wider mb-0.5">Property Description</span>
            <span className="font-medium text-gray-900 dark:text-gray-100">{statement.propertyAddress || '—'}</span>
            {statement.erfNumber && <p className="text-gray-500 mt-0.5">{statement.erfNumber}</p>}
          </div>

          <div>
            <span className="block text-gray-400 font-semibold uppercase tracking-wider mb-0.5">Purchase Price</span>
            <span className="font-bold text-teal-600 dark:text-teal-400 text-sm font-mono">{formatZAR(statement.purchasePrice)}</span>
          </div>

          <div>
            <span className="block text-gray-400 font-semibold uppercase tracking-wider mb-0.5">Deeds Lodgement</span>
            <span className="font-medium text-gray-900 dark:text-gray-100">
              {statement.lodgementDeedsCount || 1} Deed{(statement.lodgementDeedsCount || 1) > 1 ? 's' : ''} (Item 1(a))
            </span>
          </div>
        </div>

        {/* Tabular Statement Line Items */}
        <div className="space-y-6">
          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-navy-700">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-100 dark:bg-navy-800 text-gray-600 dark:text-gray-400 uppercase text-xs font-bold tracking-wider">
                <tr>
                  <th className="px-4 py-3">Description of Costs / Charges</th>
                  <th className="px-4 py-3 text-right w-32">Amount (Excl VAT)</th>
                  <th className="px-4 py-3 text-right w-28">VAT (15%)</th>
                  <th className="px-4 py-3 text-right w-36">Total (ZAR)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-navy-700 font-mono text-xs">
                {/* 1. Professional Fees */}
                <tr className="bg-teal-500/5 font-sans font-bold text-teal-800 dark:text-teal-300">
                  <td colSpan={4} className="px-4 py-2 uppercase tracking-wide text-xs">
                    1. Professional Conveyancing Fees (Law Society Tariff)
                  </td>
                </tr>
                <tr className="hover:bg-gray-50/50 dark:hover:bg-navy-800/30">
                  <td className="px-4 py-3 font-sans">
                    <span className="font-semibold text-gray-900 dark:text-gray-100">
                      Conveyancing Professional Fee (Transfer)
                    </span>
                    <p className="text-gray-400 text-xs mt-0.5">Calculated on sliding scale on purchase price of {formatZAR(statement.purchasePrice)}</p>
                  </td>
                  <td className="px-4 py-3 text-right font-medium">{formatZAR(statement.conveyancingFeeExclVat)}</td>
                  <td className="px-4 py-3 text-right text-gray-500">{formatZAR(statement.conveyancingFeeVat)}</td>
                  <td className="px-4 py-3 text-right font-bold text-gray-900 dark:text-gray-100">{formatZAR(statement.conveyancingFeeInclVat)}</td>
                </tr>

                {/* 2. SARS Transfer Duty */}
                <tr className="bg-teal-500/5 font-sans font-bold text-teal-800 dark:text-teal-300">
                  <td colSpan={4} className="px-4 py-2 uppercase tracking-wide text-xs">
                    2. Statutory Tax: SARS Transfer Duty
                  </td>
                </tr>
                <tr className="hover:bg-gray-50/50 dark:hover:bg-navy-800/30">
                  <td className="px-4 py-3 font-sans">
                    <span className="font-semibold text-gray-900 dark:text-gray-100">
                      Transfer Duty Payable to SARS
                    </span>
                    <p className="text-gray-400 text-xs mt-0.5">{statement.transferDutyDescription}</p>
                  </td>
                  <td className="px-4 py-3 text-right font-medium">{formatZAR(statement.transferDuty)}</td>
                  <td className="px-4 py-3 text-right text-gray-400 italic font-sans">Exempt</td>
                  <td className="px-4 py-3 text-right font-bold text-gray-900 dark:text-gray-100">{formatZAR(statement.transferDuty)}</td>
                </tr>

                {/* 3. Deeds Office Registration Fees */}
                <tr className="bg-teal-500/5 font-sans font-bold text-teal-800 dark:text-teal-300">
                  <td colSpan={4} className="px-4 py-2 uppercase tracking-wide text-xs">
                    3. Statutory Deeds Office Fees (GG Schedule)
                  </td>
                </tr>
                <tr className="hover:bg-gray-50/50 dark:hover:bg-navy-800/30">
                  <td className="px-4 py-2.5 font-sans">
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                      Deeds Office Registration Fee (Item 1(b) Transfer)
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">{formatZAR(statement.deedsOfficeRegistrationFee)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-400 italic font-sans">Zero VAT</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-gray-900 dark:text-gray-100">{formatZAR(statement.deedsOfficeRegistrationFee)}</td>
                </tr>
                <tr className="hover:bg-gray-50/50 dark:hover:bg-navy-800/30">
                  <td className="px-4 py-2.5 font-sans">
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                      Deeds Office Lodgement Fee (Item 1(a) @ R52.00 × {statement.lodgementDeedsCount || 1} deed{(statement.lodgementDeedsCount || 1) > 1 ? 's' : ''})
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">{formatZAR(statement.deedsOfficeLodgementFee)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-400 italic font-sans">Zero VAT</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-gray-900 dark:text-gray-100">{formatZAR(statement.deedsOfficeLodgementFee)}</td>
                </tr>
                {statement.deedsOfficeAdhocFees?.map((adhoc, i) => (
                  <tr key={adhoc.id || i} className="hover:bg-gray-50/50 dark:hover:bg-navy-800/30">
                    <td className="px-4 py-2.5 font-sans flex items-center justify-between">
                      <span className="font-medium text-gray-900 dark:text-gray-100">{adhoc.name}</span>
                      {isEditing && (
                        <button onClick={() => handleRemoveDeedsAdhocFee(i)} className="text-red-500 p-1 text-xs">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">{formatZAR(adhoc.fee)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-400 italic font-sans">Zero VAT</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-gray-900 dark:text-gray-100">{formatZAR(adhoc.fee)}</td>
                  </tr>
                ))}

                {/* 4. Disbursements */}
                <tr className="bg-teal-500/5 font-sans font-bold text-teal-800 dark:text-teal-300">
                  <td colSpan={4} className="px-4 py-2 uppercase tracking-wide text-xs">
                    4. Practice Disbursements & Ad-hoc Charges
                  </td>
                </tr>
                {statement.disbursements.map((item) => {
                  const vat = item.isVatApplicable && firmSettings.isVatRegistered ? Math.round(item.amount * (firmSettings.vatRate || 0.15)) : 0
                  const total = item.amount + vat
                  return (
                    <tr key={item.id} className="hover:bg-gray-50/50 dark:hover:bg-navy-800/30">
                      <td className="px-4 py-2.5 font-sans flex items-center justify-between">
                        <div>
                          <span className="font-medium text-gray-900 dark:text-gray-100">{item.name}</span>
                          {item.description && <p className="text-gray-400 text-xs">{item.description}</p>}
                        </div>
                        {isEditing && (
                          <button onClick={() => handleRemoveDisbursement(item.id)} className="text-red-500 p-1 text-xs">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">{formatZAR(item.amount)}</td>
                      <td className="px-4 py-2.5 text-right text-gray-500">{vat > 0 ? formatZAR(vat) : <span className="text-gray-400 italic font-sans">Exempt</span>}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-gray-900 dark:text-gray-100">{formatZAR(total)}</td>
                    </tr>
                  )
                })}

                {/* 5. Credits / Deposits */}
                {statement.credits && statement.credits.length > 0 && (
                  <>
                    <tr className="bg-emerald-500/10 font-sans font-bold text-emerald-800 dark:text-emerald-300">
                      <td colSpan={4} className="px-4 py-2 uppercase tracking-wide text-xs">
                        5. Credits & Deposits Received (Less)
                      </td>
                    </tr>
                    {statement.credits.map((cred) => (
                      <tr key={cred.id} className="hover:bg-emerald-50/30 font-medium text-emerald-700 dark:text-emerald-400">
                        <td className="px-4 py-2.5 font-sans flex items-center justify-between">
                          <span>{cred.name}</span>
                          {isEditing && (
                            <button onClick={() => handleRemoveCredit(cred.id)} className="text-red-500 p-1 text-xs">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right">- {formatZAR(cred.amount)}</td>
                        <td className="px-4 py-2.5 text-right text-gray-400">—</td>
                        <td className="px-4 py-2.5 text-right font-bold text-emerald-700 dark:text-emerald-400">- {formatZAR(cred.amount)}</td>
                      </tr>
                    ))}
                  </>
                )}
              </tbody>

              {/* Grand Totals Footer */}
              <tfoot className="bg-gray-50 dark:bg-navy-800/80 border-t-2 border-gray-300 dark:border-navy-600 font-mono text-sm">
                <tr>
                  <td className="px-4 py-2 font-sans font-semibold text-gray-700 dark:text-gray-300">
                    Subtotal Charges (Excl VAT)
                  </td>
                  <td className="px-4 py-2 text-right font-bold">{formatZAR(statement.subtotalExclVat)}</td>
                  <td className="px-4 py-2 text-right font-bold text-teal-600 dark:text-teal-400">{formatZAR(statement.totalVat)}</td>
                  <td className="px-4 py-2 text-right font-bold text-gray-900 dark:text-gray-100">{formatZAR(statement.totalCosts)}</td>
                </tr>

                {statement.totalCredits > 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-2 font-sans font-semibold text-emerald-700 dark:text-emerald-400">
                      Less: Total Deposits / Credits Received
                    </td>
                    <td className="px-4 py-2 text-right font-bold text-emerald-700 dark:text-emerald-400">
                      - {formatZAR(statement.totalCredits)}
                    </td>
                  </tr>
                )}

                <tr className="bg-teal-600 text-white font-bold text-base">
                  <td colSpan={3} className="px-4 py-3 font-sans uppercase tracking-wider text-sm">
                    Net Balance Payable by Client
                  </td>
                  <td className="px-4 py-3 text-right text-lg">
                    {formatZAR(statement.balanceDue)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Interactive Customize Action Panels */}
          {isEditing && (
            <div className="p-4 rounded-xl bg-gray-50 dark:bg-navy-800 border border-teal-500/30 space-y-4 print:hidden animate-in fade-in duration-200">
              <h4 className="text-xs font-bold uppercase tracking-wider text-teal-700 dark:text-teal-300">
                Add Ad-hoc Line Items or Credits
              </h4>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setShowAddDisbursement(true)} className="text-xs">
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add Custom Disbursement
                </Button>
                <Button size="sm" variant="outline" onClick={() => setShowAddDeedsFee(true)} className="text-xs">
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add Ad-hoc Deeds Office Charge
                </Button>
                <Button size="sm" variant="outline" onClick={() => setShowAddCredit(true)} className="text-xs">
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Record Deposit / Credit Received
                </Button>
              </div>

              {/* Add Custom Disbursement Form */}
              {showAddDisbursement && (
                <div className="p-3 bg-white dark:bg-navy-700 rounded-lg border border-gray-200 dark:border-navy-600 space-y-3">
                  <h5 className="text-xs font-semibold">New Disbursement Item</h5>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Input
                      placeholder="Item name (e.g. Special Courier)"
                      value={newDisbName}
                      onChange={e => setNewDisbName(e.target.value)}
                      className="text-xs"
                    />
                    <Input
                      placeholder="Amount (R)"
                      value={newDisbAmount}
                      onChange={e => setNewDisbAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                      className="text-xs"
                    />
                    <div className="flex items-center gap-2">
                      <label className="text-xs flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={newDisbVat}
                          onChange={e => setNewDisbVat(e.target.checked)}
                          className="h-3.5 w-3.5 text-teal-600 rounded"
                        />
                        VAT Applicable
                      </label>
                      <Button size="sm" onClick={handleAddDisbursement} className="text-xs py-1">Add Item</Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Add Deeds Charge Form */}
              {showAddDeedsFee && (
                <div className="p-3 bg-white dark:bg-navy-700 rounded-lg border border-gray-200 dark:border-navy-600 space-y-3">
                  <h5 className="text-xs font-semibold">Select Ad-hoc Deeds Office Charge (Statutory)</h5>
                  <div className="flex items-center gap-3">
                    <select
                      value={selectedAdhocDeedId}
                      onChange={e => setSelectedAdhocDeedId(e.target.value)}
                      className="text-xs p-2 rounded-lg border border-gray-300 dark:border-navy-600 bg-white dark:bg-navy-800 flex-1"
                    >
                      <option value="">Select Deeds Gazette charge...</option>
                      {ADHOC_DEEDS_OFFICE_FEES.map(f => (
                        <option key={f.id} value={f.id}>{f.name} - R{f.fee.toLocaleString()}</option>
                      ))}
                    </select>
                    <Button size="sm" onClick={handleAddAdhocDeedsFee} disabled={!selectedAdhocDeedId} className="text-xs">Add</Button>
                  </div>
                </div>
              )}

              {/* Add Credit Form */}
              {showAddCredit && (
                <div className="p-3 bg-white dark:bg-navy-700 rounded-lg border border-gray-200 dark:border-navy-600 space-y-3">
                  <h5 className="text-xs font-semibold">Record Payment / Deposit Received</h5>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Input
                      placeholder="Credit description"
                      value={newCreditName}
                      onChange={e => setNewCreditName(e.target.value)}
                      className="text-xs"
                    />
                    <Input
                      placeholder="Amount received (R)"
                      value={newCreditAmount}
                      onChange={e => setNewCreditAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                      className="text-xs"
                    />
                    <Button size="sm" onClick={handleAddCredit} className="text-xs py-1">Record Credit</Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Banking Trust Account & Payment Instructions */}
        <div className="p-6 rounded-xl bg-gray-50 dark:bg-navy-800/80 border border-gray-200 dark:border-navy-700 space-y-3 text-xs">
          <div className="flex items-center gap-2">
            <Coins className="h-4 w-4 text-teal-600 dark:text-teal-400" />
            <h4 className="font-bold text-gray-900 dark:text-gray-100 uppercase tracking-wider">
              Section 86 Attorney Trust Banking Details for Electronic Funds Transfer (EFT)
            </h4>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2 font-mono">
            <div>
              <span className="block text-gray-400 font-sans">Bank:</span>
              <span className="font-bold text-gray-900 dark:text-gray-100">{trust.bankName}</span>
            </div>
            <div>
              <span className="block text-gray-400 font-sans">Account Name:</span>
              <span className="font-bold text-gray-900 dark:text-gray-100">{trust.accountName}</span>
            </div>
            <div>
              <span className="block text-gray-400 font-sans">Account Number:</span>
              <span className="font-bold text-teal-600 dark:text-teal-400">{trust.accountNumber}</span>
            </div>
            <div>
              <span className="block text-gray-400 font-sans">Branch Code:</span>
              <span className="font-bold text-gray-900 dark:text-gray-100">{trust.branchCode}</span>
            </div>
          </div>
          <div className="pt-2 border-t border-gray-200 dark:border-navy-700 font-sans text-gray-500">
            <span className="font-semibold text-gray-700 dark:text-gray-300">Payment Reference: </span>
            Please use matter reference <span className="font-mono font-bold text-teal-600 dark:text-teal-400">{statement.matterReference || statement.transferId || 'MAT-2026'}</span> as your deposit reference.
          </div>
        </div>

        {/* Legal Disclaimer Footer */}
        <div className="pt-4 border-t border-gray-200 dark:border-navy-700 text-center text-[10px] text-gray-400 space-y-1">
          <p>
            This statement is a proforma estimate issued for conveyancing budgeting purposes in accordance with the Legal Practice Act and the Deeds Registries Act No. 47 of 1937.
          </p>
          <p>
            Final settlement figures may be subject to minor municipal rates adjustments and Deeds Office lodgement variations. E&OE.
          </p>
        </div>
      </div>
    </div>
  )
}

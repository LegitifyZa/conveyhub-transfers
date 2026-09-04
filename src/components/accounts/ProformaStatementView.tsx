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
  AppliedDisbursementLine,
  StatementCredit,
  OFFICIAL_DEEDS_OFFICE_ADHOC_FEES
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
    const deedsAdhocTotal = adhocDeeds.reduce((s, i) => s + (Number(i.amount) || 0), 0)
    const deedsTotal = deedsReg + deedsLodge + deedsAdhocTotal

    // Disbursements
    const disbs = base.disbursements || []
    let disbExcl = 0
    let disbVat = 0
    disbs.forEach(d => {
      const amt = Number(d.amountExclVat) || 0
      disbExcl += amt
      if (d.isVatApplicable && firmSettings.isVatRegistered) {
        disbVat += Math.round(amt * vatRate)
      }
    })
    const disbIncl = disbExcl + disbVat

    // Credits
    const creds = base.credits || []
    const totalCredits = creds.reduce((s, c) => s + (Number(c.amount) || 0), 0)

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
    const vat = newDisbVat && firmSettings.isVatRegistered ? Math.round(amt * (firmSettings.vatRate || 0.15)) : 0
    const code = newDisbName.trim().toUpperCase().replace(/[^A-Z0-9]/g, '_')
    const newItem: AppliedDisbursementLine = {
      id: `disb-${Date.now()}`,
      code,
      name: newDisbName.trim(),
      amountExclVat: amt,
      vatAmount: vat,
      amountInclVat: amt + vat,
      isVatApplicable: newDisbVat,
      category: 'adhoc',
      applicationRule: 'manual',
      applicationReason: 'Manual line item added during customization'
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
    const newCredit: StatementCredit = {
      id: `cred-${Date.now()}`,
      name: newCreditName.trim(),
      amount: amt,
      source: 'other'
    }
    recalculateAndSave({
      credits: [...(statement.credits || []), newCredit]
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
    const feeItem = OFFICIAL_DEEDS_OFFICE_ADHOC_FEES.find(f => f.id === selectedAdhocDeedId)
    if (!feeItem) return
    recalculateAndSave({
      deedsOfficeAdhocFees: [...(statement.deedsOfficeAdhocFees || []), { id: feeItem.id, name: feeItem.name, amount: feeItem.amount }]
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
              <Badge variant={statement.status === 'paid' ? 'success' : statement.status === 'issued' ? 'secondary' : 'default'}>
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
            <Printer className="h-3.5 w-3.5 mr-1" />
            Print / Export PDF
          </Button>
        </div>
      </div>

      {/* Printable Letterhead Statement */}
      <div 
        ref={printRef}
        className="p-8 sm:p-12 bg-white dark:bg-navy-900 rounded-2xl border border-gray-200 dark:border-navy-700 shadow-xl space-y-8 print:shadow-none print:border-none print:p-0"
      >
        {/* Law Firm Letterhead */}
        <div className="flex flex-col sm:flex-row items-start justify-between border-b-2 border-teal-600 pb-6 gap-4">
          <div>
            <h2 className="text-2xl font-serif font-black tracking-tight text-gray-900 dark:text-gray-100 uppercase">
              {firmSettings.firmName || 'Conveyancing Attorneys & Notaries'}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Attorneys, Notaries & Conveyancers • Section 86 Trust Practice
            </p>
            {firmSettings.registrationNumber && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Practice Reg: <span className="font-mono">{firmSettings.registrationNumber}</span>
              </p>
            )}
            {firmSettings.isVatRegistered && firmSettings.vatNumber && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                VAT Reg No: <span className="font-mono font-semibold">{firmSettings.vatNumber}</span>
              </p>
            )}
          </div>

          <div className="sm:text-right space-y-1">
            <h3 className="text-xl font-bold font-sans text-teal-700 dark:text-teal-300">
              PROFORMA STATEMENT
            </h3>
            <p className="text-xs text-gray-500">
              Account For: <span className="font-bold text-gray-900 dark:text-gray-100 uppercase">{statement.statementType === 'buyer' ? 'Purchaser' : statement.statementType === 'seller' ? 'Seller' : 'Combined Transfer'}</span>
            </p>
            <p className="text-xs font-mono text-gray-700 dark:text-gray-300">
              Statement ID: {statement.id}
            </p>
            <p className="text-xs text-gray-500">
              Date: {new Date(statement.date).toLocaleDateString('en-ZA', { dateStyle: 'long' })}
            </p>
          </div>
        </div>

        {/* Matter & Property Particulars */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-4 rounded-xl bg-gray-50 dark:bg-navy-800/60 border border-gray-200 dark:border-navy-700 text-xs">
          <div className="space-y-1.5">
            <span className="font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider block text-[10px]">
              Property Description & Matter
            </span>
            <p className="font-semibold text-gray-900 dark:text-gray-100 text-sm">
              {statement.propertyAddress}
            </p>
            {statement.erfNumber && (
              <p className="text-gray-600 dark:text-gray-400 font-mono">
                Cadastral Erf: {statement.erfNumber}
              </p>
            )}
            <p className="text-gray-600 dark:text-gray-400">
              Matter File Reference: <span className="font-mono font-bold text-gray-900 dark:text-gray-100">{statement.matterReference || statement.transferId}</span>
            </p>
          </div>

          <div className="space-y-1.5 md:text-right">
            <span className="font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider block text-[10px]">
              Financial Summary (ZAR)
            </span>
            <p className="text-gray-700 dark:text-gray-300">
              Purchase Price: <span className="font-mono font-bold text-gray-900 dark:text-gray-100 text-sm">{formatZAR(statement.purchasePrice)}</span>
            </p>
            {statement.depositAmount > 0 && (
              <p className="text-gray-700 dark:text-gray-300">
                Deposit Received / Payable: <span className="font-mono">{formatZAR(statement.depositAmount)}</span>
              </p>
            )}
            {statement.loanAmount > 0 && (
              <p className="text-gray-700 dark:text-gray-300">
                Bond / Loan Cover: <span className="font-mono">{formatZAR(statement.loanAmount)}</span>
              </p>
            )}
          </div>
        </div>

        {/* Itemized Line Items Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-gray-100 dark:bg-navy-800 text-gray-700 dark:text-gray-300 uppercase tracking-wider font-semibold border-b border-gray-200 dark:border-navy-700 font-sans">
              <tr>
                <th className="px-4 py-3">Description of Professional Fees & Disbursements</th>
                <th className="px-4 py-3 text-right">Fee (Excl VAT)</th>
                <th className="px-4 py-3 text-right">VAT (15%)</th>
                <th className="px-4 py-3 text-right">Total (ZAR)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-navy-700 font-mono">
              {/* 1. Professional Conveyancing Fees */}
              <tr className="bg-teal-500/5 font-sans font-bold text-teal-800 dark:text-teal-300">
                <td colSpan={4} className="px-4 py-2 uppercase tracking-wide text-xs">
                  1. Professional Conveyancing Fees (LSSA Guideline Tariff)
                </td>
              </tr>
              <tr className="hover:bg-gray-50/50 dark:hover:bg-navy-800/30">
                <td className="px-4 py-3 font-sans">
                  <span className="font-medium text-gray-900 dark:text-gray-100">
                    Conveyancing Attorney Professional Fee (Transfer)
                  </span>
                  <p className="text-gray-400 text-xs mt-0.5">Calculated on purchase price of {formatZAR(statement.purchasePrice)}</p>
                </td>
                <td className="px-4 py-3 text-right">{formatZAR(statement.conveyancingFeeExclVat)}</td>
                <td className="px-4 py-3 text-right text-gray-500">{formatZAR(statement.conveyancingFeeVat)}</td>
                <td className="px-4 py-3 text-right font-bold text-gray-900 dark:text-gray-100">{formatZAR(statement.conveyancingFeeInclVat)}</td>
              </tr>

              {/* 2. Transfer Duty */}
              <tr className="bg-teal-500/5 font-sans font-bold text-teal-800 dark:text-teal-300">
                <td colSpan={4} className="px-4 py-2 uppercase tracking-wide text-xs">
                  2. Statutory Tax: SARS Transfer Duty
                </td>
              </tr>
              <tr className="hover:bg-gray-50/50 dark:hover:bg-navy-800/30">
                <td className="px-4 py-3 font-sans">
                  <span className="font-medium text-gray-900 dark:text-gray-100">
                    Transfer Duty Payable to SARS
                  </span>
                  <p className="text-gray-400 text-xs mt-0.5">{statement.transferDutyDescription}</p>
                </td>
                <td className="px-4 py-3 text-right font-medium">{formatZAR(statement.transferDuty)}</td>
                <td className="px-4 py-3 text-right text-gray-400 italic font-sans">Exempt</td>
                <td className="px-4 py-3 text-right font-bold text-gray-900 dark:text-gray-100">{formatZAR(statement.transferDuty)}</td>
              </tr>

              {/* 3. Deeds Office Statutory Fees */}
              <tr className="bg-teal-500/5 font-sans font-bold text-teal-800 dark:text-teal-300">
                <td colSpan={4} className="px-4 py-2 uppercase tracking-wide text-xs">
                  3. Statutory Deeds Office Fees (GG Schedule)
                </td>
              </tr>
              <tr className="hover:bg-gray-50/50 dark:hover:bg-navy-800/30">
                <td className="px-4 py-2.5 font-sans">
                  <span className="font-medium text-gray-900 dark:text-gray-100">
                    Deeds Office Registration Fee ({statement.statutoryScheduleItem || 'Item 1(b)'})
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
                  <td className="px-4 py-2.5 text-right">{formatZAR(Number(adhoc.amount) || 0)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-400 italic font-sans">Zero VAT</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-gray-900 dark:text-gray-100">{formatZAR(Number(adhoc.amount) || 0)}</td>
                </tr>
              ))}

              {/* 4. Disbursements */}
              <tr className="bg-teal-500/5 font-sans font-bold text-teal-800 dark:text-teal-300">
                <td colSpan={4} className="px-4 py-2 uppercase tracking-wide text-xs">
                  4. Practice Disbursements & Ad-hoc Charges
                </td>
              </tr>
              {statement.disbursements.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50/50 dark:hover:bg-navy-800/30">
                  <td className="px-4 py-2.5 font-sans flex items-center justify-between">
                    <div>
                      <span className="font-medium text-gray-900 dark:text-gray-100">{item.name}</span>
                      {item.applicationReason && <p className="text-gray-400 text-xs">{item.applicationReason}</p>}
                    </div>
                    {isEditing && (
                      <button onClick={() => handleRemoveDisbursement(item.id)} className="text-red-500 p-1 text-xs">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">{formatZAR(item.amountExclVat)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-500">{item.vatAmount > 0 ? formatZAR(item.vatAmount) : <span className="text-gray-400 italic font-sans">Exempt</span>}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-gray-900 dark:text-gray-100">{formatZAR(item.amountInclVat)}</td>
                </tr>
              ))}

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
                      <td className="px-4 py-2.5 text-right">-</td>
                      <td className="px-4 py-2.5 text-right">-</td>
                      <td className="px-4 py-2.5 text-right font-bold font-mono">-{formatZAR(cred.amount)}</td>
                    </tr>
                  ))}
                </>
              )}
            </tbody>
            <tfoot className="border-t-2 border-gray-300 dark:border-navy-600 font-mono text-sm font-bold bg-gray-50/70 dark:bg-navy-800/70">
              <tr>
                <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300 font-sans">Subtotal (Excl. VAT):</td>
                <td className="px-4 py-2.5 text-right">{formatZAR(statement.subtotalExclVat)}</td>
                <td className="px-4 py-2.5 text-right text-teal-600">{formatZAR(statement.totalVat)}</td>
                <td className="px-4 py-2.5 text-right">{formatZAR(statement.totalCosts)}</td>
              </tr>
              {statement.totalCredits > 0 && (
                <tr className="text-emerald-700 dark:text-emerald-400">
                  <td colSpan={3} className="px-4 py-2 text-right font-sans">Total Credits & Deposits Received:</td>
                  <td className="px-4 py-2 text-right font-bold font-mono">-{formatZAR(statement.totalCredits)}</td>
                </tr>
              )}
              <tr className="bg-teal-600 text-white text-base font-extrabold">
                <td colSpan={3} className="px-4 py-3.5 uppercase tracking-wide font-sans">
                  Total Balance Due on Proforma:
                </td>
                <td className="px-4 py-3.5 text-right text-lg">
                  {formatZAR(statement.balanceDue)}
                </td>
              </tr>
            </tfoot>
          </table>

          {/* Inline Customizer Form */}
          {isEditing && (
            <div className="mt-6 p-4 rounded-xl border border-dashed border-teal-500/40 bg-teal-50/20 dark:bg-teal-900/10 space-y-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-teal-700 dark:text-teal-300">
                <Edit3 className="h-4 w-4" />
                Customize Line Items & Adjustments
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setShowAddDisbursement(true)} className="text-xs gap-1">
                  <Plus className="h-3.5 w-3.5" /> Add Disbursement
                </Button>
                <Button size="sm" variant="outline" onClick={() => setShowAddDeedsFee(true)} className="text-xs gap-1">
                  <Plus className="h-3.5 w-3.5" /> Add Deeds Gazette Fee
                </Button>
                <Button size="sm" variant="outline" onClick={() => setShowAddCredit(true)} className="text-xs gap-1">
                  <Plus className="h-3.5 w-3.5" /> Record Deposit / Credit
                </Button>
              </div>

              {/* Add Disbursement Form */}
              {showAddDisbursement && (
                <div className="p-3 bg-white dark:bg-navy-700 rounded-lg border border-gray-200 dark:border-navy-600 space-y-3">
                  <h5 className="text-xs font-semibold">Add Custom Disbursement</h5>
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <Input
                      placeholder="Disbursement description"
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
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={newDisbVat}
                        onChange={e => setNewDisbVat(e.target.checked)}
                        className="rounded text-teal-600"
                      />
                      15% VAT Applicable
                    </label>
                    <Button size="sm" onClick={handleAddDisbursement} className="text-xs py-1">Add Line</Button>
                  </div>
                </div>
              )}

              {/* Add Deeds Adhoc Fee Form */}
              {showAddDeedsFee && (
                <div className="p-3 bg-white dark:bg-navy-700 rounded-lg border border-gray-200 dark:border-navy-600 space-y-3">
                  <h5 className="text-xs font-semibold">Add Gazette Deeds Office Fee</h5>
                  <div className="flex gap-2">
                    <select
                      value={selectedAdhocDeedId}
                      onChange={e => setSelectedAdhocDeedId(e.target.value)}
                      className="text-xs p-2 rounded-lg border border-gray-300 dark:border-navy-600 bg-white dark:bg-navy-800 flex-1"
                    >
                      <option value="">Select Deeds Gazette charge...</option>
                      {OFFICIAL_DEEDS_OFFICE_ADHOC_FEES.map(f => (
                        <option key={f.id} value={f.id}>{f.name} - R{f.amount.toLocaleString()}</option>
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
              <span className="font-bold text-gray-900 dark:text-gray-100">{trust.bankName || 'Standard Bank'}</span>
            </div>
            <div>
              <span className="block text-gray-400 font-sans">Account Number:</span>
              <span className="font-bold text-teal-600 dark:text-teal-400">{trust.accountNumber || '0123456789'}</span>
            </div>
            <div>
              <span className="block text-gray-400 font-sans">Branch Code:</span>
              <span className="font-bold text-gray-900 dark:text-gray-100">{trust.branchCode || '051001'}</span>
            </div>
            <div>
              <span className="block text-gray-400 font-sans">Account Type:</span>
              <span className="font-bold text-gray-900 dark:text-gray-100">{trust.accountType || 'Trust Account'}</span>
            </div>
          </div>
          <div className="p-3 bg-teal-50 dark:bg-teal-900/20 rounded-lg text-teal-800 dark:text-teal-300 font-medium">
            <strong>Payment Reference:</strong> Please quote matter reference <span className="font-mono font-bold">{statement.matterReference || statement.transferId}</span> on your payment confirmation.
          </div>
        </div>

        {/* Provenance and Statutory Compliance Footer */}
        {statement.provenance && (
          <div className="pt-4 border-t border-gray-200 dark:border-navy-700 text-[10px] text-gray-400 flex flex-wrap justify-between gap-2 font-mono">
            <span>Tariff: {statement.provenance.tariffName} (v{statement.provenance.tariffVersion})</span>
            <span>SARS Transfer Duty Schedule: v{statement.provenance.sarsTransferDutyVersion}</span>
            <span>Deeds Registry Schedule: v{statement.provenance.deedsOfficeScheduleVersion}</span>
            <span>Calculated: {new Date(statement.provenance.calculatedAt).toLocaleString('en-ZA')}</span>
          </div>
        )}
      </div>
    </div>
  )
}

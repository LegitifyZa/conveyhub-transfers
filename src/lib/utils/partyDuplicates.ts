import type { Party } from '../../components/transfers/TransferForm'

export type PartyIdType = 'sa_id' | 'passport' | 'other'

const normalizeIdentifier = (value: string | undefined | null): string =>
  (value || '').replace(/[\s-]+/g, '').toUpperCase()

const normalizeName = (value: string | undefined | null): string =>
  (value || '').trim().replace(/\s+/g, ' ').toLowerCase()

/** Best-effort identifier typing: an explicit idType wins; otherwise a
 * 13-digit value is treated as an SA ID and anything else stays 'other'.
 * Passport country is compared only when both sides carry a passport type. */
export function partyIdType(party: Pick<Party, 'idNumber' | 'idType'>): PartyIdType | null {
  if (party.idType) return party.idType
  const normalized = normalizeIdentifier(party.idNumber)
  if (!normalized) return null
  return /^\d{13}$/.test(normalized) ? 'sa_id' : 'other'
}

export interface PartyDuplicateCheck {
  /** Same identifier of the same type — strong signal. */
  identifierMatches: Party[]
  /** Same normalized full name — weak signal. */
  nameMatches: Party[]
}

/**
 * Advisory in-matter duplicate check. Compares only LIKE identifier types:
 * an SA ID never matches a passport number, and passport country must agree
 * when both records carry one. This never merges or blocks — callers only warn.
 */
export function findPotentialDuplicates(candidate: Party, existing: Party[]): PartyDuplicateCheck {
  const candidateId = normalizeIdentifier(candidate.idNumber)
  const candidateType = partyIdType(candidate)
  const candidateCountry = (candidate.passportCountry || '').trim().toUpperCase()
  const candidateName = normalizeName(candidate.name)

  const identifierMatches: Party[] = []
  const nameMatches: Party[] = []

  for (const other of existing) {
    if (other.id === candidate.id) continue

    if (candidateId) {
      const otherId = normalizeIdentifier(other.idNumber)
      const otherType = partyIdType(other)
      if (otherId && candidateType === otherType) {
        const sameIdentifier = otherId === candidateId
        const countriesCompatible =
          candidateType !== 'passport' ||
          !candidateCountry ||
          !(other.passportCountry || '').trim() ||
          (other.passportCountry || '').trim().toUpperCase() === candidateCountry
        if (sameIdentifier && countriesCompatible) {
          identifierMatches.push(other)
          continue
        }
      }
    }

    if (candidateName && normalizeName(other.name) === candidateName) {
      nameMatches.push(other)
    }
  }

  return { identifierMatches, nameMatches }
}

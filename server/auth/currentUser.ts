export class CurrentUser {
  user_id: number
  golden_record_id: string | null
  abilities: string[]
  accountable_institution_id: number
  user_roles_id: number
  tenant_id: string | null

  constructor(data: {
    user_id: number
    golden_record_id?: string | null
    abilities?: string[]
    accountable_institution_id: number
    user_roles_id: number
    tenant_id?: string | null
  }) {
    this.user_id = data.user_id
    this.golden_record_id = data.golden_record_id ?? null
    this.abilities = data.abilities ?? []
    this.accountable_institution_id = data.accountable_institution_id
    this.user_roles_id = data.user_roles_id
    this.tenant_id = data.tenant_id ?? null
  }

  hasAbility(ability: string): boolean {
    return this.abilities.includes(ability)
  }

  isRole(...roles: number[]): boolean {
    return roles.includes(this.user_roles_id)
  }

  /**
   * user_roles_id === 1 (Super Admin) — documented in Transfers handover §4.3.
   */
  get isSuperAdmin(): boolean {
    return this.user_roles_id === 1
  }

  /**
   * user_roles_id === 4 (Client) — documented in Transfers handover §4.3.
   */
  get isClient(): boolean {
    return this.user_roles_id === 4
  }

  toJSON() {
    return {
      user_id: this.user_id,
      golden_record_id: this.golden_record_id,
      abilities: this.abilities,
      accountable_institution_id: this.accountable_institution_id,
      user_roles_id: this.user_roles_id,
      tenant_id: this.tenant_id,
    }
  }
}

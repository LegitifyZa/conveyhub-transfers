# Legitify ConveyHub - Visual ERD

## ASCII Entity Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                    USERS                                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│ • id (UUID) PK                                                              │
│ • email (VARCHAR) UNIQUE                                                     │
│ • name (VARCHAR)                                                            │
│ • role (ENUM: admin|user|conveyancer)                                       │
│ • created_at (TIMESTAMP)                                                     │
│ • updated_at (TIMESTAMP)                                                     │
└─────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ 1
                                    │
                                    │ ∞
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                  AUDIT_LOG                                    │
├─────────────────────────────────────────────────────────────────────────────────┤
│ • id (UUID) PK                                                              │
│ • table_name (VARCHAR)                                                      │
│ • record_id (UUID)                                                          │
│ • action (ENUM: INSERT|UPDATE|DELETE)                                       │
│ • old_values (JSONB)                                                         │
│ • new_values (JSONB)                                                         │
│ • user_id (UUID) FK → users.id                                              │
│ • timestamp (TIMESTAMP)                                                     │
└─────────────────────────────────────────────────────────────────────────────────┘
                                    ▲
                                    │ 1
                                    │
                                    │ ∞
                                    │
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                 TRANSFERS                                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│ • id (UUID) PK                                                              │
│ • transfer_id (VARCHAR) UNIQUE                                              │
│ • property_address (TEXT)                                                    │
│ • purchase_price (DECIMAL)                                                  │
│ • transfer_duty (DECIMAL)                                                    │
│ • conveyancing_fees (DECIMAL)                                               │
│ • deeds_office_fees (DECIMAL)                                                │
│ • vat (DECIMAL)                                                             │
│ • total_costs (DECIMAL)                                                     │
│ • status (ENUM: draft|in_progress|completed|cancelled)                        │
│ • current_step (INTEGER)                                                     │
│ • total_steps (INTEGER)                                                     │
│ • progress (INTEGER)                                                         │
│ • created_at (TIMESTAMP)                                                     │
│ • updated_at (TIMESTAMP)                                                     │
└─────────────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
                    │ 1                             │ 1
                    │ ∞                             │ ∞
                    ▼                               ▼
┌─────────────────────────────────────────┐   ┌─────────────────────────────────────────┐
│                PARTIES                   │   │               DOCUMENTS                │
├─────────────────────────────────────────┤   ├─────────────────────────────────────────┤
│ • id (UUID) PK                         │   │ • id (UUID) PK                         │
│ • transfer_id (UUID) FK → transfers.id │   │ • transfer_id (UUID) FK → transfers.id │
│ • name (VARCHAR)                       │   │ • name (VARCHAR)                       │
│ • type (ENUM: buyer|seller)            │   │ • file_path (TEXT)                     │
│ • id_number (VARCHAR)                   │   │ • file_size (INTEGER)                  │
│ • registration_number (VARCHAR)         │   │ • file_type (VARCHAR)                  │
│ • email (VARCHAR)                      │   │ • category (VARCHAR)                   │
│ • phone (VARCHAR)                       │   │ • status (ENUM: pending|uploaded|verified|rejected) │
│ • address (TEXT)                        │   │ • uploaded_at (TIMESTAMP)              │
│ • created_at (TIMESTAMP)                │   │ • updated_at (TIMESTAMP)              │
│ • updated_at (TIMESTAMP)                │   └─────────────────────────────────────────┘
└─────────────────────────────────────────┘
```

## Relationship Summary

### Primary Relationships
1. **Users** ↔ **Audit_Log** (1:∞) - Users create audit entries
2. **Transfers** ↔ **Parties** (1:∞) - Transfers have multiple parties
3. **Transfers** ↔ **Documents** (1:∞) - Transfers have multiple documents

### Cascade Relationships
- When a transfer is deleted, all associated parties and documents are deleted
- Audit logs are preserved for compliance

### Key Constraints
- **UUID Primary Keys**: All tables use UUID for scalability
- **Foreign Keys**: Referential integrity maintained
- **Check Constraints**: Enum values validated at database level
- **Unique Constraints**: Transfer IDs and user emails are unique

### Data Flow
```
User creates Transfer → Parties added → Documents uploaded → Status updates → Audit trail
```

### Business Rules
- Each transfer must have at least one buyer and one seller
- Documents must be associated with a transfer
- All changes are audited with user attribution
- Transfer progress is automatically calculated

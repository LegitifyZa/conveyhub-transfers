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
│                                 PROPERTIES                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│ • id (UUID) PK                                                              │
│ • property_id (VARCHAR) UNIQUE                                              │
│ • erf_number (VARCHAR)                                                       │
│ • street_address (TEXT)                                                      │
│ • suburb (VARCHAR)                                                           │
│ • city (VARCHAR)                                                             │
│ • postal_code (VARCHAR)                                                       │
│ • province (VARCHAR)                                                         │
│ • country (VARCHAR)                                                          │
│ • property_type (ENUM: residential|commercial|industrial|agricultural|vacant_land) │
│ • title_deed_number (VARCHAR)                                                │
│ • survey_general_number (VARCHAR)                                              │
│ • extent_sqm (DECIMAL)                                                      │
│ • zoning (VARCHAR)                                                           │
│ • rates_number (VARCHAR)                                                      │
│ • municipal_valuation (DECIMAL)                                               │
│ • year_built (INTEGER)                                                       │
│ • bedrooms (INTEGER)                                                          │
│ • bathrooms (INTEGER)                                                         │
│ • garages (INTEGER)                                                          │
│ • parking_spaces (INTEGER)                                                     │
│ • swimming_pool (BOOLEAN)                                                     │
│ • security_features (TEXT)                                                    │
│ • description (TEXT)                                                          │
│ • latitude (DECIMAL)                                                         │
│ • longitude (DECIMAL)                                                        │
│ • status (ENUM: active|inactive|sold|under_offer|suspended)                 │
│ • created_at (TIMESTAMP)                                                     │
│ • updated_at (TIMESTAMP)                                                     │
└─────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ 1
                                    │ ∞
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                 TRANSFERS                                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│ • id (UUID) PK                                                              │
│ • transfer_id (VARCHAR) UNIQUE                                              │
│ • property_id (UUID) FK → properties.id                                      │
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
2. **Properties** ↔ **Transfers** (1:∞) - Properties can have multiple transfers
3. **Transfers** ↔ **Parties** (1:∞) - Transfers have multiple parties
4. **Transfers** ↔ **Documents** (1:∞) - Transfers have multiple documents

### Cascade Relationships
- When a transfer is deleted, all associated parties and documents are deleted
- When a property is deleted, transfers are set to NULL (preserve transfer history)
- Audit logs are preserved for compliance

### Key Constraints
- **UUID Primary Keys**: All tables use UUID for scalability
- **Foreign Keys**: Referential integrity maintained
- **Check Constraints**: Enum values validated at database level
- **Unique Constraints**: Property IDs and user emails are unique
- **Data Validation**: SA ID numbers and postal codes validated

### Data Flow
```
Property Registration → Transfer Creation → Parties Added → Documents Uploaded → Status updates → Audit trail
```

### Business Rules
- Each transfer must be linked to a property
- Each transfer must have at least one buyer and one seller
- Documents must be associated with a transfer
- All changes are audited with user attribution
- Properties can exist without transfers (pre-registration)
- Transfers can exist without properties (legacy data)

### Property Features
- **Geospatial Support**: Latitude/longitude for mapping
- **Multiple Property Types**: Residential, commercial, industrial, agricultural, vacant land
- **Detailed Attributes**: Bedrooms, bathrooms, garages, amenities
- **Municipal Integration**: Rates numbers, valuations, zoning
- **South African Specific**: ERF numbers, title deeds, survey numbers
- Transfer progress is automatically calculated

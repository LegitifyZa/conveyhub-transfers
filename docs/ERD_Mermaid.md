# Legitify ConveyHub - Mermaid ERD

## Entity Relationship Diagram (Mermaid)

```mermaid
erDiagram
    USERS {
        uuid id PK
        varchar email UK
        varchar name
        enum role
        timestamp created_at
        timestamp updated_at
    }
    
    PROPERTIES {
        uuid id PK
        varchar property_id UK
        varchar erf_number
        text street_address
        varchar suburb
        varchar city
        varchar postal_code
        varchar province
        varchar country
        enum property_type
        varchar title_deed_number
        varchar survey_general_number
        decimal extent_sqm
        varchar zoning
        varchar rates_number
        decimal municipal_valuation
        integer year_built
        integer bedrooms
        integer bathrooms
        integer garages
        integer parking_spaces
        boolean swimming_pool
        text security_features
        text description
        decimal latitude
        decimal longitude
        enum status
        timestamp created_at
        timestamp updated_at
    }
    
    TRANSFERS {
        uuid id PK
        varchar transfer_id UK
        uuid property_id FK
        text property_address
        decimal purchase_price
        decimal transfer_duty
        decimal conveyancing_fees
        decimal deeds_office_fees
        decimal vat
        decimal total_costs
        enum status
        integer current_step
        integer total_steps
        integer progress
        timestamp created_at
        timestamp updated_at
    }
    
    PARTIES {
        uuid id PK
        uuid transfer_id FK
        varchar name
        enum type
        varchar id_number
        varchar registration_number
        varchar email
        varchar phone
        text address
        timestamp created_at
        timestamp updated_at
    }
    
    DOCUMENTS {
        uuid id PK
        uuid transfer_id FK
        varchar name
        text file_path
        integer file_size
        varchar file_type
        varchar category
        enum status
        timestamp uploaded_at
        timestamp updated_at
    }
    
    AUDIT_LOG {
        uuid id PK
        varchar table_name
        uuid record_id
        enum action
        jsonb old_values
        jsonb new_values
        uuid user_id FK
        timestamp timestamp
    }
    
    USERS ||--o{ AUDIT_LOG : creates
    PROPERTIES ||--o{ TRANSFERS : has
    TRANSFERS ||--o{ PARTIES : has
    TRANSFERS ||--o{ DOCUMENTS : contains
    USERS ||--o{ AUDIT_LOG : modifies
```

## Relationship Types

### One-to-Many Relationships
- **USERS** to **AUDIT_LOG**: One user can create many audit entries
- **PROPERTIES** to **TRANSFERS**: One property can have many transfers
- **TRANSFERS** to **PARTIES**: One transfer can have many parties
- **TRANSFERS** to **DOCUMENTS**: One transfer can have many documents

### Cascade Delete Rules
- Deleting a TRANSFER deletes associated PARTIES and DOCUMENTS
- Deleting a PROPERTY sets TRANSFER.property_id to NULL (preserves history)
- AUDIT_LOG entries are preserved for compliance

## Enum Values

### User Roles
- `admin` - System administrator
- `user` - Regular user
- `conveyancer` - Legal practitioner

### Property Types
- `residential` - Residential property
- `commercial` - Commercial property
- `industrial` - Industrial property
- `agricultural` - Agricultural land
- `vacant_land` - Vacant land

### Property Status
- `active` - Currently available
- `inactive` - Not available
- `sold` - Sold and transferred
- `under_offer` - Offer pending
- `suspended` - Temporarily suspended

### Transfer Status
- `draft` - Initial state
- `in_progress` - Active transfer
- `completed` - Finished transfer
- `cancelled` - Cancelled transfer

### Party Types
- `buyer` - Property purchaser
- `seller` - Property seller

### Document Status
- `pending` - Awaiting upload
- `uploaded` - File uploaded
- `verified` - Document verified
- `rejected` - Document rejected

### Audit Actions
- `INSERT` - Record creation
- `UPDATE` - Record modification
- `DELETE` - Record deletion

## Database Features

### Triggers
- Auto-update `updated_at` timestamps
- Calculate transfer progress on step change
- Audit logging for all modifications

### Views
- `property_details` - Aggregated property data
- `transfer_summary` - Aggregated transfer data
- `party_details` - Party with transfer information
- `document_details` - Document with transfer context

### Indexes
- Performance optimization on foreign keys
- Search indexes on email, name, status
- Geospatial indexes on latitude/longitude
- Time-based indexes for reporting

### Property Features
- **Geospatial**: Latitude/longitude for mapping
- **South African Specific**: ERF numbers, title deeds, survey numbers
- **Municipal Integration**: Rates numbers, valuations, zoning
- **Comprehensive Attributes**: Bedrooms, bathrooms, amenities, security

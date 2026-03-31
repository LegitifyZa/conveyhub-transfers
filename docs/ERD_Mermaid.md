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
    
    TRANSFERS {
        uuid id PK
        varchar transfer_id UK
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
    TRANSFERS ||--o{ PARTIES : has
    TRANSFERS ||--o{ DOCUMENTS : contains
    USERS ||--o{ AUDIT_LOG : modifies
```

## Relationship Types

### One-to-Many Relationships
- **USERS** to **AUDIT_LOG**: One user can create many audit entries
- **TRANSFERS** to **PARTIES**: One transfer can have many parties
- **TRANSFERS** to **DOCUMENTS**: One transfer can have many documents

### Cascade Delete Rules
- Deleting a TRANSFER deletes associated PARTIES and DOCUMENTS
- AUDIT_LOG entries are preserved for compliance

## Enum Values

### User Roles
- `admin` - System administrator
- `user` - Regular user
- `conveyancer` - Legal practitioner

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
- `transfer_summary` - Aggregated transfer data
- `party_details` - Party with transfer information
- `document_details` - Document with transfer context

### Indexes
- Performance optimization on foreign keys
- Search indexes on email, name, status
- Time-based indexes for reporting

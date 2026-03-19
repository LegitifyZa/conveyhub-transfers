# PostgreSQL Database Setup for Legitify ConveyHub

This guide will help you set up and connect your PostgreSQL database for the Legitify ConveyHub application.

## Prerequisites

- PostgreSQL 12+ installed
- Database user with appropriate permissions
- Node.js and npm installed

## Quick Setup

### 1. Update Environment Variables

Copy the example environment file and update it with your PostgreSQL credentials:

```bash
cp .env.example .env
```

Update the `.env` file with your database details:

```env
# PostgreSQL Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=legitify_convey_hub
DB_USER=your_username
DB_PASSWORD=your_password
DB_SSL=false

# Database Connection Pool Settings
DB_MIN_CONNECTIONS=2
DB_MAX_CONNECTIONS=10

# Application Configuration
NODE_ENV=development
PORT=3000
API_BASE_URL=http://localhost:3000/api
```

### 2. Create Database

Connect to PostgreSQL and create the database:

```sql
-- Connect to PostgreSQL
psql -U postgres

-- Create database
CREATE DATABASE legitify_convey_hub;

-- Create user (optional, if you want a dedicated user)
CREATE USER legitify_user WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE legitify_convey_hub TO legitify_user;

-- Exit
\q
```

### 3. Run Database Migration

The application will automatically create the database schema on first run. The migration file is located at:

```
src/lib/migrations/001_initial_schema.sql
```

You can also run it manually:

```bash
psql -U your_username -d legitify_convey_hub -f src/lib/migrations/001_initial_schema.sql
```

## Database Schema

### Tables

#### `users`
- User accounts and authentication
- Roles: admin, user, conveyancer

#### `transfers`
- Main transfer records
- Property details and financial information
- Status tracking and progress

#### `parties`
- Buyer and seller information
- ID numbers and contact details

#### `documents`
- Document uploads and metadata
- File tracking and status

#### `audit_log`
- Change tracking and audit trail
- Automatic logging of all database changes

### Views

#### `transfer_summary`
- Aggregated transfer information with party and document counts

#### `party_details`
- Complete party information with transfer context

#### `document_details`
- Complete document information with transfer context

## Features

### Automatic ID Generation
- Transfer IDs are automatically generated in format: `TRF-YYYY-MMDD-XXX`
- Built-in uniqueness checking

### Progress Tracking
- Automatic progress calculation based on current step
- Progress percentage updates when steps change

### Audit Trail
- Automatic logging of all INSERT, UPDATE, DELETE operations
- Complete change history with timestamps

### Data Validation
- South African ID number validation
- Email format validation
- Check constraints for data integrity

## Connection Testing

The application includes a database status component that shows:

- Connection status
- Table statistics
- Real-time connection testing
- Error handling and retry functionality

## Performance Features

### Connection Pooling
- Configurable minimum and maximum connections
- Automatic connection management
- Connection timeout handling

### Indexes
- Optimized indexes for common queries
- Composite indexes for complex searches
- Full-text search capabilities

### Views
- Pre-computed aggregations for faster reporting
- Simplified complex queries
- Security through abstraction

## Development

### Database Hooks

```typescript
import { db, initializeDatabase } from './lib/database'

// Initialize database on app start
await initializeDatabase()

// Test connection
const connected = await db.testConnection()

// Execute queries
const result = await db.query('SELECT * FROM transfers')

// Use transactions
await db.transaction(async (client) => {
  await client.query('INSERT INTO transfers ...')
  await client.query('INSERT INTO parties ...')
})
```

### Service Layer

```typescript
import { TransferService } from './lib/services/transferService'
import { TransferApi } from './lib/api/transferApi'

// Get transfers with filtering
const transfers = await TransferApi.getTransfers({
  status: 'in_progress',
  page: 1,
  limit: 10
})

// Create new transfer
const transfer = await TransferApi.createTransfer({
  property_address: '123 Main St',
  purchase_price: 2500000
})
```

### React Hooks

```typescript
import { useDatabase } from './hooks/useDatabase'
import { useTransfers } from './hooks/useTransfers'

function MyComponent() {
  const { isConnected, stats } = useDatabase()
  const { transfers, fetchTransfers, createTransfer } = useTransfers()

  // Fetch transfers
  useEffect(() => {
    fetchTransfers()
  }, [])

  // Create new transfer
  const handleCreate = async () => {
    await createTransfer({
      property_address: '123 Main St',
      purchase_price: 2500000
    })
  }
}
```

## Security Considerations

### Environment Variables
- Never commit `.env` files to version control
- Use strong passwords
- Enable SSL in production

### Database Permissions
- Use least privilege principle
- Separate read/write permissions
- Regular user access reviews

### Data Protection
- Sensitive data encryption
- Regular backups
- Audit log monitoring

## Production Setup

### Connection Security
```env
DB_SSL=true
DB_SSL_MODE=require
```

### Performance Tuning
```env
DB_MIN_CONNECTIONS=5
DB_MAX_CONNECTIONS=20
```

### Monitoring
- Connection pool monitoring
- Query performance tracking
- Error rate monitoring

## Troubleshooting

### Common Issues

#### Connection Failed
- Check PostgreSQL service is running
- Verify database credentials
- Check network connectivity
- Ensure database exists

#### Migration Errors
- Check PostgreSQL version compatibility
- Verify user permissions
- Check for existing tables

#### Performance Issues
- Review query execution plans
- Check connection pool settings
- Monitor database resources

### Debug Mode

Enable detailed logging:

```env
NODE_ENV=development
DEBUG=database:*
```

## Backup and Recovery

### Manual Backup
```bash
pg_dump -U your_username -d legitify_convey_hub > backup.sql
```

### Restore
```bash
psql -U your_username -d legitify_convey_hub < backup.sql
```

### Automated Backups
Set up cron jobs for regular backups:

```bash
# Daily backup at 2 AM
0 2 * * * pg_dump -U your_username -d legitify_convey_hub > /backups/legitify_$(date +\%Y\%m\%d).sql
```

## Support

For database-related issues:

1. Check the application logs
2. Test connection manually with `psql`
3. Review PostgreSQL logs
4. Check system resources

## Next Steps

1. Set up your PostgreSQL database
2. Configure environment variables
3. Test the connection
4. Run the application
5. Verify database operations

The database is now ready to support your Legitify ConveyHub application!

import { initializeDatabase, db } from './lib/database'
import { DatabaseUtils } from './lib/utils/databaseUtils'
import { TransferApi } from './lib/api/transferApi'

async function testDatabaseConnection() {
  console.log('🔍 Testing PostgreSQL connection...')
  
  try {
    // Test basic connection
    const connected = await db.testConnection()
    if (!connected) {
      console.error('❌ Database connection failed')
      return
    }
    
    console.log('✅ Database connection successful')
    
    // Test table creation
    await initializeDatabase()
    console.log('✅ Database tables created successfully')
    
    // Test utilities
    const transferId = await DatabaseUtils.generateUniqueTransferId()
    console.log(`✅ Generated transfer ID: ${transferId}`)
    
    // Test table stats
    const stats = await DatabaseUtils.getTableStats()
    console.log('✅ Table statistics:', stats)
    
    // Test transfer creation
    const transfer = await TransferApi.createTransfer({
      property_address: '123 Test Street, Cape Town',
      purchase_price: 2500000
    })
    
    if (transfer.success && transfer.data) {
      console.log(`✅ Created test transfer: ${transfer.data.transfer_id}`)
      
      // Test fetching transfers
      const transfers = await TransferApi.getTransfers()
      if (transfers.success && transfers.data) {
        console.log(`✅ Found ${transfers.data.length} transfers`)
      }
    }
    
    console.log('🎉 All database tests passed!')
    
  } catch (error) {
    console.error('❌ Database test failed:', error)
  } finally {
    // Close connection
    await db.close()
    console.log('🔌 Database connection closed')
  }
}

// Run the test
testDatabaseConnection().catch(console.error)

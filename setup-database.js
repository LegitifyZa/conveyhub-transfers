import fs from 'fs'
import readline from 'readline'

// Interactive database setup script
const setupDatabase = async () => {
  console.log('🗄️ PostgreSQL Database Setup for Legitify ConveyHub')
  console.log('================================================\n')

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  const askQuestion = (question) => {
    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        resolve(answer.trim())
      })
    })
  }

  try {
    // Get database configuration
    console.log('📋 Please provide your PostgreSQL connection details:\n')

    const host = await askQuestion('Database host (localhost): ') || 'localhost'
    const port = await askQuestion('Database port (5432): ') || '5432'
    const database = await askQuestion('Database name (goldenrecordstemp): ') || 'goldenrecordstemp'
    const username = await askQuestion('Database username: ')
    const password = await askQuestion('Database password: ')

    // Create .env file
    const envContent = `# PostgreSQL Database Configuration
DB_HOST=${host}
DB_PORT=${port}
DB_NAME=${database}
DB_USER=${username}
DB_PASSWORD=${password}
DB_SSL=false

# Database Connection Pool Settings
DB_MIN_CONNECTIONS=2
DB_MAX_CONNECTIONS=10

# Application Configuration
NODE_ENV=development
PORT=3000
API_BASE_URL=http://localhost:3000/api
`

    // Write to .env file
    fs.writeFileSync('.env', envContent)
    
    console.log('\n✅ Environment configuration saved to .env')
    console.log('\n🔧 Next steps:')
    console.log('1. Make sure PostgreSQL is running')
    console.log('2. Create the database if it doesn\'t exist:')
    console.log(`   CREATE DATABASE ${database};`)
    console.log('3. Create user if needed:')
    console.log(`   CREATE USER ${username} WITH PASSWORD \'your_password\';`)
    console.log('4. Grant permissions:')
    console.log(`   GRANT ALL PRIVILEGES ON DATABASE ${database} TO ${username};`)
    console.log('\n🚀 Then run: npm run test:db')
    
    rl.close()
    
  } catch (error) {
    console.error('❌ Setup failed:', error.message)
    rl.close()
    process.exit(1)
  }
}

// Run setup
setupDatabase()

const mongoose = require('mongoose')

async function connectDB() {
  const mongoUri = process.env.MONGODB_URI

  if (!mongoUri) {
    console.log('MONGODB_URI not set. Skipping MongoDB connection.')
    return null
  }

  const connection = await mongoose.connect(mongoUri)
  console.log(`MongoDB connected: ${connection.connection.host}`)

  return connection
}

module.exports = connectDB

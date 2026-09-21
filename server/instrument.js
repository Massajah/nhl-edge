require('dotenv').config({ quiet: true })

const { initializeServerSentry } = require('./monitoring/sentry')

initializeServerSentry()

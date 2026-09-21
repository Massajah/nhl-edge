require('../instrument')

const { captureExceptionAndFlush } = require('../monitoring/sentry')

const verifySentry = async () => {
  if (!String(process.env.SENTRY_DSN ?? '').trim()) {
    throw new Error('SENTRY_DSN is required for controlled verification.')
  }

  const flushed = await captureExceptionAndFlush(
    new Error('NHL Edge controlled server Sentry verification'),
  )

  if (!flushed) {
    throw new Error('Sentry did not confirm that the verification event flushed.')
  }

  console.log('Controlled server Sentry verification event flushed.')
}

if (require.main === module) {
  verifySentry().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}

module.exports = { verifySentry }

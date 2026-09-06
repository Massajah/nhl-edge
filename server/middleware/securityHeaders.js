const securityHeaders = (_request, response, next) => {
  response.set({
    'Content-Security-Policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
      + ', payment=(), usb=()',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  })

  if (process.env.NODE_ENV === 'production') {
    response.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }

  next()
}

module.exports = securityHeaders

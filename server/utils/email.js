const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const normalizeEmail = (email) =>
  typeof email === 'string' ? email.trim().toLowerCase() : ''

const isValidEmail = (email) => EMAIL_PATTERN.test(normalizeEmail(email))

module.exports = {
  isValidEmail,
  normalizeEmail,
}

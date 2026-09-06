const express = require('express')
const authController = require('../controllers/authController')
const authenticate = require('../middleware/authenticate')
const { authRateLimit } = require('../middleware/rateLimit')

const router = express.Router()

router.use((_request, response, next) => {
  response.set('Cache-Control', 'no-store')
  next()
})

router.post('/register', authRateLimit, authController.register)
router.post('/login', authRateLimit, authController.login)
router.post('/google', authRateLimit, authController.google)
router.get('/me', authenticate, authController.me)
router.post('/logout', authController.logout)

module.exports = router

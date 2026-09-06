const requireRole = (...allowedRoles) => (request, response, next) => {
  if (!request.user || !allowedRoles.includes(request.user.role)) {
    response.status(403).json({
      error: 'You do not have permission to perform this operation.',
      message: 'You do not have permission to perform this operation.',
    })
    return
  }

  next()
}

module.exports = { requireRole }

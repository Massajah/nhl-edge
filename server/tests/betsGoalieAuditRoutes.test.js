process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const app = require('../app')
const authSessionService = require('../services/authSessionService')
const startingGoalieAuditService = require('../services/startingGoalieAuditService')

const OWNER_ID = '507f1f77bcf86cd799439011'
const BET_ID = '507f1f77bcf86cd799439001'

const request = async (path, options = {}) => {
  const server = app.listen(0)
  try {
    const { port } = server.address()
    return await fetch(`http://127.0.0.1:${port}${path}`, options)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

test('goalie audit route authenticates and takes ownership and demo status from session', async (t) => {
  const originalResolve = authSessionService.resolveAuthSession
  const originalAudit = startingGoalieAuditService.getBetsStartingGoalieAudits
  t.after(() => {
    authSessionService.resolveAuthSession = originalResolve
    startingGoalieAuditService.getBetsStartingGoalieAudits = originalAudit
  })
  let user = { _id: OWNER_ID, accountType: 'NORMAL' }
  const calls = []
  authSessionService.resolveAuthSession = async () => ({ session: {}, user })
  startingGoalieAuditService.getBetsStartingGoalieAudits = async (...args) => {
    calls.push(args)
    return { audits: { [BET_ID]: null } }
  }

  const unauthenticated = await request(`/api/bets/goalie-audit?betIds=${BET_ID}`)
  assert.equal(unauthenticated.status, 401)
  assert.equal(calls.length, 0)

  const path = `/api/bets/goalie-audit?betIds=${BET_ID}&userId=foreign-user`
  const headers = { Cookie: 'nhl_edge_session=test-session' }
  const normal = await request(path, { headers })
  assert.equal(normal.status, 200)
  assert.deepEqual(await normal.json(), { audits: { [BET_ID]: null } })
  assert.equal(calls[0][0], OWNER_ID)
  assert.equal(calls[0][1], BET_ID)
  assert.equal(calls[0][2].demo, false)

  user = { _id: OWNER_ID, accountType: 'DEMO_SANDBOX' }
  const demo = await request(path, { headers })
  assert.equal(demo.status, 200)
  assert.equal(calls[1][2].demo, true)
})

const { stableSerialize } = require('./calibrationIdentity')
const { CANDIDATE_TYPES } = require('./calibrationResultContract')

const FAMILY_LABELS = Object.freeze({
  [CANDIDATE_TYPES.QUICK_REMATCH]: 'Quick Rematch',
  [CANDIDATE_TYPES.REST_FATIGUE]: 'Rest & Fatigue',
  [CANDIDATE_TYPES.SPECIAL_TEAMS]: 'Special Teams',
  [CANDIDATE_TYPES.TEAM_HOME_ADVANTAGE]: 'Team Home Advantage',
})

const FIELD_LABELS = Object.freeze({
  backToBackAdjustment: 'Back-to-Back Adjustment',
  backToBackEnabled: 'Back-to-Back Enabled',
  backToBackTravelAdjustment: 'Back-to-Back + Travel Adjustment',
  backToBackTravelEnabled: 'Back-to-Back + Travel Enabled',
  quickRematchEnabled: 'Enabled',
  quickRematchLoserAdjustment: 'Previous-loser Adjustment',
  quickRematchMaximumDays: 'Maximum Days',
  restFatigueEnabled: 'Enabled',
  specialTeamsAdjustment: 'Adjustment',
  specialTeamsAlertsEnabled: 'Alerts Enabled',
  specialTeamsMode: 'Mode',
  specialTeamsRankThreshold: 'Top / Bottom N',
  threeInFourAdjustment: '3 Games in 4 Days Adjustment',
  threeInFourEnabled: '3 Games in 4 Days Enabled',
  wellRestedAdjustment: 'Well Rested Adjustment',
  wellRestedEnabled: 'Well Rested Enabled',
})

const getFieldEntries = (family, state) => {
  if (family === CANDIDATE_TYPES.TEAM_HOME_ADVANTAGE) {
    return Object.entries(state.teamAdjustments).map(([teamId, value]) => ({
      label: teamId,
      path: `teamAdjustments.${teamId}`,
      value,
    }))
  }

  return Object.entries(state).map(([path, value]) => ({
    label: FIELD_LABELS[path] ?? path,
    path,
    value,
  }))
}

const buildDiff = ({ affectedFamilies, currentProduction, proposedProduction }) => {
  const groups = affectedFamilies.map((family) => {
    const beforeByPath = new Map(
      getFieldEntries(family, currentProduction[family]).map((entry) => [
        entry.path,
        entry,
      ]),
    )
    const afterEntries = getFieldEntries(family, proposedProduction[family])
    const fields = afterEntries.map((after) => {
      const before = beforeByPath.get(after.path)?.value ?? null

      return {
        after: after.value,
        before,
        changed: stableSerialize(before) !== stableSerialize(after.value),
        label: after.label,
        path: after.path,
      }
    })

    return { family, fields, label: FAMILY_LABELS[family] }
  })
  const flattened = groups.flatMap((group) => group.fields.map((field) => ({
    ...field,
    family: group.family,
    familyLabel: group.label,
  })))

  return {
    changes: flattened.filter((field) => field.changed),
    groups,
    unchanged: flattened.filter((field) => !field.changed),
  }
}

module.exports = {
  FAMILY_LABELS,
  FIELD_LABELS,
  buildDiff,
  getFieldEntries,
}

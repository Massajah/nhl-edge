const mongoose = require('mongoose')
const PowerRating = require('../models/PowerRating')
const { buildSeasonDiscoveryEnvelope } = require('./nhlSeasonService')
const { getFirstSeasonRatingBeforeByTeam } = require('./powerRatingsService')

const previewSeasonStartingRatingRepair = async ({
  userId,
  seasonId,
  powerRatingModel = PowerRating,
  processedRatingGameModel,
}) => {
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw new Error('A valid owner userId is required.')
  }
  const normalizedSeasonId = buildSeasonDiscoveryEnvelope(seasonId).id
  const firstBefore = await getFirstSeasonRatingBeforeByTeam(
    userId,
    normalizedSeasonId,
    { processedRatingGameModel },
  )
  const ratings = await powerRatingModel.find({ userId })
    .select('_id teamId seasonStartingRating seasonStartingRatingSeasonId')
    .lean()
  const candidates = []
  let withoutHistory = 0
  let outsideTargetSeason = 0

  for (const rating of ratings) {
    if (
      rating.seasonStartingRatingSeasonId &&
      rating.seasonStartingRatingSeasonId !== normalizedSeasonId
    ) {
      outsideTargetSeason += 1
      continue
    }
    const original = firstBefore.get(String(rating.teamId ?? '').trim().toUpperCase())
    if (!original) {
      withoutHistory += 1
      continue
    }
    if (
      rating.seasonStartingRating === original.rating
    ) {
      continue
    }
    candidates.push({
      ratingId: rating._id,
      teamId: rating.teamId,
      storedRating: rating.seasonStartingRating ?? null,
      storedSeasonId: rating.seasonStartingRatingSeasonId ?? null,
      recoveredRating: original.rating,
      firstGameId: original.gameId,
      firstGameDate: original.gameDate,
    })
  }

  return {
    candidates,
    reviewedRatings: ratings.length,
    seasonId: normalizedSeasonId,
    outsideTargetSeason,
    withoutHistory,
  }
}

const applySeasonStartingRatingRepair = async (args) => {
  if (!args.confirm) {
    throw new Error('Explicit confirmation is required to write Starting Ratings.')
  }
  const powerRatingModel = args.powerRatingModel ?? PowerRating
  const preview = await previewSeasonStartingRatingRepair(args)
  let repairedCount = 0

  for (const candidate of preview.candidates) {
    const result = await powerRatingModel.updateOne({
      _id: candidate.ratingId,
      userId: args.userId,
      seasonStartingRating: candidate.storedRating,
      seasonStartingRatingSeasonId: candidate.storedSeasonId,
    }, {
      $set: {
        seasonStartingRating: candidate.recoveredRating,
        seasonStartingRatingSeasonId: preview.seasonId,
      },
    })
    if (result.matchedCount !== 1) {
      throw new Error(`Starting Rating changed during repair for ${candidate.teamId}. Re-run the preview.`)
    }
    repairedCount += 1
  }

  return { ...preview, repairedCount }
}

module.exports = {
  applySeasonStartingRatingRepair,
  previewSeasonStartingRatingRepair,
}

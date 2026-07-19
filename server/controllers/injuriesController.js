const injuriesService = require('../services/injuriesService')

const getInjuries = async (request, response, next) => {
  try {
    const injuries = await injuriesService.getInjuries(request.user.id)

    response.json({ injuries })
  } catch (error) {
    next(error)
  }
}

const getTeamInjuries = async (request, response, next) => {
  try {
    const injuries = await injuriesService.getTeamInjuries(
      request.user.id,
      request.params.teamId,
    )

    response.json({ injuries })
  } catch (error) {
    next(error)
  }
}

const getTeamInjurySummary = async (request, response, next) => {
  try {
    const summary = await injuriesService.getTeamInjurySummary(request.user.id)

    response.json({ summary })
  } catch (error) {
    next(error)
  }
}

const createInjury = async (request, response, next) => {
  try {
    const injury = await injuriesService.createInjury(request.user.id, request.body)

    response.status(201).json({ injury })
  } catch (error) {
    next(error)
  }
}

const updateInjury = async (request, response, next) => {
  try {
    const injury = await injuriesService.updateInjury(
      request.user.id,
      request.params.id,
      request.body,
    )

    response.json({ injury })
  } catch (error) {
    next(error)
  }
}

const deleteInjury = async (request, response, next) => {
  try {
    const injury = await injuriesService.deleteInjury(
      request.user.id,
      request.params.id,
    )

    response.json({ injury })
  } catch (error) {
    next(error)
  }
}

module.exports = {
  createInjury,
  deleteInjury,
  getInjuries,
  getTeamInjuries,
  getTeamInjurySummary,
  updateInjury,
}

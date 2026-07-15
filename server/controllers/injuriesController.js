const injuriesService = require('../services/injuriesService')

const getInjuries = async (_request, response, next) => {
  try {
    const injuries = await injuriesService.getInjuries()

    response.json({ injuries })
  } catch (error) {
    next(error)
  }
}

const getTeamInjuries = async (request, response, next) => {
  try {
    const injuries = await injuriesService.getTeamInjuries(request.params.teamId)

    response.json({ injuries })
  } catch (error) {
    next(error)
  }
}

const getTeamInjurySummary = async (_request, response, next) => {
  try {
    const summary = await injuriesService.getTeamInjurySummary()

    response.json({ summary })
  } catch (error) {
    next(error)
  }
}

const createInjury = async (request, response, next) => {
  try {
    const injury = await injuriesService.createInjury(request.body)

    response.status(201).json({ injury })
  } catch (error) {
    next(error)
  }
}

const updateInjury = async (request, response, next) => {
  try {
    const injury = await injuriesService.updateInjury(
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
    const injury = await injuriesService.deleteInjury(request.params.id)

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

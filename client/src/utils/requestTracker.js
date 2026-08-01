export const createLatestRequestTracker = () => {
  let latestRequestId = 0

  return {
    invalidate() {
      latestRequestId += 1
    },
    isLatest(requestId) {
      return requestId === latestRequestId
    },
    start() {
      latestRequestId += 1
      const requestId = latestRequestId

      return {
        isLatest: () => requestId === latestRequestId,
        requestId,
      }
    },
  }
}

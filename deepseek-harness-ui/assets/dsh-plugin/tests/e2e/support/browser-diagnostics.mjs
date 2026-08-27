const chromiumHttpStatusConsolePattern = /^Failed to load resource: the server responded with a status of \d{3} \([^)]*\)$/

export function isBrowserHttpConsoleNoise(message) {
  return chromiumHttpStatusConsolePattern.test(message)
}

export function isExpectedClosedSessionNotFound(response, closedSessionUrls) {
  return response.method === 'GET'
    && response.status === 404
    && closedSessionUrls.has(response.url)
}

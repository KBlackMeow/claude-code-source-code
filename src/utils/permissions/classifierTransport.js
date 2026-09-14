/**
 * Choose the classifier request format independently of rollout state.
 * External API-compatible endpoints commonly reject Anthropic's custom tool
 * schema, while the XML path needs only ordinary text messages.
 */
export function selectAutoClassifierTransport(userType, configuredMode) {
  if (
    configuredMode === true ||
    configuredMode === false ||
    configuredMode === 'fast' ||
    configuredMode === 'thinking'
  ) {
    return configuredMode
  }
  return userType === 'ant' ? false : true
}

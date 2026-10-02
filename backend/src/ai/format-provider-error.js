export function providerErrorResponse(error, fallbackMessage) {
  const status = Number(error.status);

  if (status === 429) {
    return {
      status,
      error: fallbackMessage,
      details: "The AI service's request limit was reached. Please try again later.",
    };
  }

  if (status === 503) {
    return {
      status,
      error: fallbackMessage,
      details: "The AI service is temporarily busy. Please try again in a few moments.",
    };
  }

  return {
    status: status >= 400 && status <= 599 ? status : 500,
    error: fallbackMessage,
    details: error.message,
  };
}

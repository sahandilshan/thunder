const THUNDER_BASE_URL =
  import.meta.env.VITE_THUNDER_BASE_URL || "https://localhost:8090";

async function thunderRequest(path, accessToken, options = {}) {
  const headers = {
    Accept: "application/json",
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...options.headers
  };
  const response = await fetch(`${THUNDER_BASE_URL}${path}`, { ...options, headers });
  const text = await response.text();
  const body = text ? safeJson(text) : null;
  if (!response.ok) {
    const message =
      (body && (body.description || body.message || body.error)) ||
      `Request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function getMyUser(accessToken) {
  return thunderRequest(`/users/me`, accessToken);
}

export async function updateMyUser(accessToken, attributes) {
  return thunderRequest(`/users/me`, accessToken, {
    method: "PUT",
    body: JSON.stringify({ attributes })
  });
}

export async function updateMyCredentials(accessToken, attributes) {
  return thunderRequest(`/users/me/update-credentials`, accessToken, {
    method: "POST",
    body: JSON.stringify({ attributes })
  });
}

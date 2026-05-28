# Travel MCP Server

Streamable-HTTP MCP server that wraps the Wayfinder Travel REST API and forwards the incoming `Authorization` header unchanged. No configuration required for local development.

## Tools

- `search_flights` — `GET /api/flights`
- `recommend_flights` — `GET /api/flights/recommended` (requires `booking:recommend`). Returns 1-10 random flights; used when the user asks for "recommendations", "suggestions", "deals", or "what's good today".
- `search_hotels` — `GET /api/hotels`
- `get_trips` — `GET /api/trips`
- `get_locations` — `GET /api/locations`
- `create_booking` — `POST /api/bookings` (requires `booking:create`)
- `get_flight_bookings` — `GET /api/bookings/flights` (requires `booking:read`)
- `delete_all_bookings` — `DELETE /api/bookings/flights` (requires `booking:cancel`)
- `get_profile` — `GET /api/me`

Scope enforcement happens at the REST API, not here.

## Run

```bash
npm install
npm start
```

Endpoints:

- MCP:    `http://localhost:8000/mcp`
- Health: `http://localhost:8000/health`

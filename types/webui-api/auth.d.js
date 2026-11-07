'use strict';

/**
 * WebUI JWT authentication (scenario A — private WebUI).
 *
 * Users, passwords, roles, and 2FA live in the **private WebUI service**. After login the WebUI signs a JWT
 * with `private_webui_secret_key` (same on every bot in the fleet). Bots verify the HS256 signature and enforce
 * the optional `role` claim per route.
 *
 * Tokens must expire: bots reject a JWT without `exp`, an expired JWT, a JWT whose `nbf` is in the future,
 * and a JWT whose `exp` lies further ahead than `private_webui_jwt_max_ttl` (default `24h`).
 * A Socket.IO session is closed when its token expires.
 *
 * Role scope (every route declares the lowest role it accepts; the HTTP method does not widen access):
 *
 * - `read-only` — monitoring snapshots only: `GET /status`, `/bot`, `/params`, `/market/*`, `/account/*`,
 *   and the read commands `GET /commands/balances|stats|orders|rates|pair|calc|info|order|account`.
 *   Denied (403 `Read-only access`) on every command that changes bot or exchange state (including
 *   `POST /commands/transfer`), on `PUT /params`, on `GET /commands/deposit` and `GET /commands/show`,
 *   which may create deposit addresses or expose fund history, and on `GET /logs` and `GET /messages`,
 *   which hold the audit trail and notification history. Safety events (emergency stop, ladder safety
 *   pauses) are available to this role in `GET /status` → `safety`.
 * - `manager` — everything except `GET /config`
 * - `admin` — everything
 * - No `role` claim (legacy tokens) — same as `admin`
 *
 * A token with any other `role` value is rejected with 401.
 *
 * Scenario B: browser session from adamant-payment; bot uses `public_webui_license_token` for relay.
 *
 * @typedef {'admin' | 'manager' | 'read-only'} WebUiRole Operator role from the private WebUI user directory
 *
 * @typedef {Object} WebUiJwtPayload
 * @property {string} login Operator id from the WebUI user session
 * @property {number} exp Expiry time in Unix seconds. Required.
 * @property {number} [iat] Issue time in Unix seconds
 * @property {number} [nbf] Not-before time in Unix seconds; checked when present
 * @property {WebUiRole} [role] Operator role; routes above the role's scope return 403
 * @property {boolean} [enabled] When `false`, the operator account is disabled in the WebUI
 *
 * @typedef {Object} WebUiJwtUser
 * @property {string} login Operator id extracted from a verified JWT
 * @property {WebUiRole} [role] Role claim when present in the JWT
 */

module.exports = {};

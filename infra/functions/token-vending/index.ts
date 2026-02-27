/**
 * Token vending Lambda for acpe-bot.
 *
 * Flow:
 *   1. Caller (GitHub Actions) sends a POST with its OIDC token
 *   2. Lambda verifies the OIDC token against GitHub's JWKS
 *   3. Lambda authenticates as the GitHub App (JWT signed with private key)
 *   4. Lambda generates an installation access token for the caller's org/repo
 *   5. Returns the token to the caller
 *
 * No shared secrets — callers prove identity via GitHub OIDC.
 */

import {
	SecretsManagerClient,
	GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import {
	createRemoteJWKSet,
	jwtVerify,
	SignJWT,
	type JWTPayload,
} from "jose";
import { createPrivateKey } from "node:crypto";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";

// ---------------------------------------------------------------------------
// Config from environment
// ---------------------------------------------------------------------------

const APP_ID = process.env.APP_ID!;
const SECRET_ARN = process.env.SECRET_ARN!;

const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_OIDC_JWKS_URI =
	"https://token.actions.githubusercontent.com/.well-known/jwks";
const GITHUB_API = "https://api.github.com";

const EXPECTED_AUDIENCE = "acpe-bot";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OidcClaims extends JWTPayload {
	repository: string;
	repository_owner: string;
}

interface TokenRequest {
	oidc_token: string;
	owner: string;
	repositories?: string[];
}

interface Installation {
	id: number;
	[key: string]: unknown;
}

interface InstallationToken {
	token: string;
	expires_at: string;
	[key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Caches (warm across invocations)
// ---------------------------------------------------------------------------

let cachedPrivateKey: string | null = null;

// JWKS is cached internally by jose's createRemoteJWKSet
const jwks = createRemoteJWKSet(new URL(GITHUB_OIDC_JWKS_URI));

// ---------------------------------------------------------------------------
// Secrets Manager
// ---------------------------------------------------------------------------

const secretsClient = new SecretsManagerClient();

async function getPrivateKey(): Promise<string> {
	if (cachedPrivateKey) return cachedPrivateKey;

	const resp = await secretsClient.send(
		new GetSecretValueCommand({ SecretId: SECRET_ARN }),
	);
	cachedPrivateKey = resp.SecretString!;
	return cachedPrivateKey;
}

// ---------------------------------------------------------------------------
// GitHub OIDC token verification
// ---------------------------------------------------------------------------

async function verifyOidcToken(token: string): Promise<OidcClaims> {
	const { payload } = await jwtVerify(token, jwks, {
		issuer: GITHUB_OIDC_ISSUER,
		audience: EXPECTED_AUDIENCE,
	});

	return payload as OidcClaims;
}

// ---------------------------------------------------------------------------
// GitHub App JWT generation
// ---------------------------------------------------------------------------

async function createAppJwt(
	appId: string,
	privateKeyPem: string,
): Promise<string> {
	// createPrivateKey handles both PKCS#1 (BEGIN RSA PRIVATE KEY)
	// and PKCS#8 (BEGIN PRIVATE KEY) formats from GitHub App .pem files
	const key = createPrivateKey(privateKeyPem);

	return await new SignJWT({})
		.setProtectedHeader({ alg: "RS256" })
		.setIssuedAt(Math.floor(Date.now() / 1000) - 60)
		.setExpirationTime("10m")
		.setIssuer(appId)
		.sign(key);
}

// ---------------------------------------------------------------------------
// GitHub API helpers
// ---------------------------------------------------------------------------

async function getInstallation(
	appJwt: string,
	owner: string,
): Promise<Installation> {
	for (const type of ["orgs", "users"]) {
		const resp = await fetch(
			`${GITHUB_API}/${type}/${owner}/installation`,
			{
				headers: {
					Authorization: `Bearer ${appJwt}`,
					Accept: "application/vnd.github+json",
					"X-GitHub-Api-Version": "2022-11-28",
				},
			},
		);
		if (resp.ok) return (await resp.json()) as Installation;
	}
	throw new Error(
		`No acpe-bot installation found for "${owner}". Install the app first: https://github.com/apps/acpe-bot`,
	);
}

async function createInstallationToken(
	appJwt: string,
	installationId: number,
	repositories?: string[],
): Promise<InstallationToken> {
	const body: { repositories?: string[] } = {};
	if (repositories && repositories.length > 0) {
		body.repositories = repositories;
	}

	const resp = await fetch(
		`${GITHUB_API}/app/installations/${installationId}/access_tokens`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${appJwt}`,
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		},
	);

	if (!resp.ok) {
		const text = await resp.text();
		throw new Error(
			`Failed to create installation token: ${resp.status} ${text}`,
		);
	}

	return (await resp.json()) as InstallationToken;
}

// ---------------------------------------------------------------------------
// Lambda handler
// ---------------------------------------------------------------------------

/** Known validation errors that are safe to expose to callers. */
function isClientError(message: string): boolean {
	const clientPatterns = [
		"Missing oidc_token",
		"Missing owner",
		"does not match requested owner",
		"No acpe-bot installation found",
	];
	return clientPatterns.some((p) => message.includes(p));
}

function isAuthError(err: unknown): boolean {
	if (!(err instanceof Error)) return false;
	const m = err.message;
	return (
		m.includes('"iss"') ||
		m.includes('"aud"') ||
		m.includes('"exp"') ||
		m.includes('"nbf"') ||
		m.includes("signature verification failed") ||
		m.includes("JWS") ||
		m.includes("JWT")
	);
}

function response(
	statusCode: number,
	body: Record<string, unknown>,
): APIGatewayProxyResultV2 {
	return {
		statusCode,
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	};
}

export async function handler(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
	try {
		// Only accept POST
		if (event.requestContext?.http?.method !== "POST") {
			return response(405, { error: "Method not allowed" });
		}

		// Parse body
		const body = JSON.parse(event.body || "{}") as TokenRequest;
		const { oidc_token, owner, repositories } = body;

		if (!oidc_token) {
			return response(400, { error: "Missing oidc_token" });
		}
		if (!owner) {
			return response(400, { error: "Missing owner" });
		}

		// 1. Verify the GitHub OIDC token (issuer, audience, expiry, nbf, signature)
		const claims = await verifyOidcToken(oidc_token);

		// Verify the caller's repo belongs to the requested owner
		const callerOwner = claims.repository_owner;
		if (callerOwner?.toLowerCase() !== owner.toLowerCase()) {
			return response(403, {
				error: `OIDC token owner "${callerOwner}" does not match requested owner "${owner}"`,
			});
		}

		// 2. Load private key and create app JWT
		const privateKeyPem = await getPrivateKey();
		const appJwt = await createAppJwt(APP_ID, privateKeyPem);

		// 3. Find the installation for the target owner
		const installation = await getInstallation(appJwt, owner);

		// 4. Create an installation access token
		const tokenResp = await createInstallationToken(
			appJwt,
			installation.id,
			repositories,
		);

		return response(200, {
			token: tokenResp.token,
			expires_at: tokenResp.expires_at,
		});
	} catch (err) {
		console.error("Error:", err);

		// Auth errors (bad OIDC token) -> 401
		if (isAuthError(err)) {
			return response(401, { error: "OIDC token verification failed" });
		}

		// Known client errors -> 400/403
		const message = err instanceof Error ? err.message : String(err);
		if (isClientError(message)) {
			return response(400, { error: message });
		}

		// Everything else -> generic 500 (no internal details leaked)
		return response(500, { error: "Internal server error" });
	}
}

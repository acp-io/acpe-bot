/**
 * Webhook Lambda for acpe-bot.
 *
 * Receives GitHub webhook events and acts on them.
 * Currently handles:
 *   - pull_request (opened) — posts a "Hello World" comment
 *
 * Webhook signature is verified using the shared secret.
 */

import {
	SecretsManagerClient,
	GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { createPrivateKey } from "node:crypto";
import { SignJWT } from "jose";
import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyResultV2,
} from "aws-lambda";

// ---------------------------------------------------------------------------
// Config from environment
// ---------------------------------------------------------------------------

const APP_ID = process.env.APP_ID!;
const SECRET_ARN = process.env.SECRET_ARN!;
const WEBHOOK_SECRET_ARN = process.env.WEBHOOK_SECRET_ARN!;

const GITHUB_API = "https://api.github.com";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PullRequestEvent {
	action: string;
	number: number;
	pull_request: {
		number: number;
		title: string;
		html_url: string;
		user: {
			login: string;
		};
	};
	repository: {
		full_name: string;
		owner: {
			login: string;
		};
	};
	installation?: {
		id: number;
	};
}

interface InstallationToken {
	token: string;
	expires_at: string;
}

// ---------------------------------------------------------------------------
// Caches (warm across invocations)
// ---------------------------------------------------------------------------

let cachedPrivateKey: string | null = null;
let cachedWebhookSecret: string | null = null;

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

async function getWebhookSecret(): Promise<string> {
	if (cachedWebhookSecret) return cachedWebhookSecret;

	const resp = await secretsClient.send(
		new GetSecretValueCommand({ SecretId: WEBHOOK_SECRET_ARN }),
	);
	cachedWebhookSecret = resp.SecretString!;
	return cachedWebhookSecret;
}

// ---------------------------------------------------------------------------
// Webhook signature verification
// ---------------------------------------------------------------------------

async function verifySignature(
	payload: string,
	signature: string | undefined,
): Promise<boolean> {
	if (!signature) return false;

	const webhookSecret = await getWebhookSecret();
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(webhookSecret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);

	const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
	const expected = `sha256=${Array.from(new Uint8Array(sig))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("")}`;

	// Constant-time comparison
	if (expected.length !== signature.length) return false;
	const a = encoder.encode(expected);
	const b = encoder.encode(signature);
	let result = 0;
	for (let i = 0; i < a.length; i++) {
		result |= a[i]! ^ b[i]!;
	}
	return result === 0;
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

async function createInstallationToken(
	appJwt: string,
	installationId: number,
): Promise<InstallationToken> {
	const resp = await fetch(
		`${GITHUB_API}/app/installations/${installationId}/access_tokens`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${appJwt}`,
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
			},
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

async function createPRComment(
	token: string,
	repo: string,
	prNumber: number,
	body: string,
): Promise<void> {
	const resp = await fetch(
		`${GITHUB_API}/repos/${repo}/issues/${prNumber}/comments`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ body }),
		},
	);

	if (!resp.ok) {
		const text = await resp.text();
		throw new Error(`Failed to create PR comment: ${resp.status} ${text}`);
	}
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

async function handlePullRequest(event: PullRequestEvent): Promise<void> {
	if (event.action !== "opened" && event.action !== "reopened") {
		console.log(`Ignoring pull_request action: ${event.action}`);
		return;
	}

	const installationId = event.installation?.id;
	if (!installationId) {
		throw new Error("No installation ID in webhook payload");
	}

	console.log(
		`PR #${event.number} ${event.action} on ${event.repository.full_name}`,
	);

	// Authenticate as the GitHub App and get an installation token
	const privateKeyPem = await getPrivateKey();
	const appJwt = await createAppJwt(APP_ID, privateKeyPem);
	const { token } = await createInstallationToken(appJwt, installationId);

	// Post a comment on the PR
	await createPRComment(
		token,
		event.repository.full_name,
		event.number,
		`Hello @${event.pull_request.user.login}! :wave:\n\nThis is acpe-bot, reporting for duty.`,
	);

	console.log(
		`Posted comment on PR #${event.number} in ${event.repository.full_name}`,
	);
}

// ---------------------------------------------------------------------------
// Lambda handler
// ---------------------------------------------------------------------------

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

		const rawBody = event.body || "";

		// Verify webhook signature
		const signature = event.headers["x-hub-signature-256"];
		const isValid = await verifySignature(rawBody, signature);
		if (!isValid) {
			console.error("Webhook signature verification failed");
			return response(401, { error: "Invalid signature" });
		}

		// Route by event type
		const eventType = event.headers["x-github-event"];
		console.log(`Received webhook event: ${eventType}`);

		switch (eventType) {
			case "pull_request": {
				const payload = JSON.parse(rawBody) as PullRequestEvent;
				await handlePullRequest(payload);
				break;
			}
			case "ping": {
				console.log("Received ping event — webhook is configured correctly");
				break;
			}
			default:
				console.log(`Unhandled event type: ${eventType}`);
		}

		return response(200, { ok: true });
	} catch (err) {
		console.error("Webhook handler error:", err);
		return response(500, { error: "Internal server error" });
	}
}

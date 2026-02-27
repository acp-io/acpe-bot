import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config();

export class SecretManager {
	public readonly privateKey: aws.secretsmanager.Secret;
	public readonly webhookSecret: aws.secretsmanager.Secret;

	constructor() {
		this.privateKey = this.setupPrivateKey();
		this.webhookSecret = this.setupWebhookSecret();
	}

	private setupPrivateKey() {
		const privateKey = new aws.secretsmanager.Secret(
			"acpe-bot-private-key",
			{
				name: "acpe-bot/private-key",
				description: "Private key (.pem) for the acpe-bot GitHub App",
			},
		);

		new aws.secretsmanager.SecretVersion("acpe-bot-private-key-value", {
			secretId: privateKey.id,
			secretString: config.requireSecret("private-key"),
		});

		return privateKey;
	}

	private setupWebhookSecret() {
		const webhookSecret = new aws.secretsmanager.Secret(
			"acpe-bot-webhook-secret",
			{
				name: "acpe-bot/webhook-secret",
				description:
					"Webhook secret for verifying GitHub webhook payloads",
			},
		);

		new aws.secretsmanager.SecretVersion("acpe-bot-webhook-secret-value", {
			secretId: webhookSecret.id,
			secretString: config.requireSecret("webhook-secret"),
		});

		return webhookSecret;
	}
}

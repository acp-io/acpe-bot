import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import type { SecretManager } from "../secret-manager";

const config = new pulumi.Config();

export class Webhook {
	public readonly functionUrl: pulumi.Output<string>;

	constructor({ secretManager }: { secretManager: SecretManager }) {
		const appId = config.require("app-id");

		// IAM role for the webhook Lambda
		const lambdaRole = new aws.iam.Role("acpe-bot-webhook-role", {
			name: "acpe-bot-webhook-role",
			assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
				Service: "lambda.amazonaws.com",
			}),
			inlinePolicies: pulumi
				.all([
					secretManager.privateKey.arn,
					secretManager.webhookSecret.arn,
				])
				.apply(([privateKeyArn, webhookSecretArn]) => [
					{
						name: "secrets-manager",
						policy: JSON.stringify({
							Version: "2012-10-17",
							Statement: [
								{
									Effect: "Allow",
									Action: "secretsmanager:GetSecretValue",
									Resource: [privateKeyArn, webhookSecretArn],
								},
							],
						}),
					},
				]),
		});

		new aws.iam.RolePolicyAttachment(
			"acpe-bot-webhook-execution-policy",
			{
				role: lambdaRole.name,
				policyArn: aws.iam.ManagedPolicy.AWSLambdaBasicExecutionRole,
			},
		);

		// Lambda function
		const lambdaFunction = new aws.lambda.Function(
			"acpe-bot-webhook-lambda",
			{
				name: "acpe-bot-webhook",
				runtime: "nodejs22.x",
				handler: "index.handler",
				code: new pulumi.asset.AssetArchive({
					".": new pulumi.asset.FileArchive(
						"./dist/functions/webhook",
					),
				}),
				timeout: 30,
				memorySize: 128,
				role: lambdaRole.arn,
				environment: {
					variables: {
						APP_ID: appId,
						SECRET_ARN: secretManager.privateKey.arn,
						WEBHOOK_SECRET_ARN:
							secretManager.webhookSecret.arn,
					},
				},
			},
		);

		// Function URL (public — auth handled in Lambda via webhook signature)
		const fnUrl = new aws.lambda.FunctionUrl("acpe-bot-webhook-url", {
			functionName: lambdaFunction.name,
			authorizationType: "NONE",
		});

		this.functionUrl = fnUrl.functionUrl;
	}
}

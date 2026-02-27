import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import type { SecretManager } from "../secret-manager";

const config = new pulumi.Config();

export class Lambda {
	public readonly functionUrl: pulumi.Output<string>;

	constructor({ secretManager }: { secretManager: SecretManager }) {
		const appId = config.require("app-id");

		// IAM role for the token vending Lambda
		const lambdaRole = new aws.iam.Role(
			"acpe-bot-token-vending-role",
			{
				name: "acpe-bot-token-vending-role",
				assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
					Service: "lambda.amazonaws.com",
				}),
				inlinePolicies: secretManager.privateKey.arn.apply((arn) => [
					{
						name: "secrets-manager",
						policy: JSON.stringify({
							Version: "2012-10-17",
							Statement: [
								{
									Effect: "Allow",
									Action: "secretsmanager:GetSecretValue",
									Resource: arn,
								},
							],
						}),
					},
				]),
			},
		);

		new aws.iam.RolePolicyAttachment(
			"acpe-bot-token-vending-execution-policy",
			{
				role: lambdaRole.name,
				policyArn: aws.iam.ManagedPolicy.AWSLambdaBasicExecutionRole,
			},
		);

		// Lambda function
		const lambdaFunction = new aws.lambda.Function(
			"acpe-bot-token-vending-lambda",
			{
				name: "acpe-bot-token-vending",
				runtime: "nodejs22.x",
				handler: "index.handler",
				code: new pulumi.asset.AssetArchive({
					".": new pulumi.asset.FileArchive(
						"./dist/functions/token-vending",
					),
				}),
				timeout: 10,
				memorySize: 128,
				reservedConcurrentExecutions: 10,
				role: lambdaRole.arn,
				environment: {
					variables: {
						APP_ID: appId,
						SECRET_ARN: secretManager.privateKey.arn,
					},
				},
			},
		);

		// Function URL (public — auth handled in Lambda via OIDC verification)
		const fnUrl = new aws.lambda.FunctionUrl(
			"acpe-bot-token-vending-url",
			{
				functionName: lambdaFunction.name,
				authorizationType: "NONE",
			},
		);

		this.functionUrl = fnUrl.functionUrl;
	}
}

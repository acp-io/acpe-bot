import { Lambda } from "./services/lambda";
import { SecretManager } from "./services/secret-manager";
import { Webhook } from "./services/webhook";

const secretManager = new SecretManager();
const lambda = new Lambda({ secretManager });
const webhook = new Webhook({ secretManager });

export const functionUrl = lambda.functionUrl;
export const webhookUrl = webhook.functionUrl;

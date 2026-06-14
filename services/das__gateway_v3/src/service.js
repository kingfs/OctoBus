import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./das-gateway-v3.js";

export { handlers } from "./das-gateway-v3.js";

export const service = defineService({ handlers });

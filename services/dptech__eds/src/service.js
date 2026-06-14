import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./dptech-eds.js";

export { handlers } from "./dptech-eds.js";

export const service = defineService({ handlers });

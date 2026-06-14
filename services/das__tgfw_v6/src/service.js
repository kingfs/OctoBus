import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./das-tgfw-v6.js";

export { handlers } from "./das-tgfw-v6.js";

export const service = defineService({ handlers });

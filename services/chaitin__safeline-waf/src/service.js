import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./safeline-waf.js";

export { handlers } from "./safeline-waf.js";

export const service = defineService({ handlers });

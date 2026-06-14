import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./fortinet-fw.js";

export { handlers } from "./fortinet-fw.js";

export const service = defineService({ handlers });

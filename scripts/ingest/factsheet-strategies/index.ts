import type { AmcStrategy } from "../factsheet-shared";
import { HDFC_STRATEGY } from "./hdfc";
import { SBI_STRATEGY } from "./sbi";
import { ICICI_PRU_STRATEGY } from "./icici-pru";
import { NIPPON_STRATEGY } from "./nippon";
import { KOTAK_STRATEGY } from "./kotak";
import { ABSL_STRATEGY } from "./absl";
import { UTI_STRATEGY } from "./uti";

export {
  HDFC_STRATEGY,
  SBI_STRATEGY,
  ICICI_PRU_STRATEGY,
  NIPPON_STRATEGY,
  KOTAK_STRATEGY,
  ABSL_STRATEGY,
  UTI_STRATEGY,
};

/** Top-7 AMCs by AAUM (peer universe used elsewhere in the
 *  dashboard). Order: most-recent ranking from PR #73's AAUM
 *  snapshot, but the order doesn't matter for the audit JSON. */
export const TOP7_STRATEGIES: AmcStrategy[] = [
  SBI_STRATEGY,
  ICICI_PRU_STRATEGY,
  HDFC_STRATEGY,
  NIPPON_STRATEGY,
  KOTAK_STRATEGY,
  ABSL_STRATEGY,
  UTI_STRATEGY,
];

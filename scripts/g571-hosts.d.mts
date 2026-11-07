/** Exact G571 or unconditional Jake-approved G599-G603 or exact G614 selectors from HOST-BAR. */
export function g571HostApprovals(root:string):Map<string,Set<string>|null>;
export function approvedG571Host(approvals:ReadonlyMap<string,ReadonlySet<string>|null>,path:string,name?:string):boolean;

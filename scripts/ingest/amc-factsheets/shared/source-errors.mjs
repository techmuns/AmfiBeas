export function periodNotListed(targetMonth,listedMonths=[]) {
  return Object.assign(Error("Target period not listed"),{code:"SOURCE_PERIOD_NOT_LISTED",targetMonth,listedMonths:listedMonths.filter(m=>/^20\d\d-(0[1-9]|1[0-2])$/.test(m)).sort()});
}
// Persist operational evidence, never a response body, request headers or URL query.
export function sourceFailure(error) {
  if(error?.code==='SOURCE_INDEX_CONFLICT')return {kind:'catalogue-category-conflict'};
  if(error?.code==="SOURCE_PERIOD_NOT_LISTED")return {kind:"target-period-not-listed",targetMonth:error.targetMonth,listedMonths:error.listedMonths};
  const status=Number(error?.status);
  if(Number.isInteger(status)&&status>=100&&status<=599)return {
    kind:[401,403,429].includes(status)?'access-refused':'http-error',httpStatus:status,
  };
  if(error?.code==='COLLECTOR_DEPENDENCY')return {kind:'collector-dependency-unavailable'};
  if(error?.code==='SOURCE_TLS')return {kind:'tls-error'};
  if(error?.code==='SOURCE_REFUSED')return {kind:'access-refused'};
  if(error?.code==='SOURCE_TRANSPORT')return {kind:'transport-error',transportCode:Number.isInteger(error.transportCode)?error.transportCode:null,...(error.phase==='catalogue-navigation'?{phase:error.phase}:{})};
  if(error instanceof SyntaxError)return {kind:'invalid-catalogue'};
  // Only our own bounded messages are retained; arbitrary external errors remain generic.
  const message=String(error?.message||'');
  const accepted=/^(?:Monthly (?:disclosure unavailable|catalogue missing)|Incomplete disclosure index|Repeated disclosure page|Disclosure (?:month|index month) mismatch|Disclosure index changed|Invalid (?:disclosure index|scheme catalogue|reporting-year catalogue)|Official monthly file unavailable|Workbook holdings unverified|Disclosure month unverified|Unexpected HTML|Disclosure unavailable|Disclosure checkpoint failed|Monthly workbook missing|Source adapter unavailable|Monthly disclosure page unlisted)$/;
  return {kind:'validation-error',...(accepted.test(message)?{message}:{})};
}

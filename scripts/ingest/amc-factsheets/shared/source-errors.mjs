// Persist operational evidence, never a response body, request headers or URL query.
export function sourceFailure(error) {
  const status=Number(error?.status);
  if(Number.isInteger(status)&&status>=100&&status<=599)return {
    kind:[401,403,429].includes(status)?'access-refused':'http-error',httpStatus:status,
  };
  if(error?.code==='SOURCE_REFUSED')return {kind:'access-refused'};
  if(error?.code==='SOURCE_TRANSPORT')return {kind:'transport-error',transportCode:Number.isInteger(error.transportCode)?error.transportCode:null};
  if(error instanceof SyntaxError)return {kind:'invalid-catalogue'};
  // Only our own bounded messages are retained; arbitrary external errors remain generic.
  const message=String(error?.message||'');
  const accepted=/^(?:Monthly (?:disclosure unavailable|catalogue missing)|Incomplete disclosure index|Repeated disclosure page|Disclosure (?:month|index month) mismatch|Disclosure index changed|Invalid (?:disclosure index|scheme catalogue|reporting-year catalogue)|Official monthly file unavailable|Workbook holdings unverified|Disclosure month unverified|Unexpected HTML|Disclosure unavailable|Disclosure checkpoint failed|Monthly workbook missing|Source adapter unavailable|Monthly disclosure page unlisted)$/;
  return {kind:'validation-error',...(accepted.test(message)?{message}:{})};
}

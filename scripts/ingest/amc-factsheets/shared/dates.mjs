export function monthKey(value) {
  if (/^20\d\d-(0[1-9]|1[0-2])(?:-|$)/.test(value || '')) return value.slice(0,7);
  const m=/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[ -](\d{2}|20\d\d)$/i.exec(value||'');
  return m?`${m[2].length===2?'20':''}${m[2]}-${String(['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(m[1].toLowerCase())+1).padStart(2,'0')}`:null;
}
export function previousMonth(month) {
  const d=new Date(`${month}-01T00:00:00Z`);d.setUTCMonth(d.getUTCMonth()-1);return d.toISOString().slice(0,7);
}
export const targetMonth=(now=Date.now())=>previousMonth(new Date(now).toISOString().slice(0,7));
export const monthLabel=month=>month?`${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(month.slice(5))-1]}-${month.slice(2,4)}`:null;

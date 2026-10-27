import type { ReactNode } from 'react';
import { pad } from '../lib/engine.mjs';
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
 const paths: Record<string, ReactNode> = {
 spark:<><path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6Z"/><path d="m20 2 .5 1.5L22 4l-1.5.5L20 6l-.5-1.5L18 4l1.5-.5Z"/></>,
 grid:<><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
 database:<><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/></>,
 history:<><path d="M3 11a9 9 0 1 1 2 7M3 4v7h7"/><path d="M12 7v5l3 2"/></>,
 refresh:<><path d="M20 7A9 9 0 0 0 4 6L2 9m0-6v6h6M4 17a9 9 0 0 0 16 1l2-3m0 6v-6h-6"/></>,
 arrow:<path d="M4 12h16m-6-6 6 6-6 6"/>,
 download:<><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></>,
 upload:<><path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/></>,
 plus:<path d="M12 5v14M5 12h14"/>, check:<path d="m5 12 4 4L19 6"/>,close:<path d="m6 6 12 12M6 18 18 6"/>,
 save:<><path d="M5 3h12l4 4v14H3V3h2Zm2 0v7h10V3M7 21v-7h10v7"/></>,
 copy:<><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/></>,
 settings:<><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/></>,
 chart:<><path d="M4 3v18h17M8 16v-5m5 5V7m5 9v-8"/></>,
 info:<><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/></>,
 external:<><path d="M14 3h7v7m0-7-11 11M10 4H3v17h17v-7"/></>,
 edit:<><path d="m15 4 5 5M4 20l4-1L21 6l-5-5L3 14l-1 6Z"/></>,
 trash:<><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></>
 };
 return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]??paths.grid}</svg>;
}
export function Balls({ numbers, blue=false, small=false, dan=false }: { numbers:number[]; blue?:boolean; small?:boolean; dan?:boolean }) {
 return <span className={`balls ${small?'small':''}`}>{numbers.map(n=><span key={n} className={`ball ${blue?'blue':'red'} ${dan?'dan':''}`}>{pad(n)}{dan&&<i>胆</i>}</span>)}</span>;
}
export function Field({ label, children, help }: { label:string; children:ReactNode; help?:string }) {
 return <label className="field"><span>{label}</span>{children}{help&&<small>{help}</small>}</label>;
}
export function SectionHead({ title, note, action }: { title:string; note?:string; action?:ReactNode }) {
 return <div className="section-head"><div><h2>{title}</h2>{note&&<p>{note}</p>}</div>{action}</div>;
}

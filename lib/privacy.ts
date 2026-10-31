/** Best-effort input check, not a guarantee that all personal data is removed. */
export function containsContactInfo(text:string){
 return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)||/(?:^|\D)01[016789][ -]?\d{3,4}[ -]?\d{4}(?!\d)/.test(text);
}

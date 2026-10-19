export const toasts: any[] = ((globalThis as any).__toasts = (globalThis as any).__toasts ?? []);
export function useToast() { return { toast: (o: any) => { toasts.push(o); } }; }
export function cn(...a: any[]) { return a.flat().filter((x) => typeof x === "string" && x).join(" "); }
export const firebaseAuth = { currentUser: null };
export const firestore = {};

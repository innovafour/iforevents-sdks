export let pathname = "/";
export let search = "";
export function setRoute(p: string, s = ""): void {
  pathname = p;
  search = s;
}
export function usePathname(): string {
  return pathname;
}
export function useSearchParams(): { toString(): string } {
  return { toString: () => search };
}

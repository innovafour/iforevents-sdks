// Minimal surface of next/navigation used here; `next` is a peer dependency.
declare module "next/navigation" {
  export function usePathname(): string | null;
  export function useSearchParams(): { toString(): string } | null;
}

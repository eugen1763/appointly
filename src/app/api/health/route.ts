export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export function GET(): Response {
  return new Response('{"status":"ok"}', {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    },
  });
}

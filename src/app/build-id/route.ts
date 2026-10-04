export const dynamic = 'force-dynamic';

export async function GET() {
  return new Response(JSON.stringify({ build_id: process.env.NEXT_PUBLIC_BUILD_ID ?? '' }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

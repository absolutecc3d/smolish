// Vercel Edge Function: /api/dl?id=<video id>[&check=1]
// Streams the 1080p MP4 from the Smolish CDN as an attachment so the browser
// saves it directly. With &check=1 it only confirms the video exists.

export const config = { runtime: 'edge' };

const CDN_HOST = 'cdn.smolish.com';
const HEADERS = {
  'user-agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  referer: 'https://smolish.com/',
  accept: '*/*',
};

// Request the CDN file. Redirects are only followed when they stay on the CDN host.
async function fromCdn(path, extra) {
  let target = 'https://' + CDN_HOST + path;
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(target, { headers: { ...HEADERS, ...extra }, redirect: 'manual' });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      const next = new URL(loc, target);
      if (next.protocol !== 'https:' || next.hostname !== CDN_HOST) throw new Error('redirect blocked');
      target = next.toString();
      continue;
    }
    return res;
  }
  throw new Error('too many redirects');
}

export default async function handler(request) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id') || '';
  if (!/^\d{6,25}$/.test(id)) return new Response('Invalid video id', { status: 400 });

  const check = url.searchParams.has('check');
  let up;
  try {
    up = await fromCdn('/videos/' + id + '/1080p.mp4', check ? { range: 'bytes=0-0' } : {});
  } catch (e) {
    return new Response('Could not reach the CDN', { status: 502 });
  }

  const ok = up.status === 200 || (check && up.status === 206);
  if (!ok) {
    if (up.body) up.body.cancel();
    return new Response('CDN returned status ' + up.status, {
      status: up.status === 404 ? 404 : 502,
      headers: { 'x-cdn-status': String(up.status) },
    });
  }

  if (check) {
    if (up.body) up.body.cancel();
    return new Response('ok', { status: 200 });
  }

  const headers = {
    'content-type': 'video/mp4',
    'content-disposition': 'attachment; filename="smolish-' + id + '.mp4"',
    'cache-control': 'no-store',
  };
  const len = up.headers.get('content-length');
  if (len) headers['content-length'] = len;
  return new Response(up.body, { status: 200, headers });
}

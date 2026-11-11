import { onRequest as handleApi } from './functions/api/[[path]].js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      const path = url.pathname.slice('/api/'.length);
      return handleApi({ request, env, params: { path } });
    }
    return env.ASSETS.fetch(request);
  }
};

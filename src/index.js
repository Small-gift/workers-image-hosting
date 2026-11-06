import {
  Application,
  Router,
  normalizePathnameMiddleware
} from '@cfworker/web';
import { getAssetFromKV } from "@cloudflare/kv-asset-handler";

const pass = '123'; // 默认登录密码

const router = new Router();
let globalEnv = null; // 用于在路由中访问 KV 等环境变量

async function randomString(len) {
  len = len || 6;
  let $chars = 'ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678';
  let maxPos = $chars.length;
  let result = '';
  for (let i = 0; i < len; i++) {
    result += $chars.charAt(Math.floor(Math.random() * maxPos));
  }
  return result;
}

// 首页跳转
router.get('/', ({ res }) => {
  res.redirect('/index.html');
});

// 上传 api
router.post('/api', async ({ req, res }) => {
  // 注意：如果此处报错，请尝试改为 await req.formData()
  let form = req.body.formData(); 
  let img = (await form).get('img');
  const img_check = new RegExp("(.*?)\.(png|jpe?g|gif|bmp|psd|tiff|tga|webp)", "i");

  // 文件格式验证
  if (img_check.test(img.name)) {
    let url = await randomString();
    let check = await globalEnv.LINK.get(url);
    if (check !== null) {
      url = await randomString();
    }
    let stream = img.stream();
    await globalEnv.LINK.put(url, stream, {
      metadata: {
        size: img.size,
        name: url,
        type: img.type,
        date: new Date().getTime()
      }
    });
    
    // 修复了原代码中复用同一个 headers 对象可能导致的问题
    const headers = new Headers({ 'access-control-allow-origin': '*' });
    res.headers = headers;
    res.body = { link: req.url + '/img/' + url };
  } else {
    res.status = 400;
    const headers = new Headers({ 'access-control-allow-origin': '*' });
    res.headers = headers;
    res.body = { info: '非图片文件404' };
  }
});

// 获取图片
router.get('/api/img/:p', async ({ req, res }) => {
  let body = await globalEnv.LINK.get(req.params.p, { cacheTtl: 864000, type: "stream" });
  let { metadata: { type, date, size } } = await globalEnv.LINK.getWithMetadata(req.params.p, { type: "text" });
  
  if (req.headers.has('If-None-Match')) {
    return res.status = 304;
  }
  
  const headers = new Headers({ 'access-control-allow-origin': '*' });
  headers.set('Cache-Control', 'public, max-age=864000');
  res.headers = headers;
  res.type = type;
  res.etag = size;
  res.body = body;
});

// 简易登陆验证
router.get('/query', async ({ req, res }) => {
  const paramas = req.url.searchParams;
  if (paramas.get('pass') == pass) {
    const key = await globalEnv.LINK.list();
    res.body = key;
  } else {
    res.status = 400;
    res.body = { info: '密码错误' };
  }
});

// 构建 Application
const app = new Application();
app.use(normalizePathnameMiddleware);
app.use(router.middleware);

// 标准的 ES Module 导出格式
export default {
  async fetch(request, env, ctx) {
    // 将 env 赋给全局变量，以便 @cfworker/web 的路由处理函数能读取到 KV
    globalEnv = env; 
    
    let pathname = new URL(request.url);
    let asset = new RegExp('/assets/.*', 'i');
    let index = new RegExp('/index.*', 'i');
    let list = new RegExp('/list.*', 'i');

    // 拦截静态资源请求
    if (asset.test(pathname.pathname) || index.test(pathname.pathname) || list.test(pathname.pathname)) {
      try {
        // 适配 ES Module 格式的 getAssetFromKV
        return await getAssetFromKV({
          request,
          waitUntil: ctx.waitUntil.bind(ctx)
        }, {
          // 确保 wrangler.toml 中配置了 [site] 且绑定为 ASSETS
          ASSETS: env.ASSETS 
        });
      } catch (e) {
        // 静态资源找不到时的处理
        return new Response("Not Found", { status: 404 });
      }
    }

    // API 请求交由 @cfworker/web 处理
    return app.fetch(request, env, ctx);
  }
};

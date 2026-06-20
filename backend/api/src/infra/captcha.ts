import { captcha } from "tencentcloud-sdk-nodejs-captcha";

// 腾讯云人机验证（天御验证码）服务端验票。
// 前端用 TCaptcha.js 弹出滑块/无感验证，成功后拿到 ticket + randstr，
// 随业务请求发到后端；后端调 DescribeCaptchaResult 验票，CaptchaCode===1
// 才算真人通过。风格对齐同目录的 sms.ts（未配置即降级放行，方便本地开发）。

const CaptchaClient = captcha.v20190722.Client;

// 验票 API 凭证：优先用独立的 CAPTCHA 凭证，否则复用 SMS 的同一对腾讯云凭证。
const SECRET_ID = process.env.TENCENT_CAPTCHA_SECRET_ID || process.env.TENCENT_SMS_SECRET_ID || "";
const SECRET_KEY = process.env.TENCENT_CAPTCHA_SECRET_KEY || process.env.TENCENT_SMS_SECRET_KEY || "";
// CaptchaAppId（数字）+ AppSecretKey：控制台【验证管理】>【基础配置】获取。
const CAPTCHA_APP_ID = process.env.TENCENT_CAPTCHA_APP_ID || "";
const APP_SECRET_KEY = process.env.TENCENT_CAPTCHA_APP_SECRET_KEY || "";

// CaptchaType 固定填 9（滑块/无感）。
const CAPTCHA_TYPE = 9;

let cachedClient: InstanceType<typeof CaptchaClient> | null = null;
function getClient(): InstanceType<typeof CaptchaClient> | null {
  if (!SECRET_ID || !SECRET_KEY || !CAPTCHA_APP_ID || !APP_SECRET_KEY) {
    return null;
  }
  if (!cachedClient) {
    cachedClient = new CaptchaClient({
      credential: { secretId: SECRET_ID, secretKey: SECRET_KEY },
      // Captcha 接口无地域属性，region 留空。
      region: "",
      profile: { httpProfile: { endpoint: "captcha.tencentcloudapi.com" } },
    });
  }
  return cachedClient;
}

// 人机验证是否已启用（凭证齐全）。未启用时所有验票直接放行。
export function isCaptchaEnabled(): boolean {
  return getClient() !== null;
}

// 暴露给前端的 CaptchaAppId（公开值，前端 TCaptcha 初始化需要）。
export function getCaptchaAppId(): string {
  return CAPTCHA_APP_ID;
}

// 验票。返回 true 表示真人通过 / 未启用（降级放行）；false 表示验证失败。
export async function verifyCaptcha(ticket: string, randstr: string, userIp: string): Promise<boolean> {
  const client = getClient();
  if (!client) {
    // 未配置——和 sms.ts 一致地降级放行，避免本地/测试被卡。
    console.log("[captcha] not configured; skipping verification");
    return true;
  }
  if (!ticket || !randstr) return false;
  try {
    const res = await client.DescribeCaptchaResult({
      CaptchaType: CAPTCHA_TYPE,
      Ticket: ticket,
      Randstr: randstr,
      // UserIp 必填且需为外网 IP，空串会导致验票失败——调用方需传入真实 IP。
      UserIp: userIp || "",
      CaptchaAppId: Number(CAPTCHA_APP_ID),
      AppSecretKey: APP_SECRET_KEY,
    });
    // 1 = OK 验证通过；其它皆为失败。
    return res.CaptchaCode === 1;
  } catch (err) {
    // 验票接口异常按失败处理，避免异常被当成放行而绕过人机验证。
    console.error("[captcha] verify error", err instanceof Error ? err.message : err);
    return false;
  }
}
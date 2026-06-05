import { sms } from "tencentcloud-sdk-nodejs-sms";

const SmsClient = sms.v20210111.Client;

const SECRET_ID = process.env.TENCENT_SMS_SECRET_ID ?? "";
const SECRET_KEY = process.env.TENCENT_SMS_SECRET_KEY ?? "";
const SDK_APP_ID = process.env.TENCENT_SMS_SDK_APP_ID ?? "";
const SIGN_NAME = process.env.TENCENT_SMS_SIGN_NAME ?? "";
const TEMPLATE_ID_OTP = process.env.TENCENT_SMS_TEMPLATE_ID_OTP ?? "";
const REGION = process.env.TENCENT_SMS_REGION || "ap-guangzhou";

let cachedClient: InstanceType<typeof SmsClient> | null = null;
function getClient(): InstanceType<typeof SmsClient> | null {
  if (!SECRET_ID || !SECRET_KEY || !SDK_APP_ID || !SIGN_NAME || !TEMPLATE_ID_OTP) {
    return null;
  }
  if (!cachedClient) {
    cachedClient = new SmsClient({
      credential: { secretId: SECRET_ID, secretKey: SECRET_KEY },
      region: REGION,
      profile: { httpProfile: { endpoint: "sms.tencentcloudapi.com" } },
    });
  }
  return cachedClient;
}

export interface SendSmsOtpInput {
  to: string;
  code: string;
  expiresMinutes: number;
}

export async function sendSmsOtp(input: SendSmsOtpInput): Promise<void> {
  const client = getClient();
  if (!client) {
    console.log("[sms] Tencent SMS not configured; printing code instead", {
      to: input.to,
      code: input.code,
    });
    return;
  }
  const res = await client.SendSms({
    PhoneNumberSet: [input.to],
    SmsSdkAppId: SDK_APP_ID,
    SignName: SIGN_NAME,
    TemplateId: TEMPLATE_ID_OTP,
    TemplateParamSet: [input.code, String(input.expiresMinutes)],
  });
  const failed = (res.SendStatusSet ?? []).filter((s) => s.Code !== "Ok");
  if (failed.length > 0) {
    const first = failed[0];
    throw new Error(`Tencent SMS error: ${first.Code} ${first.Message}`);
  }
}

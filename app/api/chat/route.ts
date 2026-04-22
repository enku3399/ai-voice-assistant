import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextResponse } from 'next/server';

// XML/SSML форматыг эвдэхээс сэргийлж тусгай тэмдэгтүүдийг цэвэрлэх функц
function escapeXml(unsafe: string) {
  return unsafe.replace(/[<>&'"]/g, function (c) {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

interface HistoryItem {
  role: 'user' | 'ai';
  text: string;
}

// Strict system instruction — markdown-гүй, тоог үгээр бичих, хүндэтгэлтэй
const SYSTEM_INSTRUCTION = `Чи бол Батаа — Монгол ахмад настнуудад зориулсан дуут туслагч хиймэл оюун ухаан. Дараах дүрмүүдийг ЗААВАЛ дагана:

1. Зөвхөн энгийн, ярианы Монгол хэлээр хариулна. Markdown тэмдэгт (*, #, **, _, \`, ~) огт ашиглахгүй.
2. Бүх тоо, огноо, цагийг Монгол үгээр бичнэ. Жишээ нь: "1990" → "мянган есөн зуун ерэн", "1.2" → "нэг аравны хоёр", "14:30" → "дөрвөн цаг гучин минут".
3. Хэрэглэгчид маш хүндэтгэлтэй, дулаан, энхрий хандлагатай байна. Тэдний нэрийг мэдвэл "ахаа" эсвэл "ээж" гэж нэмж хэлнэ.
4. Хариулт богино, 2-3 өгүүлбэр байна. Хэрэв хэрэглэгч нэрийг асуувал зөвхөн нэрийг нь хэлж, дараа нь "Таныг мэдэж авлаа, юу тусалж болох вэ?" гэж асуу.
5. Гадаад үг (Англи, Хятад гэх мэт) ашиглах шаардлагатай бол заавал Монгол кирилл галигаар бич. Латин үсэг, ханз огт ашиглахгүй.
6. Зураг ирвэл доторх бичвэрийг OCR хийж уншиж, Монгол хэлээр тайлбарлана.`;

export async function POST(req: Request) {
  try {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY тохируулагдаагүй байна.');
    if (!process.env.AZURE_SPEECH_KEY) throw new Error('AZURE_SPEECH_KEY тохируулагдаагүй байна.');
    if (!process.env.AZURE_SPEECH_REGION) throw new Error('AZURE_SPEECH_REGION тохируулагдаагүй байна.');

    const contentType = req.headers.get('content-type') ?? '';

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: SYSTEM_INSTRUCTION,
      // @ts-ignore — Google Search grounding
      tools: [{ googleSearch: {} }],
    });

    let reply: string;

    // ── A. FormData (аудио бичлэг) ──────────────────────────────────────────
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const audioFile = formData.get('audio') as File | null;
      const historyRaw = formData.get('history') as string | null;
      const contextPrefix = (formData.get('contextPrefix') as string | null) ?? '';

      if (!audioFile) {
        return NextResponse.json({ error: 'Аудио файл олдсонгүй.' }, { status: 400 });
      }

      const history: HistoryItem[] = historyRaw ? JSON.parse(historyRaw) : [];

      const arrayBuffer = await audioFile.arrayBuffer();
      const audioBase64 = Buffer.from(arrayBuffer).toString('base64');
      const audioMimeType = audioFile.type || 'audio/webm';

      const formattedHistory = history.map((item) => ({
        role: item.role === 'ai' ? 'model' : 'user',
        parts: [{ text: item.text }],
      }));

      const chat = model.startChat({ history: formattedHistory });

      // Context prefix + аудио хамтад нь илгээнэ
      const messageParts: any[] = [
        {
          inlineData: {
            mimeType: audioMimeType,
            data: audioBase64,
          },
        },
        {
          text:
            (contextPrefix ? contextPrefix + '\n\n' : '') +
            'Дээрх аудио бичлэгийг сонсоод, хэрэглэгчийн хэлсэн зүйлд хариул.',
        },
      ];

      const result = await chat.sendMessage(messageParts);
      reply = (await result.response).text();

    // ── B. JSON (текст эсвэл зураг) ─────────────────────────────────────────
    } else {
      const body = await req.json();
      const {
        text,
        history = [],
        image,
        contextPrefix = '',
      }: { text?: string; history: HistoryItem[]; image?: string; contextPrefix?: string } = body;

      if (!text && !image) {
        return NextResponse.json(
          { error: 'Хэлсэн үг болон зураг хоёул хоосон байна.' },
          { status: 400 }
        );
      }

      const formattedHistory = history.map((item) => ({
        role: item.role === 'ai' ? 'model' : 'user',
        parts: [{ text: item.text }],
      }));

      const chat = model.startChat({ history: formattedHistory });

      let formattedMessage: any;
      if (image) {
        formattedMessage = [
          {
            text:
              (contextPrefix ? contextPrefix + '\n\n' : '') +
              (text || 'энэ зургийг уншиж өгөөч'),
          },
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: image,
            },
          },
        ];
      } else {
        formattedMessage = (contextPrefix ? contextPrefix + '\n\n' : '') + text!;
      }

      const result = await chat.sendMessage(formattedMessage);
      reply = (await result.response).text();
    }

    // ── Azure TTS ────────────────────────────────────────────────────────────
    const azureKey = process.env.AZURE_SPEECH_KEY;
    const azureRegion = process.env.AZURE_SPEECH_REGION;
    const ttsUrl = `https://${azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`;

    const safeReply = escapeXml(reply);
    const ssml = `<speak version='1.0' xml:lang='mn-MN'><voice name='mn-MN-BataaNeural'>${safeReply}</voice></speak>`;

    const ttsResponse = await fetch(ttsUrl, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': azureKey,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-96kbitrate-mono-mp3',
      },
      body: ssml,
    });

    if (!ttsResponse.ok) {
      const errText = await ttsResponse.text();
      console.error('Azure TTS Error:', errText);
      throw new Error('Azure Speech API-тай холбогдоход алдаа гарлаа.');
    }

    const ttsBuffer = Buffer.from(await ttsResponse.arrayBuffer());
    const audioBase64Out = ttsBuffer.toString('base64');

    return NextResponse.json({ reply, audioBase64: audioBase64Out });

  } catch (error: unknown) {
    console.error('API алдаа:', error);
    return NextResponse.json(
      { error: 'Серверт алдаа гарлаа. Дахин оролдоно уу.' },
      { status: 500 }
    );
  }
}
